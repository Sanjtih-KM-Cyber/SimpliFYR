# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).
import json


RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny"
MAPPING = {
    "name": "Flywheel FW",
    "source": "Flywheel FW",
    "fields": [
        {"input_field": "srcip", "semantic_field": "source.ip"},
        {"input_field": "dstip", "semantic_field": "destination.ip"},
        {"input_field": "proto", "semantic_field": "network.protocol"},
        {"input_field": "action", "semantic_field": "network.action"},
    ],
}


def _publish(client, mapping_id: int):
    from app.core.database import SessionLocal
    from app.models import Mapping

    with SessionLocal() as db:
        db.get(Mapping, mapping_id).status = "published"
        db.commit()


def _drift_for(client, source: str) -> dict:
    mid = client.post("/api/v1/mappings", json={**MAPPING, "source": source, "name": f"M {source}"}).json()["id"]
    _publish(client, mid)
    client.post(
        "/api/v1/ingest",
        data={"raw": RAW.replace("action=deny", "action=deny extra_field=1"), "source": source},
    )
    drifts = [d for d in client.get("/api/v1/drift").json() if d["source"] == source]
    assert drifts, "expected a drift record"
    # Realistic operator flow: analyze first so the AI proposal is on record.
    analyzed = client.post(f"/api/v1/drift/{drifts[0]['id']}/analyze")
    assert analyzed.status_code == 200
    assert analyzed.json()["proposal"]
    return drifts[0]


def _audit_for(client, entity_type: str, entity_id: int, action: str) -> dict:
    entries = [
        a for a in client.get("/api/v1/audit").json()
        if a["entity_type"] == entity_type and a["entity_id"] == entity_id and a["action"] == action
    ]
    assert entries, f"expected audit {action}/{entity_type}#{entity_id}"
    return entries[0]


def test_drift_correct_audit_captures_proposal_pair(client):
    drift = _drift_for(client, "Pair-Correct")
    client.post(
        f"/api/v1/drift/{drift['id']}/correct",
        json={"fields": [{"input_field": "extra_field", "semantic_field": "event.outcome"}]},
    )
    entry = _audit_for(client, "drift", drift["id"], "correct")
    assert entry["before"] and entry["before"]["proposed"]
    assert entry["after"]["final"]["extra_field"] == "event.outcome"


def test_drift_approve_audit_captures_proposal_pair(client):
    drift = _drift_for(client, "Pair-Approve")
    client.post(f"/api/v1/drift/{drift['id']}/approve")
    entry = _audit_for(client, "drift", drift["id"], "approve")
    assert entry["before"] and entry["before"]["proposed"]
    assert entry["after"]["final"]
    assert entry["after"]["new_mapping_id"]


def test_onboarding_approve_audit_captures_proposal_pair(client):
    created = client.post("/api/v1/onboarding", json={"sample": RAW, "source_name": "Pair-Onboard"}).json()
    analyzed = client.post(f"/api/v1/onboarding/{created['id']}/analyze").json()
    assert analyzed["suggestions"]
    approved = client.post(
        f"/api/v1/onboarding/{created['id']}/approve",
        json={
            "source_name": "Pair-Onboard",
            "fields": [
                {"input_field": "srcip", "semantic_field": "source.ip"},
                {"input_field": "dstip", "semantic_field": "destination.ip"},
                {"input_field": "proto", "semantic_field": "network.protocol"},
                {"input_field": "action", "semantic_field": "network.action"},
            ],
        },
    )
    assert approved.status_code == 200
    entry = _audit_for(client, "onboarding", created["id"], "approve")
    assert entry["before"] and entry["before"]["proposed"]
    assert entry["after"]["final"]["srcip"] == "source.ip"


def test_export_training_returns_jsonl_with_splits(client):
    drift = _drift_for(client, "Pair-Export")
    client.post(
        f"/api/v1/drift/{drift['id']}/correct",
        json={"fields": [{"input_field": "extra_field", "semantic_field": "event.outcome"}]},
    )
    res = client.get("/api/v1/system/export-training?limit=50")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/x-ndjson")
    records = [json.loads(line) for line in res.text.strip().splitlines()]
    assert records, "expected at least synthetic records"
    kinds = {r["meta"]["kind"] for r in records}
    assert "drift-correct" in kinds
    assert "synthetic" in kinds
    for record in records:
        assert record["instruction"] and record["input"] and record["output"]
        assert record["meta"]["split"] in ("train", "val")
        out = json.loads(record["output"])
        assert out["suggestions"] and all(s["input_field"] for s in out["suggestions"])
    splits = {r["meta"]["split"] for r in records}
    assert splits == {"train", "val"}  # deterministic split covers both


def test_export_training_respects_limit(client):
    res = client.get("/api/v1/system/export-training?limit=3")
    assert len(res.text.strip().splitlines()) == 3


def test_ollama_propose_mapping_is_bound_method():
    import types as pytypes

    from app.core.ai.ollama import OllamaAIProvider

    assert isinstance(OllamaAIProvider.__dict__["propose_mapping"], pytypes.FunctionType)
    assert "propose_mapping" in OllamaAIProvider.__dict__


def test_ollama_validation_rejects_bad_shapes():
    import pytest

    from app.core.ai.ollama import _validate_response

    # Entries without input_field are noise: dropped, not fatal.
    dropped = _validate_response(
        {"suggestions": [{"semantic_field": "source.ip"}, {"input_field": "", "confidence": 0}]}
    )
    assert dropped["suggestions"] == []
    with pytest.raises(ValueError):
        _validate_response({"suggestions": [{"input_field": "x", "confidence": 9.0}]})
    with pytest.raises(ValueError):
        _validate_response({"suggestions": "nope"})
    good = _validate_response(
        {"suggestions": [{"input_field": "src", "semantic_field": "source.ip", "confidence": 0.9}],
         "renamed_from": {}, "explanation": "ok"}
    )
    assert good["suggestions"][0]["input_field"] == "src"


def test_safe_wrappers_fall_back_to_heuristic(monkeypatch):
    from app.core.ai import provider as provider_mod

    class ExplodingProvider:
        def analyze_drift(self, **kwargs):
            raise RuntimeError("llm down")

        def propose_mapping(self, **kwargs):
            raise RuntimeError("llm down")

    monkeypatch.setattr(provider_mod, "_provider", ExplodingProvider())
    drift = provider_mod.analyze_drift_safe(
        source="S", new_fields={"src"}, missing_fields=set(), known_semantics={}, sample="src=1"
    )
    assert drift.new_field_suggestions
    mapping = provider_mod.propose_mapping_safe(source="S", field_map={"src": "1"}, sample="src=1")
    assert mapping.new_field_suggestions
    provider_mod.reset_provider()
