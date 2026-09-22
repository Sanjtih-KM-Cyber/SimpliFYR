from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False}
    if settings.database_url.startswith("sqlite")
    else {},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def reset_engine(url: str | None = None) -> None:
    """Recreate the engine/session against a new URL (used by tests for isolation)."""
    global engine, SessionLocal
    target = url or settings.database_url
    engine.dispose()
    engine = create_engine(
        target,
        connect_args={"check_same_thread": False}
        if target.startswith("sqlite")
        else {},
    )
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app.core.migrations import run_migrations

    run_migrations(url=str(engine.url))