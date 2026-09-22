# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).

MAPPING = {
    "name": "VendorX Firewall v1 Traffic",
    "source": "VendorX Firewall v1",
    "fields": [{"input_field": "srcip", "semantic_field": "source.ip"}],
}
RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"


def test_retention_deletes_old_events_and_raw(client):
    import pathlib
    from datetime import datetime, timedelta, timezone

    from app.core.database import SessionLocal
    from app.core.retention import run_retention_cleanup
    from app.models import Event

    client.post("/api/v1/ingest", data={"raw": RAW, "source": MAPPING["source"]})

    with SessionLocal() as db:
        event = db.execute(select_events()).scalars().first()
        # Age the event beyond the retention window.
        event.received_at = datetime.now(timezone.utc) - timedelta(days=30)
        db.commit()
        ref = event.raw_ref

        raw_path = get_raw_store_path(ref)
        assert raw_path.exists()

        removed = run_retention_cleanup(db, retention_days=7)
        assert removed >= 1
        assert db.get(Event, event.id) is None
        assert not raw_path.exists()


def select_events():
    from sqlalchemy import select

    from app.models import Event

    return select(Event)


def get_raw_store_path(ref: str):
    from app.core.raw_store import get_raw_store

    store = get_raw_store()
    base = getattr(store, "base_dir", None)
    if base is None:  # S3-backed (not used in tests) — fall back to ref
        import pathlib

        return pathlib.Path(ref)
    import pathlib

    return pathlib.Path(base) / ref