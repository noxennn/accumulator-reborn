from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, ForeignKey, JSON
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

Base = declarative_base()

class ArduinoData(Base):
    __tablename__ = 'arduino_data'

    data_id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    co2 = Column(Float, nullable=False)
    voc = Column(Float, nullable=False)
    pm25 = Column(Float, nullable=False)
    pm10 = Column(Float, nullable=False)

class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(60), unique=True, index=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)

    settings = relationship("UserSettings", back_populates="user", uselist=False)
    alerts = relationship("Alert", back_populates="user")

class UserSettings(Base):
    __tablename__ = 'user_settings'

    id = Column(Integer, primary_key=True, index=True)
    notifications = Column(Integer, nullable=False)
    format = Column(String(50), nullable=False)
    thresholds = Column(JSON, nullable=False)
    user_id = Column(Integer, ForeignKey('users.id'))

    user = relationship("User", back_populates="settings")

class Alert(Base):
    __tablename__ = 'alerts'

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    type = Column(String(50), nullable=False)
    value = Column(Float, nullable=False)
    threshold = Column(Float, nullable=False)
    acknowledged = Column(Boolean, default=False)
    user_id = Column(Integer, ForeignKey('users.id'))

    user = relationship("User", back_populates="alerts")

class AIOutput(Base):
    __tablename__ = 'aiOutput'

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    co2 = Column(Float, nullable=True)
    voc = Column(Float, nullable=True)
    pm25 = Column(Float, nullable=True)
    pm10 = Column(Float, nullable=True)
    prediction = Column(String(50), nullable=False)


class ArduinoLog(Base):
    __tablename__ = 'arduino_logs'

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    message = Column(String(1024), nullable=False)


class InvalidDataRecord(Base):
    __tablename__ = 'invalid_data_records'

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    field = Column(String(50), nullable=False)
    value = Column(Float, nullable=False)
    reason = Column(String(1024), nullable=False)
    co2 = Column(Float, nullable=False)
    voc = Column(Float, nullable=False)
    pm25 = Column(Float, nullable=False)
    pm10 = Column(Float, nullable=False)


class DeviceEvent(Base):
    __tablename__ = 'device_events'

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    event_type = Column(String(80), nullable=False, index=True)
    source = Column(String(50), nullable=False, default='arduino')
    reason = Column(String(255), nullable=True)
    payload = Column(JSON, nullable=True)
