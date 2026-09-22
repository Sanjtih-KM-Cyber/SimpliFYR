# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).

RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"


def test_duplicate_ingest_returns_original(client):
    first = client.post("/api/v1/ingest", data={"raw": RAW, "source": "Dedup Box"}).json()
    assert first["duplicate"] is False

    second = client.post("/api/v1/ingest", data={"raw": RAW, "source": "Dedup Box"}).json()
    assert second["duplicate"] is True
    assert second["stored_event_id"] == first["stored_event_id"]
    assert second["status"] == first["status"]


def test_duplicate_does_not_store_second_row(client):
    client.post("/api/v1/ingest", data={"raw": RAW, "source": "Dedup Box"})
    client.post("/api/v1/ingest", data={"raw": RAW, "source": "Dedup Box"})
    events = client.get("/api/v1/events?limit=100").json()
    matches = [e for e in events if e["source_id"] is not None]
    assert len(matches) == 1


def test_same_payload_different_source_is_not_duplicate(client):
    client.post("/api/v1/ingest", data={"raw": RAW, "source": "Box A"})
    res = client.post("/api/v1/ingest", data={"raw": RAW, "source": "Box B"}).json()
    assert res["duplicate"] is False


def test_same_payload_different_environment_is_not_duplicate(client):
    client.post("/api/v1/ingest", data={"raw": RAW, "source": "Dedup Box"})
    res = client.post(
        "/api/v1/ingest",
        data={"raw": RAW, "source": "Dedup Box"},
        headers={"X-Environment": "tenant-b"},
    ).json()
    assert res["duplicate"] is False


def test_retention_raw_tier_strips_files_keeps_rows(client):
    from app.core.database import SessionLocal
    from app.core.retention import run_retention_cleanup
    from app.models import Event
    from datetime import datetime, timedelta, timezone

    from tests.test_retention import get_raw_store_path

    client.post("/api/v1/ingest", data={"raw": RAW, "source": "Dedup Box"})
    with SessionLocal() as db:
        from sqlalchemy import select

        event = db.execute(select(Event)).scalars().first()
        event.received_at = datetime.now(timezone.utc) - timedelta(days=40)
        db.commit()
        ref = event.raw_ref
        assert get_raw_store_path(ref).exists()

        removed = run_retention_cleanup(db, retention_days=0, raw_retention_days=30)
        assert removed == 0  # rows untouched by the raw tier
        event_pk = event.id

    with SessionLocal() as db:
        event = db.get(Event, event_pk)
        assert event is not None
        assert event.raw_ref is None
        assert not get_raw_store_path(ref).exists()
        # Inline raw text remains so detail views keep working.
        assert event.raw == RAW


def test_retention_audit_tier_deletes_old_entries(client):
    from app.core.database import SessionLocal
    from app.core.retention import run_retention_cleanup
    from app.models import AuditLog
    from datetime import datetime, timedelta, timezone

    client.post(
        "/api/v1/mappings",
        json={"name": "Audit Age", "source": "S", "fields": []},
    )
    with SessionLocal() as db:
        from sqlalchemy import select

        entry = db.execute(select(AuditLog)).scalars().first()
        entry.created_at = datetime.now(timezone.utc) - timedelta(days=400)
        db.commit()
        removed = run_retention_cleanup(db, retention_days=0, audit_retention_days=365)
        assert removed >= 1
