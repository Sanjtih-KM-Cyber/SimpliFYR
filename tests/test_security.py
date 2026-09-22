# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).
import pytest  # noqa: E402

from app.core.security import set_auth

KEYS = {"admin": "admintoken", "operator": "optoken", "analyst": "antoken"}

MAPPING = {
    "name": "VendorX Firewall v1 Traffic",
    "source": "VendorX Firewall v1",
    "fields": [
        {"input_field": "srcip", "semantic_field": "source.ip"},
        {"input_field": "action", "semantic_field": "network.action"},
    ],
}


@pytest.fixture(scope="module", autouse=True)
def _enable_auth(client):
    set_auth(True, KEYS)
    yield
    set_auth(False)  # restore open mode for other test modules


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_health_is_public(client):
    assert client.get("/api/v1/health").status_code == 200


def test_protected_endpoint_requires_token(client):
    assert client.get("/api/v1/events").status_code == 401
    assert client.get("/api/v1/stats").status_code == 401


def test_invalid_token_rejected(client):
    assert client.get("/api/v1/events", headers=_auth("wrong")).status_code == 401


def test_analyst_can_read_but_not_write(client):
    assert client.get("/api/v1/events", headers=_auth("antoken")).status_code == 200
    res = client.post("/api/v1/mappings", json=MAPPING, headers=_auth("antoken"))
    assert res.status_code == 403


def test_operator_can_write(client):
    res = client.post("/api/v1/mappings", json=MAPPING, headers=_auth("optoken"))
    assert res.status_code == 201


def test_admin_can_write_and_read(client):
    mapping = client.post("/api/v1/mappings", json=MAPPING, headers=_auth("admintoken")).json()
    assert client.patch(
        f"/api/v1/mappings/{mapping['id']}", json={"status": "published"}, headers=_auth("admintoken")
    ).status_code == 200
    assert client.get("/api/v1/events", headers=_auth("admintoken")).status_code == 200


def test_config_excludes_secrets(client):
    body = client.get("/api/v1/config", headers=_auth("admintoken")).json()
    assert body["auth_enabled"] is True
    assert "api_keys" not in body
    assert "admintoken" not in str(body)


def test_batch_processing_metrics(client):
    lines = "\n".join(
        [
            "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny",
            "<134>Sep 15 10:31:45 fw01 srcip=10.1.1.5 action=deny",
            "<134>Sep 15 10:31:46 fw01 srcip=10.1.1.5 action=deny",
        ]
    )
    res = client.post(
        "/api/v1/process/batch",
        data={"raw": lines, "source": MAPPING["source"], "mapping_id": str(1)},
        headers=_auth("optoken"),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 3
    assert body["processed"] == 3
    assert body["events_per_second"] > 0
    assert body["avg_latency_ms"] >= 0
    assert len(body["results"]) == 3


def test_batch_requires_write_role(client):
    res = client.post(
        "/api/v1/process/batch",
        data={"raw": "x"},
        headers=_auth("antoken"),
    )
    assert res.status_code == 403


def test_rate_limit_enforced(client):
    from app.core.ratelimit import set_rate_limit

    set_rate_limit(2)
    headers = _auth("optoken")
    for _ in range(2):
        assert client.post("/api/v1/ingest", data={"raw": "<134>x"}, headers=headers).status_code == 200
    assert client.post("/api/v1/ingest", data={"raw": "<134>x"}, headers=headers).status_code == 429
    set_rate_limit(0)  # restore unlimited