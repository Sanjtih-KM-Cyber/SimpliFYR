import asyncio
import json as jsonlib

from app.core.live import LiveHub, hub
from app.models import Event

RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"
MAPPING = {
    "name": "VendorX Firewall Traffic",
    "source": "VendorX Firewall",
    "fields": [
        {"input_field": "srcip", "semantic_field": "source.ip"},
        {"input_field": "action", "semantic_field": "network.action"},
    ],
}


def _setup(client):
    created = client.post("/api/v1/mappings", json=MAPPING).json()
    client.patch(f"/api/v1/mappings/{created['id']}", json={"status": "published"})
    profiles = client.get("/api/v1/output-profiles").json()
    return created, (profiles[0]["id"] if profiles else None)


def test_live_hub_publish_subscribe():
    test_hub = LiveHub()

    async def scenario():
        test_hub.set_loop(asyncio.get_running_loop())
        queue = test_hub.subscribe()
        test_hub.publish(
            {"event_id": "e1", "source": "S", "status": "normalized", "extra": "dropped"}
        )
        await asyncio.sleep(0)
        item = queue.get_nowait()
        assert item["event_id"] == "e1"
        assert item["status"] == "normalized"
        assert "extra" not in item
        test_hub.unsubscribe(queue)
        assert test_hub.subscriber_count() == 0

    asyncio.run(scenario())


def test_events_record_processing_latency(client):
    _setup(client)
    client.post("/api/v1/ingest", data={"raw": RAW, "source": MAPPING["source"]})

    from app.core.database import SessionLocal

    with SessionLocal() as db:
        events = db.query(Event).all()
        assert len(events) >= 1
        assert all(e.processing_ms is not None and e.processing_ms >= 0 for e in events)

    conn = client.get(f"/api/v1/connections/{MAPPING['source']}").json()
    assert conn["avg_latency_ms"] >= 0


def test_destinations_crud(client):
    res = client.post(
        "/api/v1/destinations",
        json={"name": "SIEM HEC", "type": "http", "config": {"url": "http://127.0.0.1:9999/hpc"}},
    )
    assert res.status_code == 201
    dest = res.json()
    assert dest["name"] == "SIEM HEC"
    assert dest["enabled"] is True

    listing = client.get("/api/v1/destinations").json()
    assert any(d["id"] == dest["id"] for d in listing)

    patched = client.patch(f"/api/v1/destinations/{dest['id']}", json={"enabled": False})
    assert patched.status_code == 200
    assert patched.json()["enabled"] is False

    deleted = client.delete(f"/api/v1/destinations/{dest['id']}")
    assert deleted.status_code == 204
    assert client.get(f"/api/v1/destinations/{dest['id']}").status_code == 404


def test_destination_validation(client):
    assert (
        client.post(
            "/api/v1/destinations", json={"name": "X", "type": "grpc", "config": {}}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/destinations", json={"name": "X", "type": "http", "config": {}}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/destinations", json={"name": "X", "type": "s3", "config": {}}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/destinations", json={"name": "X", "type": "kafka", "config": {}}
        ).status_code
        == 422
    )


def test_delivery_reaches_enabled_destination(client, monkeypatch):
    created, profile_id = _setup(client)
    dest = client.post(
        "/api/v1/destinations",
        json={"name": "Local Sink", "type": "http", "config": {"url": "http://127.0.0.1:1/hook"}},
    ).json()

    from app.core.delivery import HttpSink
    from app.core.destination_delivery import invalidate_destination_sinks

    calls: list[dict] = []
    monkeypatch.setattr(
        HttpSink,
        "deliver",
        lambda self, payload, *, event_id, source: calls.append(
            {"event_id": event_id, "source": source, "payload": payload}
        ),
    )
    invalidate_destination_sinks()

    # Unique payloads: identical replays are idempotent (dedup) and skip delivery.
    data = {"raw": RAW.replace("10.1.1.5", "10.1.9.1"), "source": MAPPING["source"]}
    if profile_id:
        data["output_profile_id"] = str(profile_id)
    client.post("/api/v1/ingest", data=data)
    assert len(calls) >= 1
    assert calls[0]["source"] == MAPPING["source"]
    assert calls[0]["payload"]

    # Disabled destinations are skipped.
    calls.clear()
    client.patch(f"/api/v1/destinations/{dest['id']}", json={"enabled": False})
    invalidate_destination_sinks()
    data["raw"] = RAW.replace("10.1.1.5", "10.1.9.2")
    client.post("/api/v1/ingest", data=data)
    assert len(calls) == 0

    # Fail-safe: a raising sink never breaks processing.
    client.patch(f"/api/v1/destinations/{dest['id']}", json={"enabled": True})
    invalidate_destination_sinks()
    monkeypatch.setattr(
        HttpSink, "deliver", lambda self, payload, *, event_id, source: (_ for _ in ()).throw(RuntimeError("down"))
    )
    data["raw"] = RAW.replace("10.1.1.5", "10.1.9.3")
    res = client.post("/api/v1/ingest", data=data)
    assert res.status_code == 200

    audit = client.get("/api/v1/audit").json()
    assert any(a["action"] == "create" and a["entity_type"] == "destination" for a in audit)


def test_ws_live_stream(client):
    _setup(client)
    with client.websocket_connect("/api/v1/ws/live") as ws:
        # Unique payload: a duplicate replay returns early without re-publishing.
        client.post("/api/v1/ingest", data={"raw": RAW.replace("10.1.1.5", "10.1.8.1"), "source": MAPPING["source"]})
        msg = ws.receive_json()
        assert msg.get("type") != "ping"  # event messages carry no "type" key
        assert msg["source"] == MAPPING["source"]
        assert msg["status"] in ("normalized", "output")
        assert msg["event_id"]
        assert msg["received_at"]


def test_ws_live_stream_source_filter(client):
    _setup(client)
    with client.websocket_connect("/api/v1/ws/live?source=Other-Source") as ws:
        client.post("/api/v1/ingest", data={"raw": RAW.replace("10.1.1.5", "10.1.8.2"), "source": MAPPING["source"]})
        # Only matching messages are sent; trigger a second matching event to read.
        client.post("/api/v1/ingest", data={"raw": RAW.replace("10.1.1.5", "10.1.8.3"), "source": "Other-Source"})
        msg = ws.receive_json()
        assert msg["source"] == "Other-Source"


def test_export_ndjson_payload_shape(client):
    _setup(client)
    client.post("/api/v1/ingest", data={"raw": RAW, "source": MAPPING["source"]})
    lines = client.get("/api/v1/export?format=ndjson").text.strip().splitlines()
    record = jsonlib.loads(lines[0])
    assert set(record) >= {"id", "event_id", "status", "received_at", "source", "raw"}


def test_reprocess_redelivers_output(client):
    """Approving drift reprocesses quarantine AND delivers new OUTPUT events."""
    from app.core.delivery import DeliveryService, set_delivery_service

    delivered: list[dict] = []

    class RecordingSink:
        name = "recording"

        def deliver(self, payload, *, event_id, source):
            delivered.append({"event_id": event_id, "payload": payload})

    set_delivery_service(DeliveryService([RecordingSink()]))
    try:
        created, profile_id = _setup(client)
        assert profile_id is not None
        client.post(
            "/api/v1/recipes",
            json={"source": MAPPING["source"], "mapping_id": created["id"], "output_profile_id": profile_id},
        )
        # Drift the source with a new field, then approve with the profile
        # bound so reprocessing renders OUTPUT (which must be delivered).
        drifted = RAW.replace("action=deny", "action=deny extra_field=1")
        client.post("/api/v1/ingest", data={"raw": drifted, "source": MAPPING["source"]})
        drift = next(
            d for d in client.get("/api/v1/drift").json() if d["source"] == MAPPING["source"]
        )
        client.post(
            f"/api/v1/drift/{drift['id']}/correct",
            json={"fields": [{"input_field": "extra_field", "semantic_field": "event.outcome"}]},
        )
        assert any(
            isinstance(d.get("payload"), dict) for d in delivered
        ), "reprocessed OUTPUT event was not delivered"
    finally:
        set_delivery_service(None)
