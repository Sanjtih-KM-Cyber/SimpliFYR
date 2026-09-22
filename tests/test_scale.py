import pytest

from app.core.cache import InMemoryCache, RedisCache, get_cache, set_cache
from app.core.ratelimit import set_rate_limit
from app.core.raw_store import S3RawStore, set_raw_store


class FakeS3:
    def __init__(self):
        self.objects = {}

    def put_object(self, *, Bucket, Key, Body):
        self.objects[Key] = Body.decode("utf-8")

    def get_object(self, *, Bucket, Key):
        return {"Body": _BytesIO(self.objects[Key].encode("utf-8"))}

    def delete_object(self, *, Bucket, Key):
        self.objects.pop(Key, None)


class _BytesIO:
    def __init__(self, data):
        self.data = data

    def read(self):
        return self.data


class FakeProducer:
    def __init__(self):
        self.messages = []

    def send(self, topic, value):
        self.messages.append((topic, value))
        return self

    def flush(self):
        pass


def test_inmemory_cache_ttl_and_incr():
    cache = InMemoryCache()
    cache.set("a", "1", 60)
    assert cache.get("a") == "1"
    assert cache.incr("count", 60) == 1
    assert cache.incr("count", 60) == 2


def test_get_cache_default_is_inmemory():
    set_cache(None)
    assert isinstance(get_cache(), InMemoryCache)


def test_s3_raw_store_roundtrip():
    fake = FakeS3()
    store = S3RawStore(fake, bucket="simplifyr", prefix="raw/")
    ref = store.save("evt-1", "hello world")
    assert ref == "evt-1.raw"
    assert fake.objects["raw/evt-1.raw"] == "hello world"
    assert store.load("evt-1.raw") == "hello world"
    store.delete("evt-1.raw")
    assert "raw/evt-1.raw" not in fake.objects


def test_kafka_publish(monkeypatch):
    from app.core import kafka_pipeline

    producer = FakeProducer()
    monkeypatch.setattr(kafka_pipeline, "build_producer", lambda: producer)
    kafka_pipeline.reset_shared_producer()
    try:
        kafka_pipeline.publish({"payload": "x"})
        assert producer.messages and producer.messages[0][1] == {"payload": "x"}
    finally:
        kafka_pipeline.reset_shared_producer()


def test_kafka_publish_without_dependency_raises(monkeypatch):
    from app.core import kafka_pipeline

    monkeypatch.setattr(kafka_pipeline, "build_producer", lambda: None)
    kafka_pipeline.reset_shared_producer()
    try:
        with pytest.raises(RuntimeError):
            kafka_pipeline.publish({"payload": "x"})
    finally:
        kafka_pipeline.reset_shared_producer()


def test_rate_limit_via_cache():
    set_cache(InMemoryCache())
    set_rate_limit(2)
    from fastapi import Request
    from starlette.requests import HTTPConnection

    # build a minimal request-like object
    scope = {"type": "http", "client": ("1.2.3.4", 1234)}
    request = Request(scope)
    from app.core.ratelimit import check_rate_limit

    check_rate_limit(request)
    check_rate_limit(request)
    with pytest.raises(Exception):
        check_rate_limit(request)
    set_rate_limit(0)


def test_mapping_cache_roundtrip():
    from app.core.cache import set_cache
    from app.core.mapping_cache import cache_active_mapping_id, get_active_mapping_id, invalidate_active_mapping

    set_cache(InMemoryCache())
    cache_active_mapping_id("VendorX", 42)
    assert get_active_mapping_id("VendorX") == 42
    invalidate_active_mapping("VendorX")
    assert get_active_mapping_id("VendorX") is None