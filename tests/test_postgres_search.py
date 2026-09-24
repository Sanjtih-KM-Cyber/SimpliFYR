"""Postgres integration: migrations + trigram search on real PostgreSQL.

Gated: runs only when TEST_POSTGRES_URL is set, e.g.
    docker compose up -d postgres
    TEST_POSTGRES_URL=postgresql+psycopg2://simplifyr:simplifyr@127.0.0.1:5432/simplifyr \
        .venv/Scripts/python -m pytest tests/test_postgres_search.py -q

Verifies what SQLite cannot: pg_trgm extension, the GIN index, and
similarity-ranked (typo-tolerant) search.
"""

import os

import pytest

PG_URL = os.environ.get("TEST_POSTGRES_URL")

pytestmark = pytest.mark.skipif(not PG_URL, reason="TEST_POSTGRES_URL not set")


@pytest.fixture(scope="module")
def pg_client(tmp_path_factory):
    import sys

    sys.path.insert(0, "backend")
    from fastapi.testclient import TestClient

    from app.core.cache import InMemoryCache, set_cache
    from app.core.database import reset_engine
    from app.core.migrations import run_migrations
    from app.core.raw_store import FilesystemRawStore, set_raw_store

    try:
        run_migrations(url=PG_URL)
    except Exception as exc:
        pytest.skip(f"Postgres unreachable: {exc}")

    reset_engine(PG_URL)
    workdir = tmp_path_factory.mktemp("pg_work")
    raw_dir = workdir / "raw"
    raw_dir.mkdir()
    set_raw_store(FilesystemRawStore(raw_dir.resolve()))
    set_cache(InMemoryCache())

    from app.main import app

    with TestClient(app) as client:
        yield client

    from app.core.database import engine

    engine.dispose()
    # Point the process-wide engine away from Postgres so later modules are
    # unaffected (tmp dir auto-cleaned by pytest).
    reset_engine(f"sqlite:///{(workdir / 'fallback.db').as_posix()}")
    set_raw_store(FilesystemRawStore(raw_dir.resolve()))


def test_pg_trigram_index_exists(pg_client):
    from sqlalchemy import inspect, text

    from app.core.database import SessionLocal

    with SessionLocal() as db:
        assert db.execute(text("SELECT 1 FROM pg_extension WHERE extname='pg_trgm'")).scalar() == 1
        names = {i["name"] for i in inspect(db.bind).get_indexes("events")}
        assert "ix_events_raw_trgm" in names


def test_pg_search_exact_and_typo(pg_client):
    raw = "<134>Sep 15 10:31:44 fw01 srcip=10.99.0.1 action=deny"
    assert pg_client.post("/api/v1/ingest", data={"raw": raw, "source": "PG Box"}).status_code == 200

    exact = pg_client.get("/api/v1/events/search", params={"q": "10.99.0.1"}).json()
    assert any(e["source"] == "PG Box" for e in exact)

    typo = pg_client.get("/api/v1/events/search", params={"q": "10.99.0.2"}).json()
    assert any(e["source"] == "PG Box" for e in typo)


def test_pg_search_rejects_short_query(pg_client):
    assert pg_client.get("/api/v1/events/search", params={"q": "x"}).status_code == 422
