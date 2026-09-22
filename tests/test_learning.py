import pytest

from app.core.config import settings

OLD_RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny"
DRIFTED_RAW = "<134>Sep 15 10:31:45 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp decision=drop"
LOW_CONF_RAW = "<134>Sep 15 10:31:46 fw01 srcip=10.1.1.5 zzzqqq=mystery"


def _mapping_payload(source: str) -> dict:
    return {
        "name": f"Mapping for {source}",
        "source": source,
        "fields": [
            {"input_field": "srcip", "semantic_field": "source.ip"},
            {"input_field": "dstip", "semantic_field": "destination.ip"},
            {"input_field": "proto", "semantic_field": "network.protocol"},
            {"input_field": "action", "semantic_field": "network.action"},
        ],
    }


def _publish(client, mapping_id: int):
    from app.core.database import SessionLocal
    from app.models import Mapping as MappingModel

    with SessionLocal() as db:
        db.get(MappingModel, mapping_id).status = "published"
        db.commit()


def _setup_source(client, source: str) -> str:
    mapping_id = client.post("/api/v1/mappings", json=_mapping_payload(source)).json()["id"]
    _publish(client, mapping_id)
    return source


def _ingest(client, source: str, raw: str) -> dict:
    res = client.post("/api/v1/ingest", data={"raw": raw, "source": source})
    assert res.status_code == 200
    return res.json()


def _ingest_and_get_drift(client, source: str, raw: str = DRIFTED_RAW) -> dict:
    body = _ingest(client, source, raw)
    assert body["status"] == "quarantined"
    return client.get("/api/v1/drift").json()[0]


def test_analyze_medium_confidence_flagged_for_review(client):
    source = _setup_source(client, "Conf-Med-A")
    drift = _ingest_and_get_drift(client, source)
    res = client.post(f"/api/v1/drift/{drift['id']}/analyze")
    assert res.status_code == 200
    body = res.json()
    assert body["confidence"] >= 0.5
    assert body["status"] == "analyzed"


def test_analyze_low_confidence_needs_input(client):
    source = _setup_source(client, "Conf-Low-B")
    drift = _ingest_and_get_drift(client, source, LOW_CONF_RAW)
    res = client.post(f"/api/v1/drift/{drift['id']}/analyze")
    assert res.status_code == 200
    body = res.json()
    assert body["confidence"] < 0.5
    assert body["status"] == "review"


def test_correct_publishes_version_and_reprocesses(client):
    source = _setup_source(client, "Correct-C")
    _ingest(client, source, OLD_RAW)
    drift = _ingest_and_get_drift(client, source)

    res = client.post(
        f"/api/v1/drift/{drift['id']}/correct",
        json={"fields": [{"input_field": "decision", "semantic_field": "event.outcome"}]},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["new_mapping_version"] == 2
    assert body["reprocessed_events"] >= 1

    mappings = client.get("/api/v1/mappings").json()
    newest = max((m for m in mappings if m["source"] == source), key=lambda m: m["version"])
    assert newest["version"] == 2
    corrected = next(f for f in newest["fields"] if f["input_field"] == "decision")
    assert corrected["semantic_field"] == "event.outcome"
    assert corrected["confidence"] == 1.0

    detail = client.get(f"/api/v1/drift/{drift['id']}").json()
    assert detail["status"] == "approved"
    assert detail["resolved_at"] is not None

    audit = client.get("/api/v1/audit").json()
    assert any(a["action"] == "correct" and a["entity_type"] == "drift" for a in audit)


def test_correct_requires_semantic_fields(client):
    source = _setup_source(client, "Correct-D")
    drift = _ingest_and_get_drift(client, source)
    res = client.post(
        f"/api/v1/drift/{drift['id']}/correct",
        json={"fields": [{"input_field": "decision", "semantic_field": "  "}]},
    )
    assert res.status_code == 422


def test_ignore_resolves_without_mapping_change(client):
    source = _setup_source(client, "Ignore-E")
    _ingest(client, source, OLD_RAW)
    drift = _ingest_and_get_drift(client, source)

    res = client.post(f"/api/v1/drift/{drift['id']}/ignore")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ignored"
    assert body["resolved_at"] is not None

    mappings = client.get("/api/v1/mappings").json()
    assert max((m["version"] for m in mappings if m["source"] == source), default=1) == 1

    audit = client.get("/api/v1/audit").json()
    assert any(a["action"] == "ignore" and a["entity_type"] == "drift" for a in audit)


def test_ignore_conflicts_after_resolution(client):
    source = _setup_source(client, "Ignore-F")
    drift = _ingest_and_get_drift(client, source)
    client.post(f"/api/v1/drift/{drift['id']}/approve")
    assert client.post(f"/api/v1/drift/{drift['id']}/ignore").status_code == 409


def test_auto_apply_high_confidence(client):
    source = _setup_source(client, "Auto-G")
    _ingest(client, source, OLD_RAW)
    drift = _ingest_and_get_drift(client, source)
    assert drift["status"] == "detected"

    monkeypatch_enabled = settings.ai_auto_apply
    settings.ai_auto_apply = True
    try:
        from app.core.drift import _run_automation_sync

        _run_automation_sync(drift["id"])
    finally:
        settings.ai_auto_apply = monkeypatch_enabled

    body = client.get(f"/api/v1/drift/{drift['id']}").json()
    assert body["status"] == "approved"
    assert body["confidence"] >= 0.9

    mappings = client.get("/api/v1/mappings").json()
    newest = max((m for m in mappings if m["source"] == source), key=lambda m: m["version"])
    assert newest["version"] == 2
    assert any(f["input_field"] == "decision" for f in newest["fields"])

    normalized = client.get("/api/v1/events", params={"status": "normalized"}).json()
    assert any(e["source"] == source for e in normalized)

    audit = client.get("/api/v1/audit").json()
    assert any(a["action"] == "auto_apply" and a["entity_type"] == "drift" for a in audit)


def test_auto_apply_low_confidence_not_applied(client):
    source = _setup_source(client, "Auto-H")
    drift = _ingest_and_get_drift(client, source, LOW_CONF_RAW)

    enabled_before = settings.ai_auto_apply
    settings.ai_auto_apply = True
    try:
        from app.core.drift import _run_automation_sync

        _run_automation_sync(drift["id"])
    finally:
        settings.ai_auto_apply = enabled_before

    body = client.get(f"/api/v1/drift/{drift['id']}").json()
    assert body["status"] == "review"
    assert client.get("/api/v1/mappings").json()[-1]["version"] == 1


def test_no_automation_when_disabled(client):
    source = _setup_source(client, "Auto-Off-I")
    drift = _ingest_and_get_drift(client, source)
    assert settings.ai_auto_apply is False
    assert drift["status"] == "detected"


def test_config_exposes_learning_settings(client):
    body = client.get("/api/v1/config").json()
    assert body["ai_auto_apply"] is False
    assert body["ai_auto_apply_threshold"] == 0.9
    assert body["ai_review_threshold"] == 0.5


@pytest.fixture(autouse=True)
def _restore_settings():
    yield
    settings.ai_auto_apply = False
