RAW_OK = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"
MAPPING = {
    "name": "VendorX Firewall v1 Traffic",
    "source": "VendorX Firewall v1",
    "fields": [
        {"input_field": "srcip", "semantic_field": "source.ip"},
        {"input_field": "action", "semantic_field": "network.action"},
    ],
}


def test_connections_empty(client):
    res = client.get("/api/v1/connections")
    assert res.status_code == 200
    assert res.json() == []


def test_connection_aggregate_healthy(client):
    created = client.post("/api/v1/mappings", json=MAPPING).json()
    client.patch(f"/api/v1/mappings/{created['id']}", json={"status": "published"})
    client.post("/api/v1/ingest", data={"raw": RAW_OK, "source": MAPPING["source"]})

    res = client.get("/api/v1/connections")
    assert res.status_code == 200
    conn = next(c for c in res.json() if c["name"] == MAPPING["source"])
    assert conn["id"] == MAPPING["source"]
    assert conn["events_processed"] >= 1
    assert conn["normalization_rate"] == 1.0
    assert conn["mapping"]["id"] == created["id"]
    assert conn["mapping"]["status"] == "published"
    assert conn["health"] == "healthy"
    assert conn["needs_review"] == 0
    assert conn["last_event_at"] is not None
    assert conn["avg_latency_ms"] >= 0


def test_connection_aggregate_needs_review(client):
    # Unknown source: quarantined with no mapping attached.
    client.post("/api/v1/ingest", data={"raw": "something unrecognized", "source": "Unknown Box"})

    conns = client.get("/api/v1/connections").json()
    conn = next(c for c in conns if c["name"] == "Unknown Box")
    assert conn["mapping"] is None
    assert conn["health"] == "needs_review"
    assert conn["needs_review"] >= 1


def test_needs_review_surfaces_first(client):
    conns = client.get("/api/v1/connections").json()
    active = [c for c in conns if c["health"] != "idle"]
    if active:
        assert active[0]["health"] == "needs_review"


def test_connection_detail(client):
    res = client.get(f"/api/v1/connections/{MAPPING['source']}")
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == MAPPING["source"]
    assert body["events_processed"] >= 1
    assert len(body["recent_events"]) >= 1
    assert body["recent_events"][0]["status"] in ("normalized", "output")
    assert body["created_at"] is not None


def test_connection_detail_unknown_404(client):
    res = client.get("/api/v1/connections/does-not-exist")
    assert res.status_code == 404
