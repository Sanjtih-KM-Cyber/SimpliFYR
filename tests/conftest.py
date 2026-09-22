import os
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"

# Make the FastAPI app package importable from the tests directory.
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# Disable the syslog UDP listener for all tests (settings singleton is loaded once).
os.environ.setdefault("SYSLOG_ENABLED", "false")

SAMPLE_DIR = ROOT / "sample-data"


@pytest.fixture
def sample_dir() -> pathlib.Path:
    return SAMPLE_DIR


@pytest.fixture(scope="module")
def client(request, tmp_path_factory):
    """Module-scoped FastAPI test client with fully isolated DB + raw storage.

    Each test module gets its own tmp dir (SQLite file + raw dir) so:
    - no litter is left in the repo root (*.db/*_raw),
    - modules never collide on the process-wide engine/raw-store/cache
      singletons (the root cause of the Windows
      `no such column: events.processing_ms` flake: a stale DB file
      surviving a failed delete was reused with an old schema),
    - Windows file-lock races on delete-then-reuse are avoided entirely
      (pytest owns the tmp lifetime; we only dispose connections).
    """
    from fastapi.testclient import TestClient

    name = request.module.__name__.split(".")[-1]
    workdir = tmp_path_factory.mktemp(f"sim_{name}")
    db_path = workdir / f"{name}.db"
    raw_dir = workdir / f"{name}_raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    from app.core.cache import InMemoryCache, set_cache
    from app.core.database import reset_engine
    from app.core.raw_store import FilesystemRawStore, set_raw_store

    reset_engine(f"sqlite:///{db_path.as_posix()}")
    set_raw_store(FilesystemRawStore(raw_dir.resolve()))
    set_cache(InMemoryCache())

    # Reset process-wide singletons that otherwise leak across modules.
    import app.core.ai.provider as ai_provider_mod
    import app.core.delivery as delivery_mod
    import app.core.destination_delivery as dest_delivery_mod
    import app.core.kafka_pipeline as kafka_mod

    ai_provider_mod._provider = None
    try:
        ai_provider_mod.reset_provider()
    except AttributeError:
        pass
    delivery_mod.set_delivery_service(None)
    dest_delivery_mod.invalidate_destination_sinks()
    kafka_mod.reset_shared_producer()

    from app.main import app

    with TestClient(app) as c:
        yield c

    # Teardown: dispose pooled SQLite connections so the tmp dir can be
    # reclaimed on Windows. tmp files themselves are owned by pytest and
    # need no manual unlink (which is what used to race with file locks).
    try:
        from app.core.database import engine

        engine.dispose()
    except Exception:  # noqa: BLE001
        pass
