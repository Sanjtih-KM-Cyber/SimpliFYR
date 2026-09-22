import asyncio
import socket

from app.adapters.syslog_udp import run_udp_listener


def _free_udp_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def test_udp_listener_delivers_payload():
    received: list[str] = []

    async def scenario():
        port = _free_udp_port()
        transport = await run_udp_listener(
            "127.0.0.1", port, lambda payload, addr: received.append(payload)
        )
        await asyncio.sleep(0.1)
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.sendto(b"<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny", ("127.0.0.1", port))
        sock.close()
        await asyncio.sleep(0.2)
        transport.close()

    asyncio.run(scenario())
    assert received == ["<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"]


def test_udp_listener_ignores_empty_datagram():
    received: list[str] = []

    async def scenario():
        port = _free_udp_port()
        transport = await run_udp_listener(
            "127.0.0.1", port, lambda payload, addr: received.append(payload)
        )
        await asyncio.sleep(0.1)
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.sendto(b"   \n", ("127.0.0.1", port))
        sock.close()
        await asyncio.sleep(0.2)
        transport.close()

    asyncio.run(scenario())
    assert received == []