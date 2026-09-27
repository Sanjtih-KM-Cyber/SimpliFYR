from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


def apply_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
    """Per-connection SQLite tuning: WAL readers never block the writer.

    Same disk, same durability for this scale (NORMAL sync + rollback safety
    intact) — the Live screen polling while a flood writes is exactly the
    contention WAL removes. No-ops on in-memory databases.
    """
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
    finally:
        cursor.close()


def _is_sqlite(url: str) -> bool:
    return url.startswith("sqlite")


def _build_engine(url: str):
    eng = create_engine(
        url,
        connect_args={"check_same_thread": False} if _is_sqlite(url) else {},
    )
    if _is_sqlite(url):
        event.listen(eng, "connect", apply_sqlite_pragmas)
    return eng


engine = _build_engine(settings.database_url)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def reset_engine(url: str | None = None) -> None:
    """Recreate the engine/session against a new URL (used by tests for isolation)."""
    global engine, SessionLocal
    target = url or settings.database_url
    engine.dispose()
    engine = _build_engine(target)
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