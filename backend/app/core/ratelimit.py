from __future__ import annotations

from fastapi import HTTPException, Request

from app.core.cache import get_cache
from app.core.config import settings

# Mutable limit (0 = unlimited); initialized from settings, overridable in tests.
_limit: int | None = None


def set_rate_limit(limit: int) -> None:
    global _limit
    _limit = limit


def _current_limit() -> int:
    global _limit
    if _limit is None:
        _limit = settings.rate_limit_per_minute
    return _limit


def check_rate_limit(request: Request) -> None:
    """Enforce a per-minute request cap using the shared cache (distributed in Redis)."""
    limit = _current_limit()
    if limit <= 0:
        return

    key = request.client.host if request.client else "unknown"
    cache = get_cache()
    window = cache.incr(f"ratelimit:{key}", 60)
    if window > limit:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")