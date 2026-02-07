from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import settings
from app.db.models import Base

# Use psycopg (v3) driver; URL may be postgresql:// from env
database_url = settings.database_url
if database_url.startswith("postgresql://") and "+" not in database_url.split("?")[0]:
    database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)

connect_args = {} if "postgresql" in database_url else {"check_same_thread": False}
engine = create_engine(
    database_url,
    connect_args=connect_args,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    Base.metadata.create_all(bind=engine)
