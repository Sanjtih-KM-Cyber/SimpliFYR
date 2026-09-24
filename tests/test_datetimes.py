# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).

RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"


def test_event_timestamps_carry_utc_offset(client):
    """SQLite drops tzinfo; API output must still carry +00:00 so browsers
    convert to the viewer's real local time instead of misreading UTC as local."""
    stored = client.post("/api/v1/ingest", data={"raw": RAW}).json()["stored_event_id"]
    detail = client.get(f"/api/v1/events/{stored}").json()
    received = detail["received_at"]
    # Pydantic renders UTC as +00:00 or Z — both unambiguous for browsers.
    assert received.endswith(("+00:00", "Z")), f"missing offset: {received}"

    listing = client.get("/api/v1/events").json()[0]
    assert listing["received_at"].endswith(("+00:00", "Z"))

    exported = client.get("/api/v1/export?format=json").json()["events"][0]
    assert exported["received_at"].endswith(("+00:00", "Z"))


def test_as_utc_helper():
    from datetime import datetime, timezone

    from app.core.datetimes import as_utc, as_utc_iso

    assert as_utc(None) is None
    naive = datetime(2026, 9, 23, 2, 45, 18)
    assert as_utc(naive).isoformat() == "2026-09-23T02:45:18+00:00"
    aware = datetime(2026, 9, 23, 2, 45, 18, tzinfo=timezone.utc)
    assert as_utc(aware) is aware
    assert as_utc_iso(naive).endswith("+00:00")
