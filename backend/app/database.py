from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = "postgresql+psycopg2://postgres.wqoekhbwdrgryahoyjuo:Vms%40Platform2024@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"

engine = create_engine(
    DATABASE_URL,
    pool_size=3,
    max_overflow=2,
    pool_timeout=5,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(bind=engine)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
