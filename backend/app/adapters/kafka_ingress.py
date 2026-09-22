"""Kafka ingress adapter: consume an *external* event topic into the pipeline.

This is the mirror of the pipeline's internal Kafka transport: instead of
Simplifyr publishing to its own `simplifyr.raw` topic, an outside producer
(SIEM forwarder, upstream collector) writes to a configured ingress topic and
this consumer feeds each record into the same processing queue the syslog/file
adapters use. Requires the optional kafka-python dependency.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

from app.core.config import settings

logger = logging.getLogger("simplifyr.kafka_ingress")


def build_ingress_handler():
    """Return a callback that wraps an external record for the pipeline."""
    from app.core import pipeline

    def handle(payload: str, topic: str) -> None:
        pipeline.enqueue(
            {
                "payload": payload,
                "ingestion_type": "kafka",
                "address": topic,
                "content_type": "text/plain",
            }
        )

    return handle


def run_ingress_consumer(process_item: Callable[[dict], None] | None = None) -> None:
    """Blocking external-topic consumer loop; run in a worker thread."""
    try:
        from kafka import KafkaConsumer
    except ImportError:
        logger.warning("kafka-python is not installed; Kafka ingress disabled")
        return

    import json

    handler = process_item
    if handler is None:
        from app.core.pipeline import _process

        handler = _process

    consumer = KafkaConsumer(
        settings.kafka_ingress_topic,
        bootstrap_servers=settings.kafka_bootstrap_servers,
        group_id=settings.kafka_ingress_group,
        value_deserializer=lambda v: v.decode("utf-8", errors="replace"),
        auto_offset_reset="earliest",
    )
    logger.info("Kafka ingress consumer started on %s", settings.kafka_ingress_topic)
    for message in consumer:
        raw = message.value
        if isinstance(raw, dict):
            raw = raw.get("payload", json.dumps(raw))
        try:
            handler(
                {
                    "payload": str(raw),
                    "ingestion_type": "kafka",
                    "address": settings.kafka_ingress_topic,
                    "content_type": "text/plain",
                }
            )
        except Exception:  # noqa: BLE001
            logger.exception("Kafka ingress failed to process message")
