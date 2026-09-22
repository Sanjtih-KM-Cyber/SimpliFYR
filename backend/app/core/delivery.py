from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Protocol

from app.core.config import settings

logger = logging.getLogger("simplifyr.delivery")


class Sink(Protocol):
    name: str

    def deliver(
        self, payload: dict, *, event_id: str, source: str | None
    ) -> None: ...


class ConsoleSink:
    name = "console"

    def deliver(self, payload: dict, *, event_id: str, source: str | None) -> None:
        logger.info("DELIVER[%s|%s] %s", source or "unknown", event_id, json.dumps(payload))


class HttpSink:
    """POST the standardized output to an HTTP endpoint (webhook / SIEM HEC)."""

    name = "http"

    def __init__(self, url: str) -> None:
        self.url = url

    def deliver(self, payload: dict, *, event_id: str, source: str | None) -> None:
        import urllib.request

        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.url, data=body, headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status >= 300:
                raise RuntimeError(f"HTTP sink returned {resp.status}")


class S3Sink:
    """Batched NDJSON uploads to S3/MinIO (data-lake friendly).

    Lines are buffered in memory and uploaded as one object per batch —
    either when the buffer reaches `batch_size` lines or when `flush()` is
    called. A daemon thread flushes partial buffers every `flush_interval`
    seconds so low-volume streams still land within a minute. This replaces
    the old one-object-per-event behavior (one PUT per message).
    """

    name = "s3"

    def __init__(
        self,
        client,
        bucket: str,
        prefix: str = "output/",
        batch_size: int = 500,
        flush_interval: float = 60.0,
    ) -> None:
        import threading

        self.client = client
        self.bucket = bucket
        self.prefix = prefix.rstrip("/") + "/" if prefix else ""
        self.batch_size = max(1, batch_size)
        self._buffer: list[bytes] = []
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._flush_loop, args=(flush_interval,), daemon=True
        )
        self._thread.start()

    def _key(self) -> str:
        from uuid import uuid4

        day = datetime.now(timezone.utc).strftime("%Y/%m/%d")
        hour = datetime.now(timezone.utc).strftime("%H")
        return f"{self.prefix}{day}/{hour}-{uuid4().hex[:8]}.jsonl"

    def deliver(self, payload: dict, *, event_id: str, source: str | None) -> None:
        line = (json.dumps(payload) + "\n").encode("utf-8")
        with self._lock:
            self._buffer.append(line)
            ready = len(self._buffer) >= self.batch_size
        if ready:
            self.flush()

    def flush(self) -> None:
        with self._lock:
            if not self._buffer:
                return
            body = b"".join(self._buffer)
            self._buffer = []
        self.client.put_object(Bucket=self.bucket, Key=self._key(), Body=body)

    def _flush_loop(self, interval: float) -> None:
        while not self._stop.wait(interval):
            try:
                self.flush()
            except Exception:  # noqa: BLE001
                logger.warning("S3Sink background flush failed", exc_info=True)

    def close(self) -> None:
        self._stop.set()
        try:
            self.flush()
        except Exception:  # noqa: BLE001
            logger.warning("S3Sink final flush failed", exc_info=True)


class KafkaSink:
    """Publish the standardized output to a Kafka topic for downstream consumers."""

    name = "kafka"

    def __init__(self, topic: str) -> None:
        self.topic = topic

    def deliver(self, payload: dict, *, event_id: str, source: str | None) -> None:
        from app.core.kafka_pipeline import get_shared_producer

        producer = get_shared_producer()
        if producer is None:
            raise RuntimeError("kafka-python is not installed")
        producer.send(
            self.topic,
            {"event_id": event_id, "source": source, "payload": payload},
        )
        producer.flush()


class DeliveryService:
    def __init__(self, sinks: list[Sink]) -> None:
        self.sinks = sinks

    def deliver(self, payload: dict, *, event_id: str, source: str | None) -> None:
        for sink in self.sinks:
            try:
                sink.deliver(payload, event_id=event_id, source=source)
            except Exception:  # noqa: BLE001
                # Fail-safe: a failing sink must never break the pipeline.
                logger.warning("Delivery to sink '%s' failed", sink.name, exc_info=True)


def _enabled() -> set[str]:
    return {s.strip() for s in settings.delivery_sinks.split(",") if s.strip()}


def _build_sinks() -> list[Sink]:
    enabled = _enabled()
    sinks: list[Sink] = []
    if "console" in enabled:
        sinks.append(ConsoleSink())
    if "http" in enabled and settings.sink_http_url:
        sinks.append(HttpSink(settings.sink_http_url))
    if "s3" in enabled and settings.sink_s3_bucket:
        import boto3

        client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
        )
        sinks.append(S3Sink(client, settings.sink_s3_bucket, settings.sink_s3_prefix))
    if "kafka" in enabled:
        sinks.append(KafkaSink(settings.sink_kafka_topic))
    return sinks


_service: DeliveryService | None = None


def get_delivery_service() -> DeliveryService:
    global _service
    if _service is None:
        _service = DeliveryService(_build_sinks())
    return _service


def set_delivery_service(service: DeliveryService | None) -> None:
    """Override the delivery service (used by tests)."""
    global _service
    _service = service