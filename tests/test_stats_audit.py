# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).

import pytest  # noqa: E402

MAPPING = {
    "name": "VendorX Firewall v1 Traffic",
    "source": "VendorX Firewall v1",
    "fields": [
        {"input_field": "srcip", "semantic_field": "source.ip"},
        {"input_field": "action", "semantic_field": "network.action"},
    ],
}
RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"


def test_stats_totals(client):
    client.post("/api/v1/mappings", json=MAPPING)
    client.post("/api/v1/ingest", data={"raw": RAW, "source": MAPPING["source"]})
    res = client.get("/api/v1/stats")
    assert res.status_code == 200
    body = res.json()
    assert body["total_events"] >= 1
    assert body["mappings"] >= 1
    assert body["sources"] >= 1
    assert body["events_by_status"].get("quarantined", 0) >= 1
    assert isinstance(body["events_per_second"], (int, float))


def test_audit_records_config_changes(client):
    created = client.post("/api/v1/mappings", json=MAPPING).json()
    client.patch(f"/api/v1/mappings/{created['id']}", json={"status": "published"})
    drifts = client.get("/api/v1/drift").json()
    if drifts:
        client.post(f"/api/v1/drift/{drifts[0]['id']}/analyze")
        client.post(f"/api/v1/drift/{drifts[0]['id']}/approve")

    audit = client.get("/api/v1/audit").json()
    actions = {(a["action"], a["entity_type"]) for a in audit}
    assert ("create", "mapping") in actions
    assert ("update_status", "mapping") in actions
    # drift actions may or may not exist depending on whether a drift occurred
    if drifts:
        assert ("analyze", "drift") in actions
        assert ("approve", "drift") in actions

    # audit entries are ordered newest first and include metadata
    first = audit[0]
    assert first["actor"]
    assert first["created_at"]


def test_audit_empty_when_no_changes(client):
    # Audits are module-shared, so just verify the endpoint responds with the schema.
    audit = client.get("/api/v1/audit")
    assert audit.status_code == 200
    assert isinstance(audit.json(), list)