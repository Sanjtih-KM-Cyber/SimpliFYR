# Infrastructure guards that survived the auth removal (no accounts, no roles):
# rate limiting (incl. proxy-header trust + fail-open) and the raw size cap.
# Uses the module-scoped `client` fixture from conftest.py.
import pytest


@pytest.fixture(autouse=True)
def _open_limits():
    from app.core.config import settings
    from app.core.ratelimit import set_rate_limit

    set_rate_limit(0)
    settings.trust_proxy_headers = False
    settings.max_raw_bytes = 1_000_000
    yield
    set_rate_limit(0)
    settings.trust_proxy_headers = False
    settings.max_raw_bytes = 1_000_000


def test_rate_limit_trusts_forwarded_header_only_when_enabled(client):
    from app.core.config import settings
    from app.core.ratelimit import set_rate_limit

    set_rate_limit(1)
    try:
        # Untrusted (default): spoofed headers ignored, peer counts.
        assert client.post("/api/v1/ingest", data={"raw": "a"}, headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 200
        assert client.post("/api/v1/ingest", data={"raw": "b"}, headers={"X-Forwarded-For": "2.2.2.2"}).status_code == 429

        set_rate_limit(10)
        settings.trust_proxy_headers = True
        # Trusted: distinct forwarded clients get independent budgets.
        for i in range(10):
            assert (
                client.post("/api/v1/ingest", data={"raw": f"x{i}"}, headers={"X-Forwarded-For": "9.9.9.9"}).status_code
                == 200
            )
        assert (
            client.post("/api/v1/ingest", data={"raw": "over"}, headers={"X-Forwarded-For": "9.9.9.9"}).status_code
            == 429
        )
        assert (
            client.post("/api/v1/ingest", data={"raw": "other"}, headers={"X-Forwarded-For": "8.8.8.8"}).status_code
            == 200
        )
    finally:
        set_rate_limit(0)
        settings.trust_proxy_headers = False


def test_rate_limit_fails_open_on_cache_outage(client, monkeypatch):
    from app.core import ratelimit
    from app.core.ratelimit import set_rate_limit

    set_rate_limit(1)

    def _boom():
        raise ConnectionError("redis down")

    monkeypatch.setattr(ratelimit, "get_cache", _boom)
    try:
        assert client.post("/api/v1/ingest", data={"raw": "a"}).status_code == 200
        assert client.post("/api/v1/ingest", data={"raw": "b"}).status_code == 200
    finally:
        set_rate_limit(0)


def test_raw_endpoint_size_cap(client):
    from app.core.config import settings

    settings.max_raw_bytes = 10
    try:
        res = client.post("/api/v1/ingest", data={"raw": "x" * 100})
        stored = res.json()["stored_event_id"]
        assert client.get(f"/api/v1/events/{stored}/raw").status_code == 413
    finally:
        settings.max_raw_bytes = 1_000_000
