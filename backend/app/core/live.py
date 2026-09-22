from __future__ import annotations

import asyncio

# Small event payload pushed to live viewers (keep it wire-friendly).
PUBLISH_KEYS = ("event_id", "source", "status", "received_at", "environment")


class LiveHub:
    """In-memory broadcast hub for live event streams.

    The engine (sync code, possibly on a worker thread) publishes via
    `publish()`, which is safe from any thread; WebSocket subscribers each get
    a bounded queue. Slow consumers drop messages rather than back up the pipeline.
    """

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def publish(self, message: dict) -> None:
        if not self._subscribers or self._loop is None:
            return
        payload = {k: message.get(k) for k in PUBLISH_KEYS}

        def _put() -> None:
            for queue in list(self._subscribers):
                try:
                    queue.put_nowait(payload)
                except asyncio.QueueFull:
                    pass

        try:
            self._loop.call_soon_threadsafe(_put)
        except RuntimeError:
            pass


hub = LiveHub()
