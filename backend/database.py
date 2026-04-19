from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

db_config = {
    "host": "localhost",        # e.g., "localhost"
    "user": "root",
    "password": "",
    "database": "accumulator",
    "port": 3306               # Optional, default is 3306
}

# Try to get DATABASE_URL from environment variables
DATABASE_URL = os.getenv("DATABASE_URL")

# If DATABASE_URL is not set, create it from db_config
if not DATABASE_URL:
    DATABASE_URL = f"mysql+pymysql://{db_config['user']}:{db_config['password']}@{db_config['host']}:{db_config['port']}/{db_config['database']}"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def create_database_tables():
    Base.metadata.create_all(bind=engine)