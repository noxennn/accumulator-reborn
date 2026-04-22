import asyncio
import json
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
                    logger.warning(f"Incomplete sensor data: {data}")
                    continue

                # ── Server-side doğrulama (CCS811/PMS5003 datasheet aralıkları) ──
                # CO2: 400-8192 ppm, VOC: 0-1187 ppb, PM2.5: 0-1000, PM10: 0-1000
                if not (400 <= co2 <= 8192):
                    logger.warning(f"CO2 out of range ({co2}), discarded")
                    continue
                if not (0 <= voc <= 1187):
                    logger.warning(f"VOC out of range ({voc}), discarded")
                    continue
                if not (0 <= pm25 <= 1000):
                    logger.warning(f"PM2.5 out of range ({pm25}), discarded")
                    continue
                if not (0 <= pm10 <= 1000):
                    logger.warning(f"PM10 out of range ({pm10}), discarded")
                    continue

                now_utc = datetime.now(timezone.utc)
                db.add(models.ArduinoData(
                    timestamp=now_utc, co2=co2, voc=voc, pm25=pm25, pm10=pm10
                ))
                db.commit()
                logger.info(f"CO2:{co2} ppm | VOC:{voc} ppb | PM2.5:{pm25} ug/m3 | PM10:{pm10} ug/m3")

                asyncio.create_task(check_and_alert(co2, voc, pm25, pm10, now_utc))

            except json.JSONDecodeError:
                logger.warning(f"Raw (non-JSON) data: {message}")
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {websocket.client}")
    except (OSError, ConnectionResetError, ConnectionAbortedError) as e:
        logger.warning(f"WebSocket connection lost (network error): {e}")
    except Exception as e:
        logger.error(f"WebSocket unexpected error: {e}")
    finally:
        db.close()


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
