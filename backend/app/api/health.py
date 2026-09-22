from fastapi import APIRouter

from app.core.config import settings
from app.core.database import engine

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    try:
        with engine.connect():
            db_ok = True
    except Exception:
        db_ok = False

    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.app_version,
        "database": "ok" if db_ok else "error",
    }