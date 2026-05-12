import asyncio
import json
from collections import deque
import uvicorn
from fastapi import FastAPI, HTTPException, Depends, Query, WebSocket, WebSocketDisconnect, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta, timezone
import joblib
import auth
from database import SessionLocal, engine
import models, schemas
from utils.email import send_alert_email
import logging

logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.FileHandler("app.log"), logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

models.Base.metadata.create_all(bind=engine)

app = FastAPI()
logger.info("Uygulama başlatıldı.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

api_prefix = "/air"


class ConnectionManager:
    """Manages active frontend WebSocket connections for live data feed."""

    def __init__(self):
        # Maps websocket → user thresholds dict (or None for unauthenticated)
        self.active_connections: dict[WebSocket, Optional[dict]] = {}
        self.recent_data:    deque[dict] = deque(maxlen=50)
        self.recent_logs:    deque[dict] = deque(maxlen=50)
        self.recent_invalid: deque[dict] = deque(maxlen=50)
        self.recent_events:  deque[dict] = deque(maxlen=50)

        # Arduino connection state
        self.arduino_connected: bool = False
        self.arduino_first_connected: Optional[datetime] = None
        self.arduino_last_disconnected: Optional[datetime] = None

    def get_arduino_status(self) -> dict:
        return {
            "type": "arduino_status",
            "is_connected": self.arduino_connected,
            "first_connected": _utc_iso(self.arduino_first_connected) if self.arduino_first_connected else None,
            "last_disconnected": _utc_iso(self.arduino_last_disconnected) if self.arduino_last_disconnected else None,
        }

    async def connect(self, websocket: WebSocket, thresholds: Optional[dict] = None):
        await websocket.accept()
        self.active_connections[websocket] = thresholds
        # Replay buffered data, logs and invalid entries to newly connected clients.
        try:
            for point in self.recent_data:
                await websocket.send_json(self._enrich(point, thresholds))
            for entry in self.recent_logs:
                await websocket.send_json(entry)
            for entry in self.recent_invalid:
                await websocket.send_json(entry)
            for entry in self.recent_events:
                await websocket.send_json(entry)
            # Send current Arduino connection status to newly connected frontend clients.
            await websocket.send_json(self.get_arduino_status())
        except Exception:
            self.disconnect(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.pop(websocket, None)

    def push_recent(self, data: dict):
        self.recent_data.append(data)

    def push_log(self, entry: dict):
        self.recent_logs.append(entry)

    def push_invalid(self, entry: dict):
        self.recent_invalid.append(entry)

    def push_event(self, entry: dict):
        self.recent_events.append(entry)

    @staticmethod
    def _enrich(payload: dict, thresholds: Optional[dict]) -> dict:
        """Attach per-metric threshold status to data payloads for authenticated clients."""
        if not thresholds or payload.get("type") != "data":
            return payload
        status: dict[str, str] = {}
        for metric in ["co2", "pm25", "pm10", "voc"]:
            val = payload.get(metric)
            thr = thresholds.get(metric)
            if val is None or not thr:
                status[metric] = "green"
            elif val > thr:
                status[metric] = "red"
            elif val >= thr * 0.8:
                status[metric] = "yellow"
            else:
                status[metric] = "green"
        return {**payload, "threshold_status": status}

    async def broadcast(self, data: dict):
        dead: set[WebSocket] = set()
        for ws, thresholds in self.active_connections.items():
            try:
                await ws.send_json(self._enrich(data, thresholds))
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.active_connections.pop(ws, None)


manager = ConnectionManager()


def _normalize_invalid_field(field: str) -> str:
    key = (field or '').strip().lower()
    if key in {'co2'}:
        return 'co2'
    if key in {'voc', 'tvoc'}:
        return 'voc'
    if key in {'pm25', 'pm2.5', 'pm2p5'}:
        return 'pm25'
    if key in {'pm10'}:
        return 'pm10'
    if key in {'missing'}:
        return 'missing'
    return 'other'


def _utc_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _period_seconds(period: str) -> int:
    return {
        "5m": 300,
        "15m": 900,
        "30m": 1800,
        "1h": 3600,
        "2h": 7200,
        "4h": 14400,
        "8h": 28800,
        "12h": 43200,
        "1d": 86400,
    }.get(period, 3600)


def _default_thresholds() -> dict[str, float]:
    return {"co2": 1000.0, "pm25": 35.0, "pm10": 50.0, "voc": 500.0}


def _coerce_thresholds(thresholds: Optional[dict]) -> dict[str, float]:
    base = _default_thresholds()
    if not isinstance(thresholds, dict):
        return base

    result = dict(base)
    for metric in ["co2", "pm25", "pm10", "voc"]:
        raw = thresholds.get(metric)
        try:
            val = float(raw)
            if val > 0:
                result[metric] = val
        except (TypeError, ValueError):
            continue
    return result


def _extract_token_from_auth_header(auth_header: Optional[str]) -> Optional[str]:
    if not auth_header:
        return None
    parts = auth_header.strip().split(" ", 1)
    if len(parts) != 2:
        return None
    scheme, token = parts[0], parts[1].strip()
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def _calculate_aqi(pm25: float, pm10: float) -> int:
    pm25_breakpoints = [
        {"cLow": 0.0, "cHigh": 9.0, "iLow": 0, "iHigh": 50},
        {"cLow": 9.1, "cHigh": 35.4, "iLow": 51, "iHigh": 100},
        {"cLow": 35.5, "cHigh": 55.4, "iLow": 101, "iHigh": 150},
        {"cLow": 55.5, "cHigh": 125.4, "iLow": 151, "iHigh": 200},
        {"cLow": 125.5, "cHigh": 225.4, "iLow": 201, "iHigh": 300},
        {"cLow": 225.5, "cHigh": 325.4, "iLow": 301, "iHigh": 400},
        {"cLow": 325.5, "cHigh": 500.4, "iLow": 401, "iHigh": 500},
    ]
    pm10_breakpoints = [
        {"cLow": 0, "cHigh": 54, "iLow": 0, "iHigh": 50},
        {"cLow": 55, "cHigh": 154, "iLow": 51, "iHigh": 100},
        {"cLow": 155, "cHigh": 254, "iLow": 101, "iHigh": 150},
        {"cLow": 255, "cHigh": 354, "iLow": 151, "iHigh": 200},
        {"cLow": 355, "cHigh": 424, "iLow": 201, "iHigh": 300},
        {"cLow": 425, "cHigh": 504, "iLow": 301, "iHigh": 400},
        {"cLow": 505, "cHigh": 604, "iLow": 401, "iHigh": 500},
    ]

    def _to_sub_index(concentration: float, breakpoints: list[dict], precision: int) -> int:
        c = max(0.0, float(concentration)) if concentration is not None else 0.0
        factor = 10 ** precision
        c_truncated = int(c * factor) / factor

        bp = next((b for b in breakpoints if b["cLow"] <= c_truncated <= b["cHigh"]), None)
        if not bp:
            return 500 if c_truncated > breakpoints[-1]["cHigh"] else 0

        sub_index = ((bp["iHigh"] - bp["iLow"]) / (bp["cHigh"] - bp["cLow"])) * (c_truncated - bp["cLow"]) + bp["iLow"]
        return int(round(sub_index))

    return max(_to_sub_index(pm25, pm25_breakpoints, 1), _to_sub_index(pm10, pm10_breakpoints, 0))


def _build_dashboard_advanced(points: list[dict[str, Any]], thresholds: dict[str, float], period: str) -> dict[str, Any]:
    metric_keys = ["co2", "voc", "pm25", "pm10"]

    normalized: list[dict[str, Any]] = []
    for row in points:
        try:
            ts = datetime.fromisoformat(str(row["timestamp"]).replace("Z", "+00:00"))
            normalized.append({
                "ts": ts,
                "iso": _utc_iso(ts),
                "co2": float(row["co2"]) if row.get("co2") is not None else None,
                "voc": float(row["voc"]) if row.get("voc") is not None else None,
                "pm25": float(row["pm25"]) if row.get("pm25") is not None else None,
                "pm10": float(row["pm10"]) if row.get("pm10") is not None else None,
            })
        except Exception:
            continue

    normalized = [
        p for p in normalized
        if p["co2"] is not None and p["voc"] is not None and p["pm25"] is not None and p["pm10"] is not None
    ]
    normalized.sort(key=lambda p: p["ts"])

    duration_by_metric = {"co2": 0.0, "voc": 0.0, "pm25": 0.0, "pm10": 0.0}

    if len(normalized) < 2:
        return {
            "duration_by_metric": duration_by_metric,
            "peak": None,
            "recovery_minutes": None,
            "co2_slope_per_minute": 0.0,
            "ventilation_label_key": "insufficientData",
            "anomaly_chemical": 0,
            "anomaly_crowded": 0,
        }

    expected_minutes = {
        "5m": 5,
        "15m": 15,
        "30m": 30,
        "1h": 60,
        "2h": 120,
    }.get(period, 15)
    max_segment_minutes = max(5, expected_minutes * 2)

    for i in range(len(normalized) - 1):
        current = normalized[i]
        nxt = normalized[i + 1]
        dt_minutes = (nxt["ts"] - current["ts"]).total_seconds() / 60.0
        if dt_minutes <= 0 or dt_minutes > max_segment_minutes:
            continue
        for metric in metric_keys:
            if current[metric] > thresholds[metric]:
                duration_by_metric[metric] += dt_minutes

    peak: Optional[dict[str, Any]] = None
    for point_index, point in enumerate(normalized):
        for metric in metric_keys:
            thr = thresholds[metric]
            if thr <= 0:
                continue
            ratio = point[metric] / thr
            if ratio <= 1:
                continue
            if peak is None:
                peak = {"metric": metric, "value": point[metric], "timestamp": point["iso"], "index": point_index}
                continue
            peak_ratio = peak["value"] / thresholds[peak["metric"]]
            if ratio > peak_ratio:
                peak = {"metric": metric, "value": point[metric], "timestamp": point["iso"], "index": point_index}

    recovery_minutes: Optional[float] = None
    if peak is not None:
        threshold = thresholds[peak["metric"]]
        for i in range(peak["index"] + 1, len(normalized)):
            if normalized[i][peak["metric"]] <= threshold:
                recovery_minutes = (normalized[i]["ts"] - normalized[peak["index"]]["ts"]).total_seconds() / 60.0
                break

    latest_ts = normalized[-1]["ts"]
    co2_window = [p for p in normalized if (latest_ts - p["ts"]).total_seconds() <= 30 * 60]
    slopes: list[float] = []
    for i in range(1, len(co2_window)):
        dt = (co2_window[i]["ts"] - co2_window[i - 1]["ts"]).total_seconds() / 60.0
        if dt <= 0:
            continue
        slopes.append((co2_window[i]["co2"] - co2_window[i - 1]["co2"]) / dt)

    co2_slope_per_minute = (sum(slopes) / len(slopes)) if slopes else 0.0
    if co2_slope_per_minute >= 2:
        ventilation_label_key = "weak"
    elif co2_slope_per_minute >= 0.3:
        ventilation_label_key = "rising"
    elif co2_slope_per_minute <= -1:
        ventilation_label_key = "effective"
    else:
        ventilation_label_key = "balanced"

    anomaly_chemical = sum(1 for p in normalized if p["co2"] <= thresholds["co2"] and p["voc"] > thresholds["voc"])
    anomaly_crowded = sum(1 for p in normalized if p["co2"] > thresholds["co2"] and p["voc"] > thresholds["voc"])

    return {
        "duration_by_metric": {
            "co2": round(duration_by_metric["co2"], 1),
            "voc": round(duration_by_metric["voc"], 1),
            "pm25": round(duration_by_metric["pm25"], 1),
            "pm10": round(duration_by_metric["pm10"], 1),
        },
        "peak": (
            {
                "metric": peak["metric"],
                "value": round(float(peak["value"]), 1),
                "timestamp": peak["timestamp"],
            }
            if peak is not None else None
        ),
        "recovery_minutes": round(recovery_minutes, 1) if recovery_minutes is not None else None,
        "co2_slope_per_minute": round(co2_slope_per_minute, 2),
        "ventilation_label_key": ventilation_label_key,
        "anomaly_chemical": anomaly_chemical,
        "anomaly_crowded": anomaly_crowded,
    }


def _build_aggregated_rows(db: Session, *, start: datetime, end: datetime, period: str) -> list[dict[str, Any]]:
    period_seconds = _period_seconds(period)

    from sqlalchemy import func, text as sa_text

    bucket = func.from_unixtime(
        func.floor(func.unix_timestamp(models.ArduinoData.timestamp) / period_seconds) * period_seconds
    )

    rows = db.query(
        bucket.label("period"),
        func.round(func.avg(models.ArduinoData.co2), 1).label("co2"),
        func.round(func.avg(models.ArduinoData.voc), 1).label("voc"),
        func.round(func.avg(models.ArduinoData.pm25), 2).label("pm25"),
        func.round(func.avg(models.ArduinoData.pm10), 2).label("pm10"),
        func.count(models.ArduinoData.data_id).label("n"),
    ).filter(
        models.ArduinoData.timestamp.between(start, end)
    ).group_by(sa_text("period")).order_by(sa_text("period")).all()

    serialized_rows: list[dict[str, Any]] = []
    for row in rows:
        serialized_rows.append({
            "timestamp": (
                row.period.replace(tzinfo=timezone.utc).isoformat()
                if hasattr(row.period, "isoformat") else str(row.period)
            ),
            "co2": float(row.co2) if row.co2 is not None else None,
            "voc": float(row.voc) if row.voc is not None else None,
            "pm25": float(row.pm25) if row.pm25 is not None else None,
            "pm10": float(row.pm10) if row.pm10 is not None else None,
            "sample_count": int(row.n),
        })

    return serialized_rows


def _compute_metric_stats(db: Session, *, metric: str, start: datetime, end: datetime) -> dict[str, Any]:
    if metric not in ["co2", "voc", "pm25", "pm10"]:
        raise HTTPException(status_code=400, detail="Invalid metric")

    from sqlalchemy import func
    from datetime import timezone as tz

    col = getattr(models.ArduinoData, metric)

    result = db.query(
        func.min(col),
        func.max(col),
        func.avg(col),
        func.stddev_pop(col)
    ).filter(models.ArduinoData.timestamp.between(start, end)).one()

    min_val, max_val, avg_val, stddev_val = result

    min_row = (
        db.query(models.ArduinoData.timestamp)
        .filter(models.ArduinoData.timestamp.between(start, end), col == min_val)
        .order_by(models.ArduinoData.timestamp)
        .first()
    )
    max_row = (
        db.query(models.ArduinoData.timestamp)
        .filter(models.ArduinoData.timestamp.between(start, end), col == max_val)
        .order_by(models.ArduinoData.timestamp)
        .first()
    )

    def _ts(row):
        if row is None:
            return None
        ts = row.timestamp
        if ts is None:
            return None
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=tz.utc)
        return ts.isoformat()

    return {
        "metric": metric,
        "min": min_val,
        "max": max_val,
        "avg": avg_val,
        "stddev": stddev_val,
        "min_time": _ts(min_row),
        "max_time": _ts(max_row),
    }


def _floor_bucket(dt: datetime, granularity: str) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if granularity == 'hour':
        return dt.replace(minute=0, second=0, microsecond=0)
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _build_watch_series(
    db: Session,
    *,
    start: datetime,
    end: datetime,
    granularity: str,
) -> schemas.WatchPeriodSeries:
    current = _floor_bucket(start, granularity)
    end_bucket = _floor_bucket(end, granularity)

    buckets: Dict[datetime, Dict[str, Any]] = {}
    while current <= end_bucket:
        buckets[current] = {
            'log_count': 0,
            'invalid_count': 0,
            'restart_warning_count': 0,
            'invalid_by_field': {
                'co2': 0,
                'voc': 0,
                'pm25': 0,
                'pm10': 0,
                'missing': 0,
                'other': 0,
            },
        }
        if granularity == 'hour':
            current += timedelta(hours=1)
        else:
            current += timedelta(days=1)

    log_rows = (
        db.query(models.ArduinoLog.timestamp)
        .filter(models.ArduinoLog.timestamp.between(start, end))
        .all()
    )
    for row in log_rows:
        bucket = _floor_bucket(row.timestamp, granularity)
        if bucket in buckets:
            buckets[bucket]['log_count'] += 1

    invalid_rows = (
        db.query(models.InvalidDataRecord.timestamp, models.InvalidDataRecord.field)
        .filter(models.InvalidDataRecord.timestamp.between(start, end))
        .all()
    )
    for row in invalid_rows:
        bucket = _floor_bucket(row.timestamp, granularity)
        if bucket not in buckets:
            continue
        buckets[bucket]['invalid_count'] += 1
        norm_field = _normalize_invalid_field(row.field)
        buckets[bucket]['invalid_by_field'][norm_field] += 1

    event_rows = (
        db.query(models.DeviceEvent.timestamp, models.DeviceEvent.event_type)
        .filter(models.DeviceEvent.timestamp.between(start, end))
        .filter(models.DeviceEvent.event_type == 'restart_warning')
        .all()
    )
    for row in event_rows:
        bucket = _floor_bucket(row.timestamp, granularity)
        if bucket in buckets:
            buckets[bucket]['restart_warning_count'] += 1

    points: list[schemas.WatchSeriesPoint] = []
    for bucket_start in sorted(buckets.keys()):
        agg = buckets[bucket_start]
        points.append(
            schemas.WatchSeriesPoint(
                bucket_start=bucket_start,
                log_count=agg['log_count'],
                invalid_count=agg['invalid_count'],
                restart_warning_count=agg['restart_warning_count'],
                invalid_by_field=schemas.InvalidByField(**agg['invalid_by_field']),
            )
        )

    return schemas.WatchPeriodSeries(granularity=granularity, points=points)


async def check_and_alert(co2: float, voc: float, pm25: float, pm10: float, now_utc: datetime):
    db = SessionLocal()
    try:
        data_dict = {"co2": co2, "voc": voc, "pm25": pm25, "pm10": pm10}
        users = db.query(models.User).all()

        for user in users:
            settings = db.query(models.UserSettings).filter_by(user_id=user.id).first()
            if not settings or not settings.notifications:
                continue

            thresholds = settings.thresholds
            exceeded = []

            for pollutant in ["co2", "pm25", "pm10", "voc"]:
                current_value = data_dict.get(pollutant)
                threshold = thresholds.get(pollutant)

                if not current_value or not threshold or current_value <= threshold:
                    continue

                recent_alert = db.query(models.Alert).filter_by(
                    user_id=user.id,
                    type=pollutant
                ).order_by(models.Alert.timestamp.desc()).first()

                if recent_alert:
                    alert_time = recent_alert.timestamp
                    if alert_time.tzinfo is None:
                        alert_time = alert_time.replace(tzinfo=timezone.utc)
                    if alert_time > now_utc - timedelta(minutes=5):
                        logger.info(f"Alert for {pollutant} already sent recently for {user.email}. Skipping.")
                        continue

                exceeded.append({"type": pollutant, "value": current_value, "threshold": threshold})
                db.add(models.Alert(
                    user_id=user.id,
                    timestamp=now_utc,
                    type=pollutant,
                    value=current_value,
                    threshold=threshold,
                    acknowledged=False
                ))

            if exceeded:
                logger.info(f"Sending alert to {user.email}: {exceeded}")
                await send_alert_email(
                    user_email=user.email,
                    alert_info={
                        "timestamp": now_utc.strftime("%Y-%m-%d %H:%M:%S"),
                        "co2": co2,
                        "pm25": pm25,
                        "pm10": pm10,
                        "voc": voc,
                    },
                    thresholds=thresholds
                )

        db.commit()
    finally:
        db.close()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info(f"WebSocket connected: {websocket.client}")

    now_utc = datetime.now(timezone.utc)
    if manager.arduino_first_connected is None:
        manager.arduino_first_connected = now_utc
    manager.arduino_connected = True
    asyncio.create_task(manager.broadcast(manager.get_arduino_status()))

    db = SessionLocal()
    try:
        while True:
            message = await websocket.receive_text()
            try:
                data = json.loads(message)

                if data.get('type') == 'event':
                    now_utc = datetime.now(timezone.utc)
                    event_type = str(data.get('event_type') or 'unknown')
                    source = str(data.get('source') or 'arduino')
                    reason = data.get('reason')
                    event_payload = {
                        'type': 'event',
                        'timestamp': _utc_iso(now_utc),
                        'event_type': event_type,
                        'source': source,
                        'reason': reason,
                        'payload': data,
                    }
                    db.add(models.DeviceEvent(
                        timestamp=now_utc,
                        event_type=event_type,
                        source=source,
                        reason=reason,
                        payload=data,
                    ))
                    db.commit()
                    manager.push_event(event_payload)
                    asyncio.create_task(manager.broadcast(event_payload))
                    continue

                co2  = data.get("co2")
                voc  = data.get("voc")
                pm25 = data.get("pm25")
                pm10 = data.get("pm10")

                if any(v is None for v in [co2, voc, pm25, pm10]):
                    now_utc = datetime.now(timezone.utc)
                    reason = f"Incomplete sensor data: {data}"
                    logger.warning(reason)
                    inv = {
                        "type": "invalid",
                        "timestamp": now_utc.isoformat(),
                        "field": "missing",
                        "value": 0,
                        "reason": reason,
                        "co2": co2 or 0, "voc": voc or 0, "pm25": pm25 or 0, "pm10": pm10 or 0,
                    }
                    manager.push_invalid(inv)
                    db.add(models.InvalidDataRecord(
                        timestamp=now_utc,
                        field='missing',
                        value=0,
                        reason=reason,
                        co2=co2 or 0,
                        voc=voc or 0,
                        pm25=pm25 or 0,
                        pm10=pm10 or 0,
                    ))
                    db.commit()
                    asyncio.create_task(manager.broadcast(inv))
                    continue

                # ── Server-side doğrulama (CCS811/PMS5003 datasheet aralıkları) ──
                # CO2: 400-8192 ppm, VOC: 0-1187 ppb, PM2.5: 0-1000, PM10: 0-1000
                if not (400 <= co2 <= 8192):
                    now_utc = datetime.now(timezone.utc)
                    reason = f"CO2 out of range ({co2}), expected 400-8192"
                    logger.warning(reason)
                    inv = {
                        "type": "invalid",
                        "timestamp": now_utc.isoformat(),
                        "field": "co2",
                        "value": co2,
                        "reason": reason,
                        "co2": co2, "voc": voc, "pm25": pm25, "pm10": pm10,
                    }
                    manager.push_invalid(inv)
                    db.add(models.InvalidDataRecord(
                        timestamp=now_utc,
                        field='co2',
                        value=float(co2),
                        reason=reason,
                        co2=float(co2),
                        voc=float(voc),
                        pm25=float(pm25),
                        pm10=float(pm10),
                    ))
                    db.commit()
                    asyncio.create_task(manager.broadcast(inv))
                    continue
                if not (0 <= voc <= 1187):
                    now_utc = datetime.now(timezone.utc)
                    reason = f"VOC out of range ({voc}), expected 0-1187"
                    logger.warning(reason)
                    inv = {
                        "type": "invalid",
                        "timestamp": now_utc.isoformat(),
                        "field": "voc",
                        "value": voc,
                        "reason": reason,
                        "co2": co2, "voc": voc, "pm25": pm25, "pm10": pm10,
                    }
                    manager.push_invalid(inv)
                    db.add(models.InvalidDataRecord(
                        timestamp=now_utc,
                        field='voc',
                        value=float(voc),
                        reason=reason,
                        co2=float(co2),
                        voc=float(voc),
                        pm25=float(pm25),
                        pm10=float(pm10),
                    ))
                    db.commit()
                    asyncio.create_task(manager.broadcast(inv))
                    continue
                if not (0 <= pm25 <= 1000):
                    now_utc = datetime.now(timezone.utc)
                    reason = f"PM2.5 out of range ({pm25}), expected 0-1000"
                    logger.warning(reason)
                    inv = {
                        "type": "invalid",
                        "timestamp": now_utc.isoformat(),
                        "field": "pm25",
                        "value": pm25,
                        "reason": reason,
                        "co2": co2, "voc": voc, "pm25": pm25, "pm10": pm10,
                    }
                    manager.push_invalid(inv)
                    db.add(models.InvalidDataRecord(
                        timestamp=now_utc,
                        field='pm25',
                        value=float(pm25),
                        reason=reason,
                        co2=float(co2),
                        voc=float(voc),
                        pm25=float(pm25),
                        pm10=float(pm10),
                    ))
                    db.commit()
                    asyncio.create_task(manager.broadcast(inv))
                    continue
                if not (0 <= pm10 <= 1000):
                    now_utc = datetime.now(timezone.utc)
                    reason = f"PM10 out of range ({pm10}), expected 0-1000"
                    logger.warning(reason)
                    inv = {
                        "type": "invalid",
                        "timestamp": now_utc.isoformat(),
                        "field": "pm10",
                        "value": pm10,
                        "reason": reason,
                        "co2": co2, "voc": voc, "pm25": pm25, "pm10": pm10,
                    }
                    manager.push_invalid(inv)
                    db.add(models.InvalidDataRecord(
                        timestamp=now_utc,
                        field='pm10',
                        value=float(pm10),
                        reason=reason,
                        co2=float(co2),
                        voc=float(voc),
                        pm25=float(pm25),
                        pm10=float(pm10),
                    ))
                    db.commit()
                    asyncio.create_task(manager.broadcast(inv))
                    continue

                now_utc = datetime.now(timezone.utc)
                db.add(models.ArduinoData(
                    timestamp=now_utc, co2=co2, voc=voc, pm25=pm25, pm10=pm10
                ))
                db.commit()
                logger.info(f"CO2:{co2} ppm | VOC:{voc} ppb | PM2.5:{pm25} ug/m3 | PM10:{pm10} ug/m3")

                payload = {
                    "type": "data",
                    "timestamp": now_utc.isoformat(),
                    "co2": co2,
                    "voc": voc,
                    "pm25": pm25,
                    "pm10": pm10,
                }
                manager.push_recent(payload)

                asyncio.create_task(check_and_alert(co2, voc, pm25, pm10, now_utc))
                asyncio.create_task(manager.broadcast(payload))

            except json.JSONDecodeError:
                now_utc = datetime.now(timezone.utc)
                log_entry = {
                    "type": "log",
                    "timestamp": _utc_iso(now_utc),
                    "message": message,
                }
                logger.warning(f"Raw (non-JSON) data: {message}")
                manager.push_log(log_entry)
                db.add(models.ArduinoLog(timestamp=now_utc, message=message))
                db.commit()
                asyncio.create_task(manager.broadcast(log_entry))
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {websocket.client}")
    except (OSError, ConnectionResetError, ConnectionAbortedError) as e:
        logger.warning(f"WebSocket connection lost (network error): {e}")
    except Exception as e:
        logger.error(f"WebSocket unexpected error: {e}")
    finally:
        db.close()
        manager.arduino_connected = False
        manager.arduino_last_disconnected = datetime.now(timezone.utc)
        asyncio.create_task(manager.broadcast(manager.get_arduino_status()))


@app.websocket("/ws/live")
async def live_feed_endpoint(websocket: WebSocket, token: Optional[str] = Query(None)):
    """Frontend connects here to receive live sensor data broadcasts."""
    thresholds: Optional[dict] = None
    if token:
        db = SessionLocal()
        try:
            user = auth.get_user_from_token(token, db)
            if user:
                settings = db.query(models.UserSettings).filter_by(user_id=user.id).first()
                if settings and settings.thresholds:
                    thresholds = settings.thresholds
        except Exception:
            pass
        finally:
            db.close()

    await manager.connect(websocket, thresholds)
    logger.info(f"Live feed WebSocket connected: {websocket.client} (authenticated={thresholds is not None})")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info(f"Live feed WebSocket disconnected: {websocket.client}")
    except Exception as e:
        manager.disconnect(websocket)
        logger.warning(f"Live feed WebSocket error: {e}")


@app.get(f"{api_prefix}/sensors/history", response_model=List[schemas.SensorData])
async def get_data(
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    limit: int = Query(default=500, ge=1, le=5000),
    chronological: bool = Query(default=True),
    db: Session = Depends(get_db)
):
    query = db.query(models.ArduinoData).order_by(models.ArduinoData.timestamp.desc())
    if start and end:
        query = query.filter(models.ArduinoData.timestamp.between(start, end))
    rows = query.limit(limit).all()
    if chronological:
        rows.reverse()
    return rows


@app.get(f"{api_prefix}/watch/period-series", response_model=schemas.WatchPeriodSeriesResponse)
async def get_watch_period_series(db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)

    day_start = now - timedelta(days=1)
    week_start = now - timedelta(days=7)
    month_start = now - timedelta(days=30)

    day = _build_watch_series(db, start=day_start, end=now, granularity='hour')
    week = _build_watch_series(db, start=week_start, end=now, granularity='day')
    month = _build_watch_series(db, start=month_start, end=now, granularity='day')

    return schemas.WatchPeriodSeriesResponse(day=day, week=week, month=month)


@app.get(f"{api_prefix}/sensors/aggregated")
async def get_aggregated_data(
    start: datetime,
    end: datetime,
    period: str = Query(default="1h"),
    db: Session = Depends(get_db)
):
    return _build_aggregated_rows(db, start=start, end=end, period=period)


@app.get(f"{api_prefix}/analytics/report", response_model=schemas.AnalyticsReportResponse)
async def get_analytics_report(
    start: datetime,
    end: datetime,
    period: str = Query(default="1h"),
    db: Session = Depends(get_db)
):
    points = _build_aggregated_rows(db, start=start, end=end, period=period)
    statistics = {
        metric: schemas.AnalyticsMetricStats(**_compute_metric_stats(db, metric=metric, start=start, end=end))
        for metric in ["co2", "voc", "pm25", "pm10"]
    }

    return schemas.AnalyticsReportResponse(
        start=_utc_iso(start),
        end=_utc_iso(end),
        period=period,
        period_seconds=_period_seconds(period),
        point_count=len(points),
        points=[schemas.AnalyticsReportPoint(**point) for point in points],
        statistics=statistics,
    )


@app.get(f"{api_prefix}/dashboard/analysis", response_model=schemas.DashboardAnalysisResponse)
async def get_dashboard_analysis(
    request: Request,
    start: datetime,
    end: datetime,
    period: str = Query(default="15m"),
    db: Session = Depends(get_db),
):
    token = _extract_token_from_auth_header(request.headers.get("Authorization"))
    current_user = auth.get_user_from_token(token, db) if token else None

    thresholds = _default_thresholds()
    if current_user is not None:
        settings = db.query(models.UserSettings).filter_by(user_id=current_user.id).first()
        thresholds = _coerce_thresholds(settings.thresholds if settings else None)

    points = _build_aggregated_rows(db, start=start, end=end, period=period)
    advanced = _build_dashboard_advanced(points, thresholds, period)

    latest = db.query(models.ArduinoData).order_by(models.ArduinoData.timestamp.desc()).first()
    if latest is None:
        aqi = 0
    else:
        aqi = _calculate_aqi(float(latest.pm25), float(latest.pm10))

    return schemas.DashboardAnalysisResponse(
        start=_utc_iso(start),
        end=_utc_iso(end),
        period=period,
        thresholds=thresholds,
        aqi=aqi,
        advanced=schemas.DashboardAdvancedAnalysis(**advanced),
    )


@app.get(f"{api_prefix}/sensors/exceeded-intervals")
async def get_exceeded_intervals(
    start: datetime,
    end: datetime,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Return merged intervals where any metric exceeded the user's alert thresholds."""
    settings = db.query(models.UserSettings).filter_by(user_id=current_user.id).first()
    thresholds = (settings.thresholds if settings else None) or {
        "co2": 1000, "pm25": 35, "pm10": 50, "voc": 500
    }

    rows = (
        db.query(models.ArduinoData)
        .filter(models.ArduinoData.timestamp.between(start, end))
        .order_by(models.ArduinoData.timestamp)
        .all()
    )

    # Gaps shorter than GAP_SECONDS within an exceedance window are merged into the interval.
    GAP_SECONDS = 300

    def _iso(ts: datetime) -> str:
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts.isoformat()

    result = []
    for metric in ["co2", "pm25", "pm10", "voc"]:
        threshold = float(thresholds.get(metric) or 0)
        if threshold <= 0:
            continue

        exceeded = [
            (r.timestamp, float(getattr(r, metric)))
            for r in rows
            if getattr(r, metric) is not None and float(getattr(r, metric)) > threshold
        ]
        if not exceeded:
            continue

        # Build merged intervals
        seg_start, seg_end = exceeded[0][0], exceeded[0][0]
        for ts, _ in exceeded[1:]:
            if (ts - seg_end).total_seconds() <= GAP_SECONDS:
                seg_end = ts
            else:
                # collect all raw values in this merged window (including non-exceeded ones)
                vals = [
                    float(getattr(r, metric))
                    for r in rows
                    if seg_start <= r.timestamp <= seg_end and getattr(r, metric) is not None
                ]
                if vals:
                    result.append({
                        "metric": metric,
                        "start": _iso(seg_start),
                        "end": _iso(seg_end),
                        "threshold": threshold,
                        "max_value": round(max(vals), 1),
                        "avg_value": round(sum(vals) / len(vals), 1),
                        "duration_minutes": round((seg_end - seg_start).total_seconds() / 60, 1),
                    })
                seg_start = seg_end = ts

        # Flush final segment
        vals = [
            float(getattr(r, metric))
            for r in rows
            if seg_start <= r.timestamp <= seg_end and getattr(r, metric) is not None
        ]
        if vals:
            result.append({
                "metric": metric,
                "start": _iso(seg_start),
                "end": _iso(seg_end),
                "threshold": threshold,
                "max_value": round(max(vals), 1),
                "avg_value": round(sum(vals) / len(vals), 1),
                "duration_minutes": round((seg_end - seg_start).total_seconds() / 60, 1),
            })

    result.sort(key=lambda x: x["start"])
    return result


@app.get(f"{api_prefix}/sensors/summary", response_model=List[schemas.PartialSensorData])
def get_sensor_summary(
    start_time: Optional[datetime] = Query(None),
    end_time: Optional[datetime] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(
        models.ArduinoData.timestamp,
        models.ArduinoData.co2,
        models.ArduinoData.voc,
        models.ArduinoData.pm25,
        models.ArduinoData.pm10
    )
    if start_time and end_time:
        query = query.filter(models.ArduinoData.timestamp.between(start_time, end_time))
    return query.order_by(models.ArduinoData.timestamp.desc()).all()


@app.get(f"{api_prefix}/sensors/current", response_model=schemas.SensorData)
async def get_current_data(db: Session = Depends(get_db)):
    record = db.query(models.ArduinoData).order_by(models.ArduinoData.timestamp.desc()).first()
    if not record:
        raise HTTPException(status_code=404, detail="No sensor data found")
    return record


@app.get(f"{api_prefix}/stats")
async def get_stats(metric: str, start: datetime, end: datetime, db: Session = Depends(get_db)):
    return _compute_metric_stats(db, metric=metric, start=start, end=end)


@app.get(f"{api_prefix}/settings", response_model=schemas.UserSettings)
def get_user_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    settings = db.query(models.UserSettings).filter(models.UserSettings.user_id == current_user.id).first()
    if not settings:
        settings = models.UserSettings(
            user_id=current_user.id,
            notifications=True,
            format="metric",
            thresholds={"co2": 1000, "pm25": 35, "pm10": 50, "voc": 500}
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@app.post(f"{api_prefix}/settings", response_model=schemas.UserSettings)
def update_user_settings(
    updated_settings: schemas.UserSettingsCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    settings = db.query(models.UserSettings).filter(models.UserSettings.user_id == current_user.id).first()
    if not settings:
        settings = models.UserSettings(user_id=current_user.id, **updated_settings.dict())
        db.add(settings)
    else:
        for key, value in updated_settings.dict().items():
            setattr(settings, key, value)
    db.commit()
    db.refresh(settings)
    return settings


@app.get("/air/alerts/unacknowledged", response_model=List[schemas.Alert])
def get_user_unacknowledged_alerts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    return db.query(models.Alert).filter(
        models.Alert.user_id == current_user.id,
        models.Alert.acknowledged == False
    ).order_by(models.Alert.timestamp.desc()).all()


@app.post("/air/alerts/acknowledge", response_model=schemas.Alert)
def acknowledge_alert(
    request: schemas.AlertAcknowledgeRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    alert = db.query(models.Alert).filter(
        models.Alert.id == request.alert_id,
        models.Alert.user_id == current_user.id
    ).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found or not yours")
    if alert.acknowledged:
        raise HTTPException(status_code=400, detail="Already acknowledged")
    alert.acknowledged = True
    db.commit()
    db.refresh(alert)
    return alert


@app.post("/air/alerts/acknowledgeall")
def acknowledge_all_alerts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    unacknowledged = db.query(models.Alert).filter(
        models.Alert.user_id == current_user.id,
        models.Alert.acknowledged == False
    ).all()
    if not unacknowledged:
        return {"message": "Tüm uyarılar zaten acknowledge edilmiş."}
    for alert in unacknowledged:
        alert.acknowledged = True
    db.commit()
    return {
        "message": f"{len(unacknowledged)} uyarı acknowledge edildi.",
        "acknowledged_ids": [a.id for a in unacknowledged]
    }


@app.post("/auth/register", response_model=schemas.UserOut)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    if auth.get_user_by_email(db, user.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed_pw = auth.get_password_hash(user.password)
    db_user = models.User(email=user.email, hashed_password=hashed_pw)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    db.add(models.UserSettings(
        user_id=db_user.id,
        notifications=True,
        format="metric",
        thresholds={"co2": 1000, "pm25": 35, "pm10": 50, "voc": 500}
    ))
    db.commit()
    return db_user


@app.post("/auth/login", response_model=schemas.Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = auth.authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    access_token = auth.create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}


@app.get("/auth/me", response_model=schemas.UserOut)
def read_users_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


@app.get(f"{api_prefix}/ai/latest", response_model=schemas.AIOutput)
def get_latest_prediction(db: Session = Depends(get_db)):
    latest = db.query(models.AIOutput).order_by(models.AIOutput.timestamp.desc()).first()
    if not latest:
        raise HTTPException(status_code=404, detail="No predictions found")
    return latest


@app.post("/ml/process")
def process_and_store_ai_output(
    start_time: Optional[datetime] = Query(None),
    end_time: Optional[datetime] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(
        models.ArduinoData.timestamp,
        models.ArduinoData.co2,
        models.ArduinoData.voc,
        models.ArduinoData.pm25,
        models.ArduinoData.pm10
    )
    if start_time and end_time:
        query = query.filter(models.ArduinoData.timestamp.between(start_time, end_time))

    for row in query.all():
        month = int(str(row.timestamp).split('-')[1])
        features = [row.co2, row.voc, row.pm25, row.pm10, get_season(month)]
        label = predict(features)
        db.add(models.AIOutput(
            timestamp=row.timestamp,
            co2=row.co2,
            voc=row.voc,
            pm25=row.pm25,
            pm10=row.pm10,
            prediction=label
        ))

    db.commit()
    return {"message": "AI outputs processed and stored."}


def get_season(month: int) -> int:
    if month in [12, 1, 2]:
        return 3
    elif month in [3, 4, 5]:
        return 2
    elif month in [6, 7, 8]:
        return 1
    return 0


def predict(data):
    categories = ["GOOD", "Moderate", "Unhealthy for Sensitive Groups",
                  "Unhealthy", "Very Unhealthy", "Hazardous"]
    model = joblib.load("rf_model.pkl")
    output = model.predict([data])
    return categories[int(output[0])]


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
