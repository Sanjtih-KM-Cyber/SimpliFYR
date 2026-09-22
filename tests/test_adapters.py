import asyncio
import socket
import time

from app.adapters.file_watcher import FileWatcher
from app.adapters.kafka_ingress import build_ingress_handler
from app.adapters.syslog_tcp import run_tcp_listener


def _free_tcp_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def test_tcp_listener_delivers_lines():
    received: list[str] = []

    async def scenario():
        port = _free_tcp_port()
        server = await run_tcp_listener(
            "127.0.0.1", port, lambda payload, addr: received.append(payload)
        )
        await asyncio.sleep(0.1)
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(b"<134>line one\n<134>line two\n")
        await writer.drain()
        writer.close()
        await writer.wait_closed()
        await asyncio.sleep(0.3)
        server.close()
        await server.wait_closed()

    asyncio.run(scenario())
    assert received == ["<134>line one", "<134>line two"]


def test_tcp_listener_ignores_empty_lines():
    received: list[str] = []

    async def scenario():
        port = _free_tcp_port()
        server = await run_tcp_listener(
            "127.0.0.1", port, lambda payload, addr: received.append(payload)
        )
        await asyncio.sleep(0.1)
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write(b"   \n\n")
        await writer.drain()
        writer.close()
        await writer.wait_closed()
        await asyncio.sleep(0.3)
        server.close()
        await server.wait_closed()

    asyncio.run(scenario())
    assert received == []


def test_file_watcher_tails_appends(tmp_path):
    target = tmp_path / "app.log"
    target.write_text("old line\n", encoding="utf-8")
    received: list[str] = []
    watcher = FileWatcher(target, lambda payload, path: received.append(payload), interval=0.1)
    # Drain the pre-existing content first so the test only sees appends.
    watcher._poll()
    received.clear()
    watcher.start()
    try:
        with open(target, "a", encoding="utf-8") as fh:
            fh.write("new one\n\nnew two\n")
        deadline = time.time() + 5
        while len(received) < 2 and time.time() < deadline:
            time.sleep(0.1)
    finally:
        watcher.stop()
    assert received == ["new one", "new two"]


def test_file_watcher_handles_rotation(tmp_path):
    target = tmp_path / "app.log"
    target.write_text("v1-longer-line\n", encoding="utf-8")
    received: list[str] = []
    watcher = FileWatcher(target, lambda payload, path: received.append(payload), interval=0.1)
    watcher._poll()
    # Simulate logrotate: file shrinks.
    target.write_text("v2\n", encoding="utf-8")
    watcher._poll()
    assert received[-1] == "v2"


def test_kafka_ingress_handler_enqueues(monkeypatch):
    from app.core import pipeline

    items: list[dict] = []
    monkeypatch.setattr(pipeline, "enqueue", lambda item: items.append(item) or True)
    build_ingress_handler()("<134>hello", "external.logs")
    assert len(items) == 1
    assert items[0]["payload"] == "<134>hello"
    assert items[0]["ingestion_type"] == "kafka"
    assert items[0]["address"] == "external.logs"


def test_kafka_ingress_disabled_without_dependency(monkeypatch):
    import builtins

    from app.adapters import kafka_ingress

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "kafka":
            raise ImportError("no kafka")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    kafka_ingress.run_ingress_consumer(lambda item: None)  # must not raise
