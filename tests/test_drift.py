# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).

OLD_RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny"
DRIFTED_RAW = "<134>Sep 15 10:31:45 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp decision=drop"


def _mapping_payload(source: str) -> dict:
    return {
        "name": f"Mapping for {source}",
        "source": source,
        "fields": [
            {"input_field": "srcip", "semantic_field": "source.ip"},
            {"input_field": "dstip", "semantic_field": "destination.ip"},
            {"input_field": "proto", "semantic_field": "network.protocol"},
            {
                "input_field": "action",
                "semantic_field": "network.action",
                "transformation": {"deny": "BLOCKED", "allow": "ALLOWED"},
            },
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


def _ingest_and_get_drift(client, source: str) -> dict:
    body = _ingest(client, source, DRIFTED_RAW)
    assert body["status"] == "quarantined"
    drift = client.get("/api/v1/drift").json()[0]
    return drift


def test_known_event_normalized_no_drift(client):
    source = _setup_source(client, "NoDrift-Vendor-A")
    body = _ingest(client, source, OLD_RAW)
    assert body["status"] == "normalized"
    assert body["normalized"]["network"]["action"] == "BLOCKED"


def test_drift_detected_on_structure_change(client):
    source = _setup_source(client, "Drift-Vendor-B")
    _ingest(client, source, OLD_RAW)  # baseline: no drift
    drift = _ingest_and_get_drift(client, source)
    assert drift["status"] == "detected"
    assert "decision" in drift["new_fields"]
    assert "action" in drift["missing_fields"]


def test_analyze_produces_heuristic_proposal(client):
    source = _setup_source(client, "Analyze-Vendor-C")
    drift = _ingest_and_get_drift(client, source)
    res = client.post(f"/api/v1/drift/{drift['id']}/analyze")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "analyzed"
    assert body["confidence"] > 0
    suggestions = body["proposal"]["new_field_suggestions"]
    decision = next(s for s in suggestions if s["input_field"] == "decision")
    assert decision["semantic_field"] == "network.action"
    assert decision["confidence"] > 0.8


def test_approve_publishes_version_and_reprocesses(client):
    source = _setup_source(client, "Approve-Vendor-D")
    _ingest(client, source, OLD_RAW)
    drift = _ingest_and_get_drift(client, source)
    res = client.post(f"/api/v1/drift/{drift['id']}/approve")
    assert res.status_code == 200
    body = res.json()
    assert body["new_mapping_version"] == 2
    assert body["reprocessed_events"] >= 1

    mappings = client.get("/api/v1/mappings").json()
    newest = max((m for m in mappings if m["source"] == source), key=lambda m: m["version"])
    assert newest["version"] == 2
    assert any(f["input_field"] == "decision" for f in newest["fields"])
    assert any(f["semantic_field"] == "network.action" for f in newest["fields"])

    # The previously quarantined drifted event was reprocessed to normalized.
    normalized = client.get("/api/v1/events", params={"status": "normalized"}).json()
    assert any(e["source"] == source for e in normalized)


def test_drift_reject_leaves_event_quarantined(client):
    source = _setup_source(client, "Reject-Vendor-E")
    drift = _ingest_and_get_drift(client, source)
    res = client.post(f"/api/v1/drift/{drift['id']}/reject")
    assert res.status_code == 200
    assert res.json()["status"] == "rejected"

    events = client.get("/api/v1/events", params={"status": "quarantined"}).json()
    assert any(e["source"] == source for e in events)


def test_drift_not_found(client):
    assert client.get("/api/v1/drift/99999").status_code == 404
    assert client.post("/api/v1/drift/99999/analyze").status_code == 404
    assert client.post("/api/v1/drift/99999/approve").status_code == 404


def test_same_shape_drift_merges_into_one_record(client):
    """100 anomalies, 2 new parameters -> items per field-shape, not per event."""
    source = _setup_source(client, "Box-Merge")
    first = _ingest(client, source, DRIFTED_RAW)
    second = _ingest(
        client,
        source,
        DRIFTED_RAW.replace("10:31:45", "10:31:46").replace("10.1.1.5", "10.1.1.9"),
    )
    assert first["status"] == "quarantined"
    assert second["status"] == "quarantined"
    assert first["stored_event_id"] != second["stored_event_id"]

    mine = [d for d in client.get("/api/v1/drift").json() if d["source"] == source]
    assert len(mine) == 1, mine
    detail = client.get(f"/api/v1/drift/{mine[0]['id']}").json()
    assert detail["new_fields"] == ["decision"]
    assert len(detail["event_ids"]) == 2


def test_different_shape_drift_stays_separate(client):
    source = _setup_source(client, "Box-Split")
    _ingest(client, source, DRIFTED_RAW)
    _ingest(client, source, DRIFTED_RAW.replace("proto=tcp", "proto=tcp extrafield=1"))
    mine = [d for d in client.get("/api/v1/drift").json() if d["source"] == source]
    assert len(mine) == 2, mine
    shapes = sorted(tuple(d["new_fields"]) for d in mine)
    assert shapes == [("decision",), ("decision", "extrafield")], shapes


def test_export_shaped_payload_creates_no_junk_drift(client):
    """Re-ingesting an exported event must not read wrapper keys as fields."""
    import json

    source = _setup_source(client, "Box-ExportLoop")
    exported = {
        "id": 1,
        "event_id": "abc",
        "status": "normalized",
        "received_at": "2026-09-24T00:00:00+00:00",
        "source": source,
        "source_id": 9,
        "raw_hash": "x",
        "raw_ref": None,
        "raw": "srcip=10.0.0.1 action=deny",
        "parsed": {"fields": {"srcip": "10.0.0.1"}},
        "normalized": {"source": {"ip": "10.0.0.1"}},
        "output": None,
        "provenance": {},
        "views": {"raw": "srcip=10.0.0.1 action=deny"},
    }
    body = _ingest(client, source, json.dumps(exported))
    assert body["status"] in ("quarantined", "normalized", "output", "dlq"), body
    internals = {
        "normalized", "output", "parsed", "provenance", "raw_hash",
        "raw_ref", "status", "views", "source", "source_id",
    }
    for d in client.get("/api/v1/drift").json():
        if d["source"] != source:
            continue
        assert not (set(d["new_fields"]) & internals), d