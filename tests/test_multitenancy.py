# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).

MAPPING = {
    "name": "MT FW v1",
    "source": "MT FW v1",
    "fields": [
        {"input_field": "srcip", "semantic_field": "source.ip"},
        {"input_field": "action", "semantic_field": "network.action"},
    ],
}


def _publish(client, mapping_id: int):
    from app.core.database import SessionLocal
    from app.models import Mapping

    with SessionLocal() as db:
        db.get(Mapping, mapping_id).status = "published"
        db.commit()


def test_default_environment_seeded(client):
    envs = client.get("/api/v1/environments").json()
    assert any(e["name"] == "Default" for e in envs)


def test_create_environment(client):
    res = client.post("/api/v1/environments", json={"name": "Prod", "description": "prod"})
    assert res.status_code == 201
    assert res.json()["name"] == "Prod"
    assert client.post("/api/v1/environments", json={"name": "Prod"}).status_code == 409


def test_events_isolated_by_environment(client):
    mid = client.post("/api/v1/mappings", json=MAPPING).json()["id"]
    _publish(client, mid)

    hdr_a = {"X-Environment": "env-a"}
    hdr_b = {"X-Environment": "env-b"}
    # Distinct payloads: identical replays are idempotent (dedup) by design.
    client.post("/api/v1/ingest", data={"raw": "<134>Sep 15 10:00:00 fw srcip=10.0.0.1 action=deny", "source": MAPPING["source"]}, headers=hdr_a)
    client.post("/api/v1/ingest", data={"raw": "<134>Sep 15 10:00:00 fw srcip=10.0.0.1 action=deny", "source": MAPPING["source"]}, headers=hdr_b)
    client.post("/api/v1/ingest", data={"raw": "<134>Sep 15 10:00:01 fw srcip=10.0.0.2 action=deny", "source": MAPPING["source"]}, headers=hdr_a)

    a = client.get("/api/v1/events", headers=hdr_a).json()
    b = client.get("/api/v1/events", headers=hdr_b).json()
    default = client.get("/api/v1/events").json()
    assert len(a) == 2
    assert len(b) == 1
    assert len(default) == 0


def test_stats_scoped_by_environment(client):
    mid = client.post("/api/v1/mappings", json=MAPPING).json()["id"]
    _publish(client, mid)
    raw = "<134>Sep 15 10:00:00 fw srcip=10.0.0.1 action=deny"
    client.post("/api/v1/ingest", data={"raw": raw, "source": MAPPING["source"]}, headers={"X-Environment": "env-s"})

    stats = client.get("/api/v1/stats", headers={"X-Environment": "env-s"}).json()
    assert stats["total_events"] >= 1
    assert client.get("/api/v1/stats").json()["total_events"] == 0


def test_analytics_scoped_by_environment(client):
    mid = client.post("/api/v1/mappings", json=MAPPING).json()["id"]
    _publish(client, mid)
    raw = "<134>Sep 15 10:00:00 fw srcip=10.5.0.1 action=deny"
    client.post("/api/v1/ingest", data={"raw": raw, "source": MAPPING["source"]}, headers={"X-Environment": "env-x"})

    in_env = client.get(
        "/api/v1/analytics/search",
        params=[("filter", "source.ip=10.5.0.1")],
        headers={"X-Environment": "env-x"},
    ).json()
    other = client.get(
        "/api/v1/analytics/search",
        params=[("filter", "source.ip=10.5.0.1")],
        headers={"X-Environment": "env-y"},
    ).json()
    assert len(in_env) == 1
    assert len(other) == 0


def test_knowledge_lists_isolated_by_environment(client):
    mid = client.post("/api/v1/mappings", json=MAPPING).json()["id"]
    _publish(client, mid)
    client.post(
        "/api/v1/recipes", json={"source": MAPPING["source"], "mapping_id": mid}
    )

    other = {"X-Environment": "other-tenant"}
    assert client.get("/api/v1/mappings", headers=other).json() == []
    assert client.get("/api/v1/recipes", headers=other).json() == []
    assert len(client.get("/api/v1/mappings").json()) >= 1
    assert len(client.get("/api/v1/recipes").json()) >= 1


def test_drift_list_isolated_by_environment(client):
    mid = client.post("/api/v1/mappings", json=MAPPING).json()["id"]
    _publish(client, mid)
    hdr = {"X-Environment": "drift-tenant"}
    client.post(
        "/api/v1/ingest",
        data={"raw": "<134>Sep 15 10:00:00 fw srcip=10.0.0.9 action=deny brand_new_field=1", "source": MAPPING["source"]},
        headers=hdr,
    )
    mine = client.get("/api/v1/drift", headers=hdr).json()
    assert len(mine) >= 1
    alien = client.get("/api/v1/drift", headers={"X-Environment": "unrelated"}).json()
    assert all(d["source"] != MAPPING["source"] for d in alien)


def test_metrics_endpoint(client):
    client.post("/api/v1/mappings", json=MAPPING)
    res = client.get("/api/v1/metrics")
    assert res.status_code == 200
    text = res.text
    assert "simplifyr_events_total" in text
    assert "simplifyr_mappings_total" in text


def test_config_export_import(client):
    client.post("/api/v1/mappings", json=MAPPING)
    export = client.get("/api/v1/system/export").json()
    assert export["mappings"]
    assert export["environments"]

    # Import on a fresh environment (isolated module DB already has data; verify idempotent).
    imported = client.post("/api/v1/system/import", json=export)
    assert imported.status_code == 200
    assert imported.json()["mappings"] == 0  # all already exist