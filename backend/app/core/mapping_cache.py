from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.cache import get_cache
from app.models import Mapping

CACHE_TTL = 30  # seconds

# Cache key: active mapping id for a source (invalidated on approve/publish).
_ACTIVE_KEY = "mapping:active:{source}"


def get_active_mapping_id(source: str) -> int | None:
    value = get_cache().get(_ACTIVE_KEY.format(source=source))
    return int(value) if value else None


def cache_active_mapping_id(source: str, mapping_id: int) -> None:
    get_cache().set(_ACTIVE_KEY.format(source=source), str(mapping_id), CACHE_TTL)


def invalidate_active_mapping(source: str) -> None:
    get_cache().set(_ACTIVE_KEY.format(source=source), "", 1)


def find_cached_or_lookup(db: Session, source: str) -> Mapping | None:
    """Resolve the active mapping, using the cache when warm."""
    cached = get_active_mapping_id(source)
    if cached is not None:
        mapping = db.get(Mapping, cached)
        if mapping is not None and mapping.status in ("approved", "published"):
            return mapping
    from app.core.engine import find_active_mapping

    mapping = find_active_mapping(db, source)
    if mapping is not None:
        cache_active_mapping_id(source, mapping.id)
    return mapping