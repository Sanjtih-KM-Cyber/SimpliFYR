"""Phase 0: migration-chain regression test.

Guards the Windows flake root cause (`no such column: events.processing_ms`):
a fresh DB migrated to head must contain the Phase-10 columns/tables.
"""

from sqlalchemy import create_engine, inspect, text


def test_migrations_reach_head_with_phase10_schema(tmp_path):
    from app.core.migrations import run_migrations

    db_path = tmp_path / "migcheck.db"
    url = f"sqlite:///{db_path.as_posix()}"
    run_migrations(url=url)

    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            head = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        assert head == "f8a9b0c3d4e5", f"expected head f8a9b0c3d4e5, got {head!r}"

        cols = {c["name"] for c in inspect(engine).get_columns("events")}
        for required in ("processing_ms", "raw_hash", "environment", "raw_ref", "provenance"):
            assert required in cols, f"events.{required} missing after migrations"

        tables = set(inspect(engine).get_table_names())
        for required in ("destinations", "recipes", "drift_records", "mappings"):
            assert required in tables, f"table {required} missing after migrations"

        indexes = {i["name"] for i in inspect(engine).get_indexes("events")}
        assert "ix_events_status_received_at" in indexes
    finally:
        engine.dispose()
