from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config

_BACKEND_DIR = Path(__file__).resolve().parents[2]


def _alembic_config() -> Config:
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "migrations"))
    return cfg


def run_migrations(url: str | None = None) -> None:
    """Apply all pending migrations (creates schema on a fresh database)."""
    cfg = _alembic_config()
    if url:
        cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")


def current_revision() -> str | None:
    try:
        from sqlalchemy import create_engine, text

        from app.core.config import settings

        engine = create_engine(settings.database_url)
        with engine.connect() as conn:
            return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except Exception:
        return None