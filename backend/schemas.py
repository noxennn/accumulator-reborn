from pydantic import BaseModel, field_serializer
from typing import Optional
from datetime import datetime, timezone


def _utc_iso(v: datetime) -> str:
    if v is None:
        return None
    if v.tzinfo is None:
        v = v.replace(tzinfo=timezone.utc)
    return v.isoformat()


class SensorData(BaseModel):
    timestamp: datetime
    co2: float
    voc: float
    pm25: float
    pm10: float

    @field_serializer('timestamp')
    def ser_ts(self, v: datetime) -> str: return _utc_iso(v)

    class Config:
        from_attributes = True

class PartialSensorData(BaseModel):
    timestamp: datetime
    co2: float
    voc: float
    pm25: float
    pm10: float

    @field_serializer('timestamp')
    def ser_ts(self, v: datetime) -> str: return _utc_iso(v)

    class Config:
        from_attributes = True

class UserSettings(BaseModel):
    notifications: bool
    format: str
    thresholds: dict

class UserSettingsCreate(BaseModel):
    notifications: bool
    format: str
    thresholds: dict

class Alert(BaseModel):
    id: int
    timestamp: datetime
    type: str
    value: float
    threshold: float
    acknowledged: Optional[bool] = False

    @field_serializer('timestamp')
    def ser_ts(self, v: datetime) -> str: return _utc_iso(v)

    class Config:
        from_attributes = True

class AlertAcknowledgeRequest(BaseModel):
    alert_id: int

class UserCreate(BaseModel):
    email: str
    password: str

class UserOut(BaseModel):
    id: int
    email: str

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class AIOutputBase(BaseModel):
    timestamp: datetime
    co2: Optional[float]
    voc: Optional[float]
    pm25: Optional[float]
    pm10: Optional[float]
    prediction: str

    @field_serializer('timestamp')
    def ser_ts(self, v: datetime) -> str: return _utc_iso(v)

    class Config:
        from_attributes = True

class AIOutput(AIOutputBase):
    id: int

    class Config:
        from_attributes = True


class InvalidByField(BaseModel):
    co2: int = 0
    voc: int = 0
    pm25: int = 0
    pm10: int = 0
    missing: int = 0
    other: int = 0


class WatchSeriesPoint(BaseModel):
    bucket_start: datetime
    log_count: int
    invalid_count: int
    restart_warning_count: int
    invalid_by_field: InvalidByField

    @field_serializer('bucket_start')
    def ser_bucket_start(self, v: datetime) -> str:
        return _utc_iso(v)


class WatchPeriodSeries(BaseModel):
    granularity: str
    points: list[WatchSeriesPoint]


class WatchPeriodSeriesResponse(BaseModel):
    day: WatchPeriodSeries
    week: WatchPeriodSeries
    month: WatchPeriodSeries


class AnalyticsReportPoint(BaseModel):
    timestamp: str
    co2: Optional[float]
    voc: Optional[float]
    pm25: Optional[float]
    pm10: Optional[float]
    sample_count: int


class AnalyticsMetricStats(BaseModel):
    metric: str
    min: Optional[float]
    max: Optional[float]
    avg: Optional[float]
    stddev: Optional[float]
    min_time: Optional[str]
    max_time: Optional[str]


class AnalyticsReportResponse(BaseModel):
    start: str
    end: str
    period: str
    period_seconds: int
    point_count: int
    points: list[AnalyticsReportPoint]
    statistics: dict[str, AnalyticsMetricStats]


class DashboardPeak(BaseModel):
    metric: str
    value: float
    timestamp: str


class DashboardAdvancedAnalysis(BaseModel):
    duration_by_metric: dict[str, float]
    peak: Optional[DashboardPeak]
    recovery_minutes: Optional[float]
    co2_slope_per_minute: float
    ventilation_label_key: str
    anomaly_chemical: int
    anomaly_crowded: int
    risk15: float
    risk30: float


class DashboardAnalysisResponse(BaseModel):
    start: str
    end: str
    period: str
    thresholds: dict[str, float]
    aqi: int
    advanced: DashboardAdvancedAnalysis
