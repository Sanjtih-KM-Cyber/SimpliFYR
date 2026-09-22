from __future__ import annotations

import logging

from fastapi import HTTPException, Request

from app.core.cache import get_cache
from app.core.config import settings

logger = logging.getLogger("simplifyr.ratelimit")

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


def client_ip(request: Request) -> str:
    """Resolve the caller IP for rate limiting.

    Direct peer by default. When TRUST_PROXY_HEADERS is enabled (deployment
    behind the bundled nginx, which sets X-Forwarded-For), the leftmost
    forwarded entry is the real client. Never trust the header by default:
    it is trivially spoofable past an untrusted hop.
    """
    peer = request.client.host if request.client else "unknown"
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            first = forwarded.split(",")[0].strip()
            if first:
                return first
        real_ip = request.headers.get("x-real-ip")
        if real_ip and real_ip.strip():
            return real_ip.strip()
    return peer


def check_rate_limit(request: Request) -> None:
    """Enforce a per-minute request cap using the shared cache.

    Redis-backed when CACHE_BACKEND=redis (distributed across workers);
    in-process otherwise. Fails open with a warning if the cache is
    unreachable — availability over strictness during an outage.
    """
    limit = _current_limit()
    if limit <= 0:
        return

    key = f"ratelimit:{client_ip(request)}"
    try:
        window = get_cache().incr(key, 60)
    except Exception:  # noqa: BLE001
        logger.warning("Rate-limit cache unreachable; allowing request")
        return
    if window > limit:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
