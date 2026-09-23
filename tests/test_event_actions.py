# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).
# NOTE: module DB is shared — every test uses a unique source AND payload so
# idempotent replay (dedup) and configure-once recipes never cross-talk.


def _raw(n: int) -> str:
    return f"<134>Sep 15 10:31:44 fw01 brandnew1=10.7.0.{n} brandnew2=deny"


def _quarantined(client, n: int, source: str) -> int:
    res = client.post("/api/v1/ingest", data={"raw": _raw(n), "source": source})
    assert res.json()["status"] == "quarantined", res.text
    assert res.json()["duplicate"] is False
    return res.json()["stored_event_id"]


def _onboard(client, stored: int, source: str):
    return client.post(
        f"/api/v1/events/{stored}/onboard",
        json={
            "connection_name": source,
            "fields": [
                {"input_field": "brandnew1", "semantic_field": "source.ip"},
                {"input_field": "brandnew2", "semantic_field": "network.action"},
            ],
        },
    )


def test_suggest_returns_ai_fields_without_side_effects(client):
    stored = _quarantined(client, 11, "Box-Suggest")
    before = client.get("/api/v1/stats").json()["total_events"]
    res = client.get(f"/api/v1/events/{stored}/suggest")
    assert res.status_code == 200
    assert res.json(), "expected suggestions"
    assert client.get("/api/v1/stats").json()["total_events"] == before


def test_onboard_creates_mapping_recipe_and_reprocesses(client):
    stored = _quarantined(client, 12, "Box-Onboard")
    res = _onboard(client, stored, "Box-Onboard")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mapping_id"] > 0
    assert body["recipe_id"] > 0
    assert body["event_status"] == "normalized"

    # Same source now processes automatically (configure-once).
    again = client.post("/api/v1/ingest", data={"raw": _raw(13), "source": "Box-Onboard"}).json()
    assert again["status"] == "normalized"
    assert again["duplicate"] is False


def test_onboard_new_vendor_name(client):
    stored = _quarantined(client, 14, "Mystery Device")
    res = client.post(
        f"/api/v1/events/{stored}/onboard",
        json={
            "connection_name": "Brand New Vendor",
            "fields": [{"input_field": "brandnew1", "semantic_field": "source.ip"}],
        },
    )
    assert res.status_code == 200
    sources = client.get("/api/v1/catalog/sources").json()
    assert any(s["name"] == "Brand New Vendor" for s in sources)


def test_onboard_rejects_finished_events(client):
    stored = _quarantined(client, 15, "Box-Done")
    assert _onboard(client, stored, "Box-Done").status_code == 200
    again = client.post(f"/api/v1/events/{stored}/onboard", json={"connection_name": "Box-Done"})
    assert again.status_code == 409


def test_delete_event_removes_row_and_raw(client):
    from app.core.database import SessionLocal
    from app.models import Event

    stored = _quarantined(client, 16, "Box-Delete")
    ref = client.get(f"/api/v1/events/{stored}").json()["raw_ref"]
    assert client.delete(f"/api/v1/events/{stored}").status_code == 204
    assert client.get(f"/api/v1/events/{stored}").status_code == 404
    with SessionLocal() as db:
        from sqlalchemy import select

        assert db.execute(select(Event).where(Event.id == stored)).scalars().first() is None
    from tests.test_retention import get_raw_store_path

    assert not get_raw_store_path(ref).exists()
    assert client.delete("/api/v1/events/999999").status_code == 404


def test_events_filter_by_source_name(client):
    _quarantined(client, 17, "Filter Me")
    res = client.get("/api/v1/events", params={"source": "Filter Me"}).json()
    assert res and all(e["source_id"] is not None for e in res)
    assert client.get("/api/v1/events", params={"source": "Nobody"}).json() == []
