from __future__ import annotations

import asyncio
import logging

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.engine import ProcessingEngine

logger = logging.getLogger("simplifyr.pipeline")


def _maxsize() -> int:
    try:
        return max(1, int(settings.pipeline_max_queue))
    except (TypeError, ValueError):
        return 10000


# In-process event queue (dev default). Kafka swaps in via PIPELINE_BACKEND=kafka.
# Bounded (§45 backpressure): when full, async producers shed load (drop +
# count) instead of growing memory without limit or crashing.
queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=_maxsize())

_dropped_total = 0


def configure_queue(maxsize: int) -> None:
    """Recreate the queue with a given capacity (used by tests)."""
    global queue, _dropped_total
    queue = asyncio.Queue(maxsize=max(1, maxsize))
    _dropped_total = 0


def queue_depth() -> int:
    return queue.qsize()


def queue_dropped_total() -> int:
    return _dropped_total


def enqueue(item: dict) -> bool:
    """Add a raw event item to the pipeline (in-memory or Kafka).

    Returns True when accepted. When the in-memory buffer is full the item is
    dropped and counted — UDP/TCP/file producers cannot propagate backpressure
    to the sender, so shed + metric is the correct semantics (HTTP/batch stay
    synchronous behind their own size limits and never touch this queue).
    """
    if settings.pipeline_backend == "kafka":
        from app.core.kafka_pipeline import publish

        publish(item)
        return True
    global _dropped_total
    try:
        queue.put_nowait(item)
        return True
    except asyncio.QueueFull:
        _dropped_total += 1
        logger.warning("Pipeline queue full (%d); shedding load", queue.qsize())
        return False


def _process(item: dict) -> None:
    with SessionLocal() as db:
        ProcessingEngine(db).process_payload(**item)


async def worker_loop() -> None:
    """In-memory consumer: continuously drain the queue through the engine."""
    while True:
        item = await queue.get()
        try:
            _process(item)
        except Exception:  # noqa: BLE001
            logger.exception("Pipeline worker failed to process item")
        finally:
            queue.task_done()


async def kafka_worker_loop() -> None:
    """Kafka consumer: continuously consume the raw topic through the engine."""
    from app.core.kafka_pipeline import run_consumer

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, run_consumer, _process)


def worker_factories() -> list:
    """Return the coroutine factories for the configured pipeline backend."""
    if settings.pipeline_backend == "kafka":
        return [kafka_worker_loop]
    return [worker_loop] * max(1, settings.pipeline_workers)
