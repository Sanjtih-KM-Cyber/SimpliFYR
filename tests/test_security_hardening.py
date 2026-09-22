# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).
import hashlib

import pytest

from app.core import security
from app.core.security import set_auth

KEYS = {"admin": "admintoken", "operator": "optoken", "analyst": "antoken"}


@pytest.fixture(autouse=True)
def _open_auth():
    set_auth(False)
    yield
    set_auth(False)
    from app.core.ratelimit import set_rate_limit

    set_rate_limit(0)
    security.settings.trust_proxy_headers = False
    security.settings.auth_backend = "tokens"
    security.settings.max_raw_bytes = 1_000_000


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_tokens_stored_as_hashes_not_plaintext():
    set_auth(True, {"admin": "s3cret-value"})
    stored = security._api_key_hashes["admin"]
    assert stored != "s3cret-value"
    assert stored == hashlib.sha256("s3cret-value".encode()).hexdigest()


def test_valid_and_invalid_tokens_with_hashing(client):
    set_auth(True, KEYS)
    assert client.get("/api/v1/events", headers=_auth("optoken")).status_code == 200
    assert client.get("/api/v1/events", headers=_auth("nope")).status_code == 401


def test_rotate_keys_admin_only_and_invalidates_old(client):
    set_auth(True, KEYS)
    # Analyst cannot rotate.
    assert (
        client.post(
            "/api/v1/system/rotate-keys", json={"role": "operator"}, headers=_auth("antoken")
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/system/rotate-keys", json={"role": "root"}, headers=_auth("admintoken")
        ).status_code
        == 422
    )
    res = client.post(
        "/api/v1/system/rotate-keys", json={"role": "operator"}, headers=_auth("admintoken")
    )
    assert res.status_code == 200
    new_token = res.json()["token"]
    assert new_token != "optoken"

    # New token works for writes; old token is dead.
    assert (
        client.post(
            "/api/v1/mappings",
            json={"name": "R", "source": "R", "fields": []},
            headers=_auth(new_token),
        ).status_code
        == 201
    )
    assert client.get("/api/v1/events", headers=_auth("optoken")).status_code == 401

    # Rotation itself is audited (without the secret).
    audit = client.get("/api/v1/audit", headers=_auth("admintoken")).json()
    assert any(a["action"] == "rotate_key" and a["entity_type"] == "role" for a in audit)


def test_oidc_backend_without_pyjwt_is_503(client):
    security.settings.auth_backend = "oidc"
    set_auth(True, {})
    try:
        res = client.get("/api/v1/events", headers=_auth("anything"))
        assert res.status_code == 503
    finally:
        security.settings.auth_backend = "tokens"


def test_rate_limit_trusts_forwarded_header_only_when_enabled(client):
    from app.core.ratelimit import set_rate_limit

    set_rate_limit(1)
    try:
        # Untrusted (default): spoofed headers ignored, peer counts.
        assert client.post("/api/v1/ingest", data={"raw": "a"}, headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 200
        assert client.post("/api/v1/ingest", data={"raw": "b"}, headers={"X-Forwarded-For": "2.2.2.2"}).status_code == 429

        set_rate_limit(10)
        security.settings.trust_proxy_headers = True
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
        security.settings.trust_proxy_headers = False


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
    security.settings.max_raw_bytes = 10
    try:
        res = client.post("/api/v1/ingest", data={"raw": "x" * 100})
        stored = res.json()["stored_event_id"]
        assert client.get(f"/api/v1/events/{stored}/raw").status_code == 413
    finally:
        security.settings.max_raw_bytes = 1_000_000
