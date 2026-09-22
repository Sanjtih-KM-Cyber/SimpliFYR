from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable

logger = logging.getLogger("simplifyr.syslog")


class SyslogDatagramProtocol(asyncio.DatagramProtocol):
    """Decodes each UDP datagram and hands the payload to a callback."""

    def __init__(self, on_message: Callable[[str, tuple], None]) -> None:
        self.on_message = on_message

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        payload = data.decode("utf-8", errors="replace").strip()
        if payload:
            try:
                self.on_message(payload, addr)
            except Exception:
                logger.exception("Syslog handler error for datagram from %s", addr)


def build_syslog_handler():
    """Return a callback that wraps a syslog payload for the processing pipeline."""
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


async def run_udp_listener(
    host: str, port: int, on_message: Callable[[str, tuple], None]
) -> asyncio.Transport:
    """Bind a UDP listener that feeds decoded messages to `on_message`."""
    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(
        lambda: SyslogDatagramProtocol(on_message),
        local_addr=(host, port),
    )
    return transport