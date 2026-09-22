import pathlib

import pytest

# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).


def test_ingest_raw_syslog(client):
    res = client.post(
        "/api/v1/ingest",
        data={"raw": "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["detection"]["format"] == "syslog"
    assert body["detection"]["confidence"] > 0.8
    assert body["envelope"]["event_id"]
    assert body["envelope"]["raw_payload"].startswith("<134>")
    assert isinstance(body["stored_event_id"], int)
    assert body["parsed"]["hostname"] == "fw01"
    assert body["parsed"]["fields"]["srcip"] == "10.1.1.5"
    # No known mapping for this source -> preserved and quarantined (fail-safe).
    assert body["status"] == "quarantined"
    assert body["normalized"] is None


def test_ingest_quarantines_unknown_source(client):
    res = client.post(
        "/api/v1/ingest",
        data={"raw": "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny", "source": "UnknownVendor"},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "quarantined"


def test_ingest_file_json(client):
    files = {"file": ("fw.json", b'{"src": "10.1.1.5", "action": "deny"}', "application/json")}
    res = client.post("/api/v1/ingest", files=files)
    assert res.status_code == 200
    body = res.json()
    assert body["detection"]["format"] == "json"
    assert body["parsed"]["src"] == "10.1.1.5"
    assert body["status"] == "quarantined"


def test_ingest_with_hint(client):
    res = client.post(
        "/api/v1/ingest",
        data={"raw": "srcip=1.2.3.4", "hint": "cef"},
    )
    assert res.status_code == 200
    assert res.json()["detection"]["format"] == "cef"


def test_ingest_requires_payload(client):
    assert client.post("/api/v1/ingest").status_code == 422


def test_ingest_rejects_oversized(client):
    res = client.post("/api/v1/ingest", data={"raw": "x" * 2_000_000})
    assert res.status_code == 413


FIREWALL_MAPPING = {
    "name": "VendorX Firewall v1 Traffic",
    "source": "VendorX Firewall v1",
    "fields": [
        {"input_field": "srcip", "semantic_field": "source.ip"},
        {"input_field": "dstip", "semantic_field": "destination.ip"},
        {"input_field": "proto", "semantic_field": "network.protocol"},
        {
            "input_field": "action",
            "semantic_field": "network.action",
            "transformation": {"deny": "BLOCKED", "allow": "ALLOWED"},
        },
        {"input_field": "user", "semantic_field": "identity.user"},
    ],
}


def test_create_and_get_mapping(client):
    created = client.post("/api/v1/mappings", json=FIREWALL_MAPPING)
    assert created.status_code == 201
    body = created.json()
    assert body["status"] == "draft"
    assert len(body["fields"]) == 5

    fetched = client.get(f"/api/v1/mappings/{body['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["name"] == FIREWALL_MAPPING["name"]

    listed = client.get("/api/v1/mappings")
    assert listed.status_code == 200
    assert any(m["id"] == body["id"] for m in listed.json())


def test_get_mapping_not_found(client):
    assert client.get("/api/v1/mappings/99999").status_code == 404


def test_ingest_normalizes_with_mapping(client):
    mapping_id = client.post("/api/v1/mappings", json=FIREWALL_MAPPING).json()["id"]
    res = client.post(
        "/api/v1/ingest",
        data={
            "raw": "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny",
            "mapping_id": str(mapping_id),
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "normalized"
    assert body["normalized"]["source"]["ip"] == "10.1.1.5"
    assert body["normalized"]["destination"]["ip"] == "8.8.8.8"
    assert body["normalized"]["network"]["action"] == "BLOCKED"
    assert body["provenance"]["mapping"]["id"] == mapping_id
    assert body["provenance"]["fields"]["network.action"]["input_field"] == "action"


def test_ingest_mapping_not_found(client):
    res = client.post(
        "/api/v1/ingest",
        data={"raw": "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5", "mapping_id": "99999"},
    )
    assert res.status_code == 404


def test_output_profiles_seeded(client):
    profiles = client.get("/api/v1/output-profiles").json()
    names = {p["name"] for p in profiles}
    assert "SOC Investigation" in names
    assert "SIEM" in names
    assert "Machine Learning" in names
    assert all(p["is_preset"] for p in profiles if p["name"] in names - {"Custom"})


def test_create_custom_output_profile(client):
    res = client.post(
        "/api/v1/output-profiles",
        json={
            "name": "Custom Secops",
            "fields": [
                {"output_field": "src_ip", "from_semantic": "source.ip"},
                {"output_field": "decision", "from_semantic": "network.action"},
            ],
        },
    )
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "Custom Secops"
    assert body["is_preset"] is False
    assert body["profile_schema"]["fields"][0]["output_field"] == "src_ip"


def test_ingest_full_pipeline_with_output_profile(client):
    mapping_id = client.post("/api/v1/mappings", json=FIREWALL_MAPPING).json()["id"]
    soc_id = next(
        p["id"] for p in client.get("/api/v1/output-profiles").json() if p["name"] == "SOC Investigation"
    )
    res = client.post(
        "/api/v1/ingest",
        data={
            "raw": "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny user=tjones",
            "mapping_id": str(mapping_id),
            "output_profile_id": str(soc_id),
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "output"
    assert body["normalized"]["network"]["action"] == "BLOCKED"
    out = body["output"]
    assert out["source"]["ip"] == "10.1.1.5"
    assert out["destination"]["ip"] == "8.8.8.8"
    assert out["network"]["action"] == "BLOCKED"
    assert out["identity"]["user"] == "tjones"


def test_ingest_output_profile_not_found(client):
    mapping_id = client.post("/api/v1/mappings", json=FIREWALL_MAPPING).json()["id"]
    res = client.post(
        "/api/v1/ingest",
        data={
            "raw": "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5",
            "mapping_id": str(mapping_id),
            "output_profile_id": "99999",
        },
    )
    assert res.status_code == 404


def test_events_persisted(client):
    from sqlalchemy import select
    from app.core.database import SessionLocal
    from app.models import Event

    with SessionLocal() as db:
        events = db.execute(select(Event)).scalars().all()
        assert len(events) >= 3
        for ev in events:
            assert ev.raw
            assert ev.status in ("received", "parsed", "normalized", "output", "quarantined")
            assert len(ev.raw_hash) == 64
        assert any(ev.status == "quarantined" and ev.parsed for ev in events)
        assert any(ev.status == "normalized" and ev.normalized and ev.provenance for ev in events)
        assert any(ev.status == "output" and ev.output for ev in events)


def test_auto_resolves_mapping_by_source(client):
    from app.core.database import SessionLocal
    from app.models import Mapping as MappingModel

    created = client.post("/api/v1/mappings", json=FIREWALL_MAPPING).json()
    with SessionLocal() as db:
        m = db.get(MappingModel, created["id"])
        m.status = "published"
        db.commit()

    res = client.post(
        "/api/v1/ingest",
        data={"raw": SYSLOG_RAW, "source": FIREWALL_MAPPING["source"]},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "normalized"
    assert body["normalized"]["network"]["action"] == "BLOCKED"


def test_onboarding_analyze_suggests_mapping(client):
    res = client.post(
        "/api/v1/onboarding/analyze",
        data={"raw": SYSLOG_RAW, "source": "New Vendor Firewall"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["detected_format"] == "syslog"
    suggestions = {s["input_field"]: s["semantic_field"] for s in body["suggestions"]}
    assert suggestions["srcip"] == "source.ip"
    assert suggestions["dstip"] == "destination.ip"
    assert suggestions["action"] == "network.action"
    assert body["confidence"] > 0


def test_onboarding_analyze_empty_rejected(client):
    assert client.post("/api/v1/onboarding/analyze", data={"raw": "   "}).status_code == 422


SYSLOG_RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny"


@pytest.fixture(scope="module")
def sample_event_id(client) -> int:
    # Dedicated source: an identical sourceless payload is ingested earlier in
    # this module, and idempotent replay would return that row instead.
    return client.post(
        "/api/v1/ingest", data={"raw": SYSLOG_RAW, "source": "Fixture Box"}
    ).json()["stored_event_id"]


def test_events_list(client, sample_event_id):
    events = client.get("/api/v1/events").json()
    assert any(e["id"] == sample_event_id for e in events)
    first = events[0]
    assert first["status"] == "quarantined"
    assert first["raw_hash"]


def test_events_list_status_filter(client, sample_event_id):
    quarantined = client.get("/api/v1/events", params={"status": "quarantined"}).json()
    assert any(e["id"] == sample_event_id for e in quarantined)
    output = client.get("/api/v1/events", params={"status": "output"}).json()
    assert all(e["id"] != sample_event_id for e in output)
    assert any(e["status"] == "output" for e in output)


def test_event_detail_views(client, sample_event_id):
    body = client.get(f"/api/v1/events/{sample_event_id}").json()
    assert body["views"]["raw"] == SYSLOG_RAW
    assert body["views"]["parsed"]["fields"]["srcip"] == "10.1.1.5"
    assert body["views"]["parsed"]["hostname"] == "fw01"
    assert body["raw_ref"] is not None


def test_event_raw_endpoint(client, sample_event_id):
    raw = client.get(f"/api/v1/events/{sample_event_id}/raw")
    assert raw.status_code == 200
    assert raw.text == SYSLOG_RAW
    assert raw.headers["content-type"].startswith("text/plain")


def test_event_not_found(client):
    assert client.get("/api/v1/events/99999").status_code == 404
    assert client.get("/api/v1/events/99999/raw").status_code == 404


def test_raw_preserved_on_disk(client, sample_event_id):
    from app.core.raw_store import get_raw_store

    ref = client.get(f"/api/v1/events/{sample_event_id}").json()["raw_ref"]
    path = pathlib.Path(get_raw_store().base_dir) / ref
    assert path.exists()
    assert path.read_text(encoding="utf-8") == SYSLOG_RAW