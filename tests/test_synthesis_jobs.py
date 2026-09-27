"""Persistent synthesis jobs: analysis survives navigation.

Covers: job creation, terminal completion with outcome, reconnect via
list/get, idempotent reattach, and guards (unknown drift, resolved drift).
"""

import time

RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny"
MAPPING = {
    "name": "Synth FW",
    "source": "Synth FW",
    "fields": [
        {"input_field": "srcip", "semantic_field": "source.ip"},
        {"input_field": "dstip", "semantic_field": "destination.ip"},
        {"input_field": "proto", "semantic_field": "network.protocol"},
        {"input_field": "action", "semantic_field": "network.action"},
    ],
}


def _drift_for(client, source: str) -> dict:
    mid = client.post("/api/v1/mappings", json={**MAPPING, "source": source, "name": f"M {source}"}).json()["id"]
    from app.core.database import SessionLocal
    from app.models import Mapping

    with SessionLocal() as db:
        db.get(Mapping, mid).status = "published"
        db.commit()
    client.post(
        "/api/v1/ingest",
        data={"raw": RAW.replace("action=deny", "action=deny extra_field=1"), "source": source},
    )
    drifts = [d for d in client.get("/api/v1/drift").json() if d["source"] == source]
    assert drifts, "expected a drift record"
    return drifts[0]


def _wait_terminal(client, job_id: int, deadline_s: float = 60.0) -> dict:
    started = time.monotonic()
    while True:
        job = client.get(f"/api/v1/synthesis/{job_id}").json()
        if job["status"] in ("completed", "failed"):
            return job
        assert time.monotonic() - started < deadline_s, f"job {job_id} stuck: {job}"
        time.sleep(0.5)


def test_synthesis_completes_and_analyses_drift(client):
    drift = _drift_for(client, "SynthJobs-A")
    res = client.post("/api/v1/synthesis", json={"drift_id": drift["id"]})
    assert res.status_code == 201, res.text
    job = res.json()
    assert job["status"] in ("queued", "running", "completed")
    assert job["progress"] >= 0

    final = _wait_terminal(client, job["id"])
    assert final["status"] == "completed", final
    assert final["progress"] == 100
    assert final["result_status"] in ("analyzed", "review", "approved")
    assert final["confidence"] is not None

    detail = client.get(f"/api/v1/drift/{drift['id']}").json()
    assert detail["proposal"], "background analysis must leave the proposal on the drift"


def test_synthesis_reconnect_via_list(client):
    drift = _drift_for(client, "SynthJobs-B")
    job = client.post("/api/v1/synthesis", json={"drift_id": drift["id"]}).json()
    # A different page/tab reconnects through the job list.
    jobs = client.get("/api/v1/synthesis").json()
    mine = [j for j in jobs if j["id"] == job["id"]]
    assert mine and mine[0]["drift_id"] == drift["id"]
    final = _wait_terminal(client, job["id"])
    assert final["status"] == "completed"


def test_synthesis_idempotent_while_active(client):
    # Seed an active job row directly: the reattach branch must return it
    # as-is instead of forking a duplicate analysis.
    drift = _drift_for(client, "SynthJobs-C")
    from app.core.database import SessionLocal
    from app.models import SynthesisJob

    with SessionLocal() as db:
        seeded = SynthesisJob(drift_id=drift["id"], status="queued", stage="queued", progress=0)
        db.add(seeded)
        db.commit()
        db.refresh(seeded)
        seeded_id = seeded.id
    res = client.post("/api/v1/synthesis", json={"drift_id": drift["id"]})
    assert res.status_code == 201, res.text
    assert res.json()["id"] == seeded_id, "active job must be reattached, not forked"


def test_synthesis_unknown_drift_404(client):
    res = client.post("/api/v1/synthesis", json={"drift_id": 999999999})
    assert res.status_code == 404


def test_synthesis_resolved_drift_409(client):
    drift = _drift_for(client, "SynthJobs-D")
    res = client.post(f"/api/v1/drift/{drift['id']}/reject")
    assert res.status_code == 200
    res = client.post("/api/v1/synthesis", json={"drift_id": drift["id"]})
    assert res.status_code == 409


def test_synthesis_job_404(client):
    assert client.get("/api/v1/synthesis/999999999").status_code == 404
