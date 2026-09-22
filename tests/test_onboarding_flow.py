# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).

RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny"

FIELDS = [
    {"input_field": "srcip", "semantic_field": "source.ip"},
    {"input_field": "dstip", "semantic_field": "destination.ip"},
    {"input_field": "proto", "semantic_field": "network.protocol"},
    {"input_field": "action", "semantic_field": "network.action"},
]


def _onboard(client, raw=RAW, source_name="Acme FW"):
    created = client.post("/api/v1/onboarding", json={"sample": raw, "source_name": source_name})
    assert created.status_code == 201, created.text
    oid = created.json()["id"]
    assert created.json()["status"] == "pending"
    analyzed = client.post(f"/api/v1/onboarding/{oid}/analyze")
    assert analyzed.status_code == 200, analyzed.text
    assert analyzed.json()["detected_format"] == "syslog"
    assert analyzed.json()["suggestions"]
    return oid


def test_onboarding_full_flow_publishes_recipe(client):
    oid = _onboard(client)
    approved = client.post(
        f"/api/v1/onboarding/{oid}/approve",
        json={"source_name": "Acme FW", "fields": FIELDS},
    )
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["mapping_id"] > 0
    assert body["recipe_id"] > 0

    stored = client.get(f"/api/v1/onboarding/{oid}").json()
    assert stored["status"] == "approved"
    assert stored["source_id"] == body["source_id"]

    mapping = client.get(f"/api/v1/mappings/{body['mapping_id']}").json()
    assert mapping["status"] == "published"
    assert mapping["source"] == "Acme FW"
    assert mapping["source_version_id"] is not None

    # Configure-once: the same source now processes automatically.
    res = client.post("/api/v1/ingest", data={"raw": RAW, "source": "Acme FW"})
    assert res.json()["status"] == "normalized"
    assert res.json()["normalized"]["source"]["ip"] == "10.1.1.5"


def test_onboarding_double_approve_rejected(client):
    oid = _onboard(client)
    first = client.post(f"/api/v1/onboarding/{oid}/approve", json={"source_name": "Acme FW", "fields": FIELDS})
    assert first.status_code == 200
    second = client.post(f"/api/v1/onboarding/{oid}/approve", json={"source_name": "Acme FW", "fields": FIELDS})
    assert second.status_code == 409


def test_onboarding_approve_needs_source(client):
    created = client.post("/api/v1/onboarding", json={"sample": RAW})
    oid = created.json()["id"]
    res = client.post(f"/api/v1/onboarding/{oid}/approve", json={"fields": FIELDS})
    assert res.status_code == 422


def test_onboarding_rejects_empty_sample(client):
    assert client.post("/api/v1/onboarding", json={"sample": "   "}).status_code == 422


def test_second_onboarding_creates_new_version(client):
    oid1 = _onboard(client)
    first = client.post(f"/api/v1/onboarding/{oid1}/approve", json={"source_name": "Acme FW", "fields": FIELDS}).json()
    oid2 = _onboard(client)
    second = client.post(f"/api/v1/onboarding/{oid2}/approve", json={"source_name": "Acme FW", "fields": FIELDS}).json()
    assert second["mapping_id"] != first["mapping_id"]
    versions = client.get(f"/api/v1/catalog/sources/{first['source_id']}/versions").json()
    assert len(versions) >= 2
