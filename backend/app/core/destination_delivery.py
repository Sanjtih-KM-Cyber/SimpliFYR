from __future__ import annotations

import logging
import time

from sqlalchemy import select

from app.core.config import settings
from app.core.delivery import ConsoleSink, DeliveryService, HttpSink, KafkaSink, S3Sink, Sink

logger = logging.getLogger("simplifyr.delivery")

CACHE_TTL = 30  # seconds

_sink_cache: list[Sink] | None = None
_sink_cache_at: float = 0.0


def invalidate_destination_sinks() -> None:
    global _sink_cache
    if _sink_cache is not None:
        # Flush buffered sinks (S3 batches) before dropping the set so no
        # delivered-but-unflushed lines are lost on rebuild.
        for sink in _sink_cache:
            flush = getattr(sink, "flush", None)
            if callable(flush):
                try:
                    flush()
                except Exception:  # noqa: BLE001
                    logger.warning("Failed to flush sink on invalidate", exc_info=True)
    _sink_cache = None


def _build_sink(dtype: str, config: dict) -> Sink | None:
    if dtype == "console":
        return ConsoleSink()
    if dtype == "http":
        url = config.get("url")
        return HttpSink(url) if url else None
    if dtype == "s3":
        bucket = config.get("bucket")
        if not bucket:
            return None
        import boto3

        client = boto3.client(
            "s3",
            endpoint_url=config.get("endpoint_url") or settings.s3_endpoint_url,
            region_name=config.get("region") or settings.s3_region,
            aws_access_key_id=config.get("access_key") or settings.s3_access_key,
            aws_secret_access_key=config.get("secret_key") or settings.s3_secret_key,
        )
        return S3Sink(client, bucket, config.get("prefix", "output/"))
    if dtype == "kafka":
        topic = config.get("topic")
        return KafkaSink(topic) if topic else None
    return None


def get_destination_sinks() -> list[Sink]:
    """Build sinks from enabled DB-managed destinations (cached with a short TTL)."""
    global _sink_cache, _sink_cache_at
    now = time.monotonic()
    if _sink_cache is not None and now - _sink_cache_at < CACHE_TTL:
        return _sink_cache

    from app.core.database import SessionLocal
    from app.models import Destination

    sinks: list[Sink] = []
    try:
        with SessionLocal() as db:
            rows = db.execute(
                select(Destination).where(Destination.enabled.is_(True))
            ).scalars().all()
            for d in rows:
                sink = _build_sink(d.type, d.config or {})
                if sink is not None:
                    sinks.append(sink)
    except Exception:  # noqa: BLE001
        logger.warning("Failed to load destinations", exc_info=True)

    _sink_cache = sinks
    _sink_cache_at = now
    return sinks


def deliver_to_destinations(payload: dict, *, event_id: str, source: str | None) -> None:
    """Deliver to every enabled DB-managed destination (fail-safe, per sink)."""
    sinks = get_destination_sinks()
    if not sinks:
        return
    DeliveryService(sinks).deliver(payload, event_id=event_id, source=source)
