from __future__ import annotations

import json
import logging
from collections.abc import Callable

from app.core.config import settings

logger = logging.getLogger("simplifyr.kafka")


def build_producer():
    """Create a Kafka producer, or None if kafka-python is unavailable."""
    try:
        from kafka import KafkaProducer
    except ImportError:
        return None
    return KafkaProducer(
        bootstrap_servers=settings.kafka_bootstrap_servers,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
    )


_shared_producer = None


def get_shared_producer():
    """Process-wide producer singleton: built once, reused for every send.

    Rebuilding + flushing a producer per event (the old behavior) costs a
    TCP/TLS handshake per message and collapses throughput. Callers keep a
    per-message flush for durability; connection reuse is where the win is.
    """
    global _shared_producer
    if _shared_producer is None:
        _shared_producer = build_producer()
    return _shared_producer


def reset_shared_producer() -> None:
    """Drop the cached producer (used by tests for isolation)."""
    global _shared_producer
    _shared_producer = None


def publish(item: dict) -> None:
    """Publish an event item to the raw Kafka topic."""
    producer = get_shared_producer()
    if producer is None:
        raise RuntimeError("kafka-python is not installed; set PIPELINE_BACKEND=inmemory")
    producer.send(settings.kafka_topic_raw, item)
    producer.flush()


def stage_topic(stage: str) -> str:
    """Resolve a §35 stage name (raw/parsed/normalized/output/...) to its topic."""
    return getattr(settings, f"kafka_topic_{stage}", settings.kafka_topic_raw)


def publish_stage(stage: str, message: dict) -> bool:
    """Publish to a stage topic; False when Kafka is unavailable (fail-safe)."""
    producer = get_shared_producer()
    if producer is None:
        return False
    try:
        producer.send(stage_topic(stage), message)
        producer.flush()
        return True
    except Exception:  # noqa: BLE001
        logger.exception("Failed to publish to stage topic %s", stage)
        return False


def run_consumer(process_item: Callable[[dict], None]) -> None:
    """Blocking consumer loop; run in a worker thread/task."""
    from kafka import KafkaConsumer

    consumer = KafkaConsumer(
        settings.kafka_topic_raw,
        bootstrap_servers=settings.kafka_bootstrap_servers,
        group_id="simplifyr",
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        auto_offset_reset="earliest",
    )
    logger.info("Kafka consumer started on %s", settings.kafka_topic_raw)
    for message in consumer:
        try:
            process_item(message.value)
        except Exception:  # noqa: BLE001
            logger.exception("Kafka consumer failed to process message")