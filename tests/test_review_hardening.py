"""Phase 1 hardening: review_pending semantics, mapping-delete guard, heartbeat pressure.

Uses the module-scoped `client` fixture from conftest.py (isolated DB).
Unique sources per test keep the shared module DB from cross-talk;
assertions use deltas, never absolutes.
"""

import time

# --- helpers ---------------------------------------------------------------

BASE_RAW = "<134>Sep 15 10:31:44 fw01 srcip={ip} action=deny"


def _publish_mapping(client, source: str) -> int:
    mapping_id = client.post(
        "/api/v1/mappings",
        json={
            "name": f"Mapping for {source}",
            "source": source,
            "fields": [
                {"input_field": "srcip", "semantic_field": "source.ip"},
                {"input_field": "action", "semantic_field": "network.action"},
            ],
        },
    ).json()["id"]
    patched = client.patch(f"/api/v1/mappings/{mapping_id}", json={"status": "published"})
    assert patched.status_code == 200
    return mapping_id


def _stats(client) -> dict:
    res = client.get("/api/v1/stats")
    assert res.status_code == 200
    return res.json()


def _open_drift_for(client, source: str) -> dict:
    drifts = [d for d in client.get("/api/v1/drift").json() if d["source"] == source]
    assert drifts, f"expected an open drift record for {source}"
    return drifts[0]


# --- review_pending ----------------------------------------------------------

def test_sourceless_quarantine_counts_as_review_pending(client):
    """Quarantine without a drift record must still need operator attention."""
    base = _stats(client)
    res = client.post("/api/v1/ingest", data={"raw": BASE_RAW.format(ip="10.9.9.11")})
    assert res.status_code == 200
    assert res.json()["status"] == "quarantined"
    after = _stats(client)
    assert after["review_pending"] == base["review_pending"] + 1
    # quarantine_pending keeps its legacy meaning: open drift items only.
    assert after["quarantine_pending"] == base["quarantine_pending"]


def test_drift_covered_quarantine_not_double_counted(client):
    """One drifted event = one review item (the drift), not drift + event."""
    source = "ReviewCount-Vendor"
    _publish_mapping(client, source)
    base = _stats(client)
    known = client.post(
        "/api/v1/ingest",
        data={"raw": BASE_RAW.format(ip="10.9.9.12"), "source": source},
    ).json()
    assert known["status"] == "normalized"
    drifted = client.post(
        "/api/v1/ingest",
        data={
            "raw": BASE_RAW.format(ip="10.9.9.12").replace("action=deny", "action=deny extrafield=1"),
            "source": source,
        },
    ).json()
    assert drifted["status"] == "quarantined"
    after = _stats(client)
    assert after["quarantine_pending"] == base["quarantine_pending"] + 1
    assert after["review_pending"] == base["review_pending"] + 1
    by_status = after["events_by_status"]
    assert by_status.get("quarantined", 0) == base["events_by_status"].get("quarantined", 0) + 1


# --- mapping delete guard ----------------------------------------------------

def test_mapping_delete_blocked_with_open_drift(client):
    source = "DeleteGuard-Vendor"
    mapping_id = _publish_mapping(client, source)
    client.post(
        "/api/v1/ingest",
        data={
            "raw": BASE_RAW.format(ip="10.9.9.13").replace("action=deny", "action=deny extrafield=1"),
            "source": source,
        },
    )
    _open_drift_for(client, source)
    res = client.delete(f"/api/v1/mappings/{mapping_id}")
    assert res.status_code == 409
    assert "drift" in res.json()["detail"].lower()
    # Guarded mapping survives.
    assert client.get(f"/api/v1/mappings/{mapping_id}").status_code == 200


def test_resolved_drift_does_not_block_delete_and_history_survives(client):
    source = "DeleteFree-Vendor"
    mapping_id = _publish_mapping(client, source)
    client.post(
        "/api/v1/ingest",
        data={
            "raw": BASE_RAW.format(ip="10.9.9.14").replace("action=deny", "action=deny extrafield=1"),
            "source": source,
        },
    )
    drift = _open_drift_for(client, source)
    assert client.post(f"/api/v1/drift/{drift['id']}/reject").status_code == 200
    assert client.delete(f"/api/v1/mappings/{mapping_id}").status_code == 204
    # History preserved, detached from the deleted mapping.
    detail = client.get(f"/api/v1/drift/{drift['id']}").json()
    assert detail["status"] == "rejected"
    assert detail["mapping_id"] is None


def test_approve_detached_drift_conflicts_but_stays_dismissible(client):
    """Legacy/detached drift (no baseline) must 409 — never 500 — and stay dismissible."""
    from app.core.database import SessionLocal
    from app.models import DriftRecord

    source = "Detached-Vendor"
    _publish_mapping(client, source)
    client.post(
        "/api/v1/ingest",
        data={
            "raw": BASE_RAW.format(ip="10.9.9.15").replace("action=deny", "action=deny extrafield=1"),
            "source": source,
        },
    )
    drift = _open_drift_for(client, source)
    # Simulate a pre-guard orphan: baseline gone, record kept as history.
    with SessionLocal() as db:
        record = db.get(DriftRecord, drift["id"])
        record.mapping_id = None
        db.commit()

    approve = client.post(f"/api/v1/drift/{drift['id']}/approve")
    assert approve.status_code == 409
    assert "no longer exists" in approve.json()["detail"]
    # Still dismissible as noise.
    assert client.post(f"/api/v1/drift/{drift['id']}/reject").status_code == 200


# --- heartbeat pressure ------------------------------------------------------

def test_heartbeat_payload_carries_pressure():
    from app.api.ws import _heartbeat_payload

    payload = _heartbeat_payload()
    assert payload["type"] == "ping"
    assert isinstance(payload["queue_depth"], int)
    assert isinstance(payload["queue_dropped_total"], int)


def test_ws_heartbeat_delivers_pressure(client):
    with client.websocket_connect("/api/v1/ws/live") as ws:
        deadline = time.time() + 25
        while time.time() < deadline:
            msg = ws.receive_json()
            if msg.get("type") == "ping" and "queue_depth" in msg:
                assert isinstance(msg["queue_dropped_total"], int)
                return
        raise AssertionError("no pressure heartbeat received within 25s")
