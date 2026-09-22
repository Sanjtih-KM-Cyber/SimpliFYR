from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable

logger = logging.getLogger("simplifyr.syslog_tcp")


async def _handle_connection(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    on_message: Callable[[str, tuple], None],
) -> None:
    peer = writer.get_extra_info("peername") or ("unknown", 0)
    try:
        while True:
            line = await reader.readline()
            if not line:
                break
            payload = line.decode("utf-8", errors="replace").strip()
            if payload:
                try:
                    on_message(payload, peer)
                except Exception:
                    logger.exception("Syslog TCP handler error from %s", peer)
    except (ConnectionResetError, asyncio.IncompleteReadError):
        pass
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass


def build_syslog_tcp_handler():
    """Return a callback that wraps a TCP syslog line for the pipeline."""
    from app.core import pipeline

    def handle(payload: str, addr: tuple) -> None:
        pipeline.enqueue(
            {
                "payload": payload,
                "ingestion_type": "syslog",
                "address": f"{addr[0]}:{addr[1]}",
                "content_type": "text/plain",
            }
        )

    return handle


async def run_tcp_listener(
    host: str, port: int, on_message: Callable[[str, tuple], None]
) -> asyncio.Server:
    """Serve newline-delimited syslog over TCP, feeding each line to `on_message`."""

    async def on_connect(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await _handle_connection(reader, writer, on_message)

    return await asyncio.start_server(on_connect, host, port)
