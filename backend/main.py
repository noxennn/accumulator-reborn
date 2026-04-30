import asyncio
import json
from collections import deque
import uvicorn
from fastapi import FastAPI, HTTPException, Depends, Query, WebSocket, WebSocketDisconnect
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
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
    db = SessionLocal()
    try:
        while True:
            message = await websocket.receive_text()
            try:
                data = json.loads(message)
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
                    "timestamp": now_utc.isoformat(),
                    "message": message,
                }
                logger.warning(f"Raw (non-JSON) data: {message}")
                manager.push_log(log_entry)
                asyncio.create_task(manager.broadcast(log_entry))
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {websocket.client}")
    except (OSError, ConnectionResetError, ConnectionAbortedError) as e:
        logger.warning(f"WebSocket connection lost (network error): {e}")
    except Exception as e:
        logger.error(f"WebSocket unexpected error: {e}")
    finally:
        db.close()


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
    limit: int = Query(default=500, le=5000),
    db: Session = Depends(get_db)
):
    query = db.query(models.ArduinoData).order_by(models.ArduinoData.timestamp.desc())
    if start and end:
        query = query.filter(models.ArduinoData.timestamp.between(start, end))
    return query.limit(limit).all()


@app.get(f"{api_prefix}/sensors/aggregated")
async def get_aggregated_data(
    start: datetime,
    end: datetime,
    period: str = Query(default="1h"),
    db: Session = Depends(get_db)
):
    period_seconds = {
        "5m": 300, "15m": 900, "30m": 1800,
        "1h": 3600, "2h": 7200, "4h": 14400,
        "8h": 28800, "12h": 43200, "1d": 86400
    }.get(period, 3600)

    from sqlalchemy import func, text as sa_text

    bucket = func.from_unixtime(
        func.floor(func.unix_timestamp(models.ArduinoData.timestamp) / period_seconds) * period_seconds
    )

    rows = db.query(
        bucket.label("period"),
        func.round(func.avg(models.ArduinoData.co2),  1).label("co2"),
        func.round(func.avg(models.ArduinoData.voc),  1).label("voc"),
        func.round(func.avg(models.ArduinoData.pm25), 2).label("pm25"),
        func.round(func.avg(models.ArduinoData.pm10), 2).label("pm10"),
        func.count(models.ArduinoData.data_id).label("n")
    ).filter(
        models.ArduinoData.timestamp.between(start, end)
    ).group_by(sa_text("period")).order_by(sa_text("period")).all()

    from datetime import timezone as tz
    return [
        {
            "timestamp": (
                row.period.replace(tzinfo=tz.utc).isoformat()
                if hasattr(row.period, "isoformat") else str(row.period)
            ),
            "co2":  float(row.co2)  if row.co2  is not None else None,
            "voc":  float(row.voc)  if row.voc  is not None else None,
            "pm25": float(row.pm25) if row.pm25 is not None else None,
            "pm10": float(row.pm10) if row.pm10 is not None else None,
            "sample_count": row.n,
        }
        for row in rows
    ]


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

    # Find the row where the metric hits its minimum
    min_row = (
        db.query(models.ArduinoData.timestamp)
        .filter(models.ArduinoData.timestamp.between(start, end), col == min_val)
        .order_by(models.ArduinoData.timestamp)
        .first()
    )
    # Find the row where the metric hits its maximum
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
