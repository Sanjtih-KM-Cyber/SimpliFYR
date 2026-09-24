"""Rotating API-key pool for cloud demo providers (Groq/Gemini).

Five (or N) keys, round-robin, per-key cooldown: a 429/5xx/network error
parks that key for `cooldown_s` and the next key serves the request. Auth
errors (401/403) also rotate — a dead key must never wedge the queue.
When every key is cooling, the least-stale one is reused rather than
failing outright.
"""

from __future__ import annotations

import time


class KeyPool:
    def __init__(self, keys: list[str], cooldown_s: float = 60.0) -> None:
        cleaned = [k.strip() for k in (keys or []) if k and k.strip()]
        if not cleaned:
            raise ValueError("KeyPool needs at least one API key")
        self._keys = cleaned
        self._cool_until = [0.0] * len(cleaned)
        self._cursor = 0
        self._cooldown_s = cooldown_s

    def __len__(self) -> int:
        return len(self._keys)

    def acquire(self) -> tuple[str, int]:
        """Next usable (key, slot): skips cooling keys, else least-stale."""
        now = time.monotonic()
        for step in range(len(self._keys)):
            slot = (self._cursor + step) % len(self._keys)
            if self._cool_until[slot] <= now:
                self._cursor = (slot + 1) % len(self._keys)
                return self._keys[slot], slot
        slot = min(range(len(self._keys)), key=lambda s: self._cool_until[s])
        self._cursor = (slot + 1) % len(self._keys)
        return self._keys[slot], slot

    def report_bad(self, slot: int) -> None:
        self._cool_until[slot] = time.monotonic() + self._cooldown_s

    def report_ok(self, slot: int) -> None:
        self._cool_until[slot] = 0.0
