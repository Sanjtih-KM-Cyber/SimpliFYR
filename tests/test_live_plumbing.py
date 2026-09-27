# Live plumbing: WAL tuning, syslog source tagging, handler envelopes.
# (Pure unit tests — no sockets bound, no live DB touched.)


def test_sqlite_wal_pragmas(tmp_path):
    from sqlalchemy import text

    from app.core.database import _build_engine

    engine = _build_engine(f"sqlite:///{tmp_path}/probe.db")
    try:
        with engine.connect() as conn:
            assert conn.execute(text("PRAGMA journal_mode")).scalar() == "wal"
            assert conn.execute(text("PRAGMA synchronous")).scalar() in (1, "NORMAL")
    finally:
        engine.dispose()


def test_parse_source_map():
    from app.adapters.syslog_source import parse_source_map

    assert parse_source_map("192.168.1.1=fw01, 10.0.0.5 = fw02") == {
        "192.168.1.1": "fw01",
        "10.0.0.5": "fw02",
    }
    assert parse_source_map("") == {}
    assert parse_source_map("no-equals,=noname,iponly=") == {}


def test_resolve_syslog_source_map_then_default(monkeypatch):
    from app.adapters.syslog_source import resolve_syslog_source
    from app.core.config import settings

    monkeypatch.setattr(settings, "syslog_source_map", "192.168.1.1=fw01")
    monkeypatch.setattr(settings, "syslog_default_source", "fallback")
    assert resolve_syslog_source(("192.168.1.1", 514)) == "fw01"
    assert resolve_syslog_source(("9.9.9.9", 514)) == "fallback"
    monkeypatch.setattr(settings, "syslog_default_source", "")
    assert resolve_syslog_source(("9.9.9.9", 514)) is None


def test_syslog_handlers_tag_source(monkeypatch):
    from app.adapters import syslog_tcp, syslog_udp
    from app.core import pipeline
    from app.core.config import settings

    seen: list[dict] = []
    monkeypatch.setattr(pipeline, "enqueue", seen.append)
    monkeypatch.setattr(settings, "syslog_source_map", "10.1.1.1=fw01")
    monkeypatch.setattr(settings, "syslog_default_source", "")

    syslog_udp.build_syslog_handler()("<134>hi", ("10.1.1.1", 40000))
    syslog_tcp.build_syslog_tcp_handler()("<134>hi", ("8.8.8.8", 40001))
    assert seen[0]["source"] == "fw01"
    assert seen[0]["ingestion_type"] == "syslog"
    assert seen[1]["source"] is None
