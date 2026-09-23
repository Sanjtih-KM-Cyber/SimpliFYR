# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).

RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny"
MAPPING = {
    "name": "Preview FW",
    "source": "Preview FW",
    "fields": [
        {"input_field": "srcip", "semantic_field": "source.ip"},
        {"input_field": "dstip", "semantic_field": "destination.ip"},
        {"input_field": "proto", "semantic_field": "network.protocol"},
        {"input_field": "action", "semantic_field": "network.action"},
    ],
}


def test_preview_detects_without_storing(client):
    before = client.get("/api/v1/stats").json()["total_events"]
    res = client.post("/api/v1/ingest/preview", data={"raw": RAW})
    assert res.status_code == 200
    body = res.json()
    assert body["detection"]["format"] == "syslog"
    assert body["parsed"]["fields"]["srcip"] == "10.1.1.5"
    assert "stored_event_id" not in body
    after = client.get("/api/v1/stats").json()["total_events"]
    assert after == before


def test_preview_rejects_empty(client):
    assert client.post("/api/v1/ingest/preview", data={"raw": "   "}).status_code == 422


def test_connection_exposes_open_drift(client):
    mid = client.post("/api/v1/mappings", json=MAPPING).json()["id"]
    from app.core.database import SessionLocal
    from app.models import Mapping

    with SessionLocal() as db:
        db.get(Mapping, mid).status = "published"
        db.commit()
    client.post("/api/v1/ingest", data={"raw": RAW, "source": MAPPING["source"]})
    conn = next(
        c for c in client.get("/api/v1/connections").json() if c["name"] == MAPPING["source"]
    )
    assert conn["open_drift"] == 0

    client.post(
        "/api/v1/ingest",
        data={"raw": RAW.replace("action=deny", "action=deny extra_field=1"), "source": MAPPING["source"]},
    )
    conn = next(
        c for c in client.get("/api/v1/connections").json() if c["name"] == MAPPING["source"]
    )
    assert conn["open_drift"] == 1
    assert conn["needs_review"] >= 1


def test_quarantine_pending_counts_review_status(client):
    mid = client.post("/api/v1/mappings", json=MAPPING).json()["id"]
    from app.core.database import SessionLocal
    from app.models import DriftRecord, Mapping

    with SessionLocal() as db:
        db.get(Mapping, mid).status = "published"
        db.commit()
    client.post(
        "/api/v1/ingest",
        data={"raw": RAW.replace("action=deny", "action=deny extra_field=1"), "source": MAPPING["source"]},
    )
    drift = next(
        d for d in client.get("/api/v1/drift").json() if d["source"] == MAPPING["source"]
    )
    client.post(f"/api/v1/drift/{drift['id']}/analyze")
    # Heuristic confidence lands some proposals in "review" — either way the
    # pending counter must include every open status.
    with SessionLocal() as db:
        db.get(DriftRecord, drift["id"]).status = "review"
        db.commit()
    stats = client.get("/api/v1/stats").json()
    assert stats["quarantine_pending"] >= 1
