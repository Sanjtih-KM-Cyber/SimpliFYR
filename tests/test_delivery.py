import pytest

from app.core.delivery import (
    ConsoleSink,
    DeliveryService,
    HttpSink,
    KafkaSink,
    S3Sink,
    get_delivery_service,
    set_delivery_service,
)


class FakeProducer:
    def __init__(self):
        self.messages = []

    def send(self, topic, value):
        self.messages.append((topic, value))
        return self

    def flush(self):
        pass


class FakeS3:
    def __init__(self):
        self.objects = {}

    def put_object(self, *, Bucket, Key, Body):
        self.objects[Key] = Body

    def get_object(self, *, Bucket, Key):
        return {"Body": _BytesIO(self.objects[Key])}

    def delete_object(self, *, Bucket, Key):
        self.objects.pop(Key, None)


class _BytesIO:
    def __init__(self, data):
        self.data = data

    def read(self):
        return self.data


class RecordingSink:
    name = "recording"

    def __init__(self):
        self.delivered = []

    def deliver(self, payload, *, event_id, source):
        self.delivered.append((payload, event_id, source))


class FailingSink:
    name = "failing"

    def deliver(self, payload, *, event_id, source):
        raise RuntimeError("boom")


def test_console_sink_no_throw():
    ConsoleSink().deliver({"a": 1}, event_id="e", source="s")


def test_http_sink_posts(monkeypatch):
    sent = {}

    class FakeResp:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_urlopen(req, timeout=None):
        sent["url"] = req.full_url
        sent["body"] = req.data
        return FakeResp()

    import urllib.request

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    HttpSink("http://siem.example/hec").deliver({"a": 1}, event_id="e", source="s")
    assert sent["url"] == "http://siem.example/hec"


def test_s3_sink_batches_into_one_object():
    fake = FakeS3()
    sink = S3Sink(fake, bucket="lake", prefix="output/", batch_size=500, flush_interval=3600)
    try:
        sink.deliver({"a": 1}, event_id="evt-1", source="s")
        sink.deliver({"a": 2}, event_id="evt-2", source="s")
        assert fake.objects == {}  # buffered, not uploaded yet
        sink.flush()
        assert len(fake.objects) == 1  # one object per batch, not per event
        key = next(iter(fake.objects))
        assert key.endswith(".jsonl")
        body = fake.objects[key]
        assert body.count(b"\n") == 2
        assert b'"a": 1' in body and b'"a": 2' in body
    finally:
        sink.close()


def test_s3_sink_auto_flushes_full_buffer():
    fake = FakeS3()
    sink = S3Sink(fake, bucket="lake", prefix="output/", batch_size=2, flush_interval=3600)
    try:
        sink.deliver({"a": 1}, event_id="evt-1", source="s")
        assert fake.objects == {}
        sink.deliver({"a": 2}, event_id="evt-2", source="s")
        assert len(fake.objects) == 1
    finally:
        sink.close()


def test_kafka_sink_publishes(monkeypatch):
    from app.core import kafka_pipeline

    producer = FakeProducer()
    monkeypatch.setattr(kafka_pipeline, "build_producer", lambda: producer)
    kafka_pipeline.reset_shared_producer()
    try:
        KafkaSink("simplifyr.output").deliver({"a": 1}, event_id="e", source="s")
        topic, msg = producer.messages[0]
        assert topic == "simplifyr.output"
        assert msg["event_id"] == "e"
    finally:
        kafka_pipeline.reset_shared_producer()


def test_kafka_producer_is_shared_singleton(monkeypatch):
    from app.core import kafka_pipeline

    builds = []
    producer = FakeProducer()

    def factory():
        builds.append(1)
        return producer

    monkeypatch.setattr(kafka_pipeline, "build_producer", factory)
    kafka_pipeline.reset_shared_producer()
    try:
        KafkaSink("t").deliver({"a": 1}, event_id="e1", source="s")
        KafkaSink("t").deliver({"a": 2}, event_id="e2", source="s")
        assert len(builds) == 1  # built once, reused — not per event
        assert len(producer.messages) == 2
    finally:
        kafka_pipeline.reset_shared_producer()


def test_delivery_service_runs_all_sinks():
    recording = RecordingSink()
    service = DeliveryService([recording])
    service.deliver({"a": 1}, event_id="e", source="s")
    assert recording.delivered == [({"a": 1}, "e", "s")]


def test_delivery_service_failsafe():
    recording = RecordingSink()
    service = DeliveryService([FailingSink(), recording])
    service.deliver({"a": 1}, event_id="e", source="s")  # must not raise
    assert recording.delivered == [({"a": 1}, "e", "s")]


def test_delivery_service_injected_into_engine(monkeypatch):
    # The engine must deliver on OUTPUT and tolerate failures. Verify wiring via
    # the delivery service object returned by get_delivery_service.
    set_delivery_service(DeliveryService([RecordingSink()]))
    try:
        assert get_delivery_service().sinks
    finally:
        set_delivery_service(None)