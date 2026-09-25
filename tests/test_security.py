# Single-user tool: the API is open (no accounts, no roles). These tests pin
# that posture — everything reachable without tokens — plus the remaining
# infrastructure guards (rate limiting, secret-free config).
# Uses the module-scoped `client` fixture from conftest.py.

MAPPING = {
    "name": "VendorX Firewall v1 Traffic",
    "source": "VendorX Firewall v1",
    "fields": [
        {"input_field": "srcip", "semantic_field": "source.ip"},
        {"input_field": "action", "semantic_field": "network.action"},
    ],
}


def test_api_is_open_without_tokens(client):
    assert client.get("/api/v1/health").status_code == 200
    assert client.get("/api/v1/events").status_code == 200
    assert client.get("/api/v1/stats").status_code == 200
    res = client.post("/api/v1/mappings", json=MAPPING)
    assert res.status_code == 201


def test_config_excludes_secrets(client):
    body = client.get("/api/v1/config").json()
    assert "api_keys" not in body
    assert "token" not in str(body).lower()


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
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 3
    assert body["processed"] == 3
    assert body["events_per_second"] > 0
    assert body["avg_latency_ms"] >= 0
    assert len(body["results"]) == 3


def test_rate_limit_enforced(client):
    from app.core.ratelimit import set_rate_limit

    set_rate_limit(2)
    try:
        for _ in range(2):
            assert client.post("/api/v1/ingest", data={"raw": "<134>x"}).status_code == 200
        assert client.post("/api/v1/ingest", data={"raw": "<134>x"}).status_code == 429
    finally:
        set_rate_limit(0)  # restore unlimited
