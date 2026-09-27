"""Semantic field registry: shared vocabulary as data, learned from approvals."""

from semantic_model import SEMANTIC_FIELDS


def test_catalog_seeded_with_builtin_fields(client):
    rows = client.get("/api/v1/semantic-fields").json()
    names = {r["name"] for r in rows}
    assert set(SEMANTIC_FIELDS) <= names
    assert all(r["is_custom"] is False for r in rows if r["name"] in SEMANTIC_FIELDS)


def test_propose_custom_field_and_duplicate_conflicts(client):
    created = client.post(
        "/api/v1/semantic-fields", json={"name": "firewall.rule_id"}
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "firewall.rule_id"
    assert body["is_custom"] is True

    again = client.post("/api/v1/semantic-fields", json={"name": "firewall.rule_id"})
    assert again.status_code == 409
    assert client.post("/api/v1/semantic-fields", json={"name": "   "}).status_code == 422


def test_mapping_create_registers_custom_semantics(client):
    mapping_id = client.post(
        "/api/v1/mappings",
        json={
            "name": "Mapping for Registry-Vendor",
            "source": "Registry-Vendor",
            "fields": [
                {"input_field": "srcip", "semantic_field": "source.ip"},
                {"input_field": "rule", "semantic_field": "custom.registry.probe"},
            ],
        },
    ).json()["id"]
    assert mapping_id
    names = {r["name"] for r in client.get("/api/v1/semantic-fields").json()}
    assert "custom.registry.probe" in names
    entry = next(
        r for r in client.get("/api/v1/semantic-fields").json() if r["name"] == "custom.registry.probe"
    )
    assert entry["is_custom"] is True


def test_drift_approve_registers_custom_semantics(client):
    source = "RegistryDrift-Vendor"
    mapping_id = client.post(
        "/api/v1/mappings",
        json={
            "name": f"Mapping for {source}",
            "source": source,
            "fields": [{"input_field": "srcip", "semantic_field": "source.ip"}],
        },
    ).json()["id"]
    client.patch(f"/api/v1/mappings/{mapping_id}", json={"status": "published"})
    client.post(
        "/api/v1/ingest",
        data={"raw": "<134>Sep 15 10:31:44 fw01 srcip=10.9.9.21", "source": source},
    )
    client.post(
        "/api/v1/ingest",
        data={"raw": "<134>Sep 15 10:31:45 fw01 srcip=10.9.9.21 newfield=1", "source": source},
    )
    drift = next(d for d in client.get("/api/v1/drift").json() if d["source"] == source)
    res = client.post(
        f"/api/v1/drift/{drift['id']}/correct",
        json={"fields": [{"input_field": "newfield", "semantic_field": "custom.drift.probe"}]},
    )
    assert res.status_code == 200, res.text
    names = {r["name"] for r in client.get("/api/v1/semantic-fields").json()}
    assert "custom.drift.probe" in names
