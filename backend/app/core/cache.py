from __future__ import annotations

import time
from typing import Protocol

from app.core.config import settings


class Cache(Protocol):
    """Simple key/value cache with TTL used for rate limiting and mapping lookups."""

    def get(self, key: str) -> str | None: ...
    def set(self, key: str, value: str, ttl: int) -> None: ...
    def incr(self, key: str, ttl: int) -> int: ...


class InMemoryCache:
    def __init__(self) -> None:
        self._store: dict[str, str] = {}
        self._expiry: dict[str, float] = {}

    def get(self, key: str) -> str | None:
        if key in self._expiry and time.monotonic() > self._expiry[key]:
            self._store.pop(key, None)
            self._expiry.pop(key, None)
        return self._store.get(key)

    def set(self, key: str, value: str, ttl: int) -> None:
        self._store[key] = value
        self._expiry[key] = time.monotonic() + ttl

    def incr(self, key: str, ttl: int) -> int:
        now = time.monotonic()
        if key not in self._store or (key in self._expiry and now > self._expiry[key]):
            self._store[key] = "0"
            self._expiry[key] = now + ttl
        value = int(self._store[key]) + 1
        self._store[key] = str(value)
        return value


class RedisCache:
    def __init__(self, client) -> None:
        self.client = client

    def get(self, key: str) -> str | None:
        value = self.client.get(key)
        return value.decode() if isinstance(value, bytes) else value

    def set(self, key: str, value: str, ttl: int) -> None:
        self.client.set(key, value, ex=ttl)

    def incr(self, key: str, ttl: int) -> int:
        value = self.client.incr(key)
        if value == 1:
            self.client.expire(key, ttl)
        return int(value)


_cache: Cache | None = None


def _build_cache() -> Cache:
    if settings.cache_backend == "redis":
        try:
            import redis

            return RedisCache(
                redis.Redis.from_url(settings.redis_url, socket_connect_timeout=2)
            )
        except Exception:  # noqa: BLE001
            return InMemoryCache()
    return InMemoryCache()


def get_cache() -> Cache:
    global _cache
    if _cache is None:
        _cache = _build_cache()
    return _cache


def set_cache(cache: Cache | None) -> None:
    """Override the cache (used by tests / provider injection)."""
    global _cache
    _cache = cache