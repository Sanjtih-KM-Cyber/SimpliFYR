from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable
from pathlib import Path

logger = logging.getLogger("simplifyr.filewatch")


class FileWatcher:
    """Poll a log file for appended lines (stdlib only, no watchdog dependency).

    Tracks the read offset; a shrink in file size is treated as rotation /
    truncation and restarts from zero. Each new line is handed to `on_message`.
    """

    def __init__(
        self,
        path: str | Path,
        on_message: Callable[[str, str], None],
        interval: float = 1.0,
    ) -> None:
        self.path = Path(path)
        self.on_message = on_message
        self.interval = max(0.1, interval)
        self._offset = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True, name="file-watcher")

    def start(self) -> FileWatcher:
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=5)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self._poll()
            except Exception:  # noqa: BLE001
                logger.exception("File watcher error for %s", self.path)
            self._stop.wait(self.interval)

    def _poll(self) -> None:
        try:
            size = os.path.getsize(self.path)
        except OSError:
            return  # file does not exist (yet)
        if size < self._offset:
            self._offset = 0  # rotated / truncated
        if size == self._offset:
            return
        with open(self.path, encoding="utf-8", errors="replace") as fh:
            fh.seek(self._offset)
            for line in fh:
                payload = line.strip()
                if payload:
                    try:
                        self.on_message(payload, str(self.path))
                    except Exception:
                        logger.exception("File watcher handler error for %s", self.path)
            self._offset = fh.tell()


def build_file_handler():
    """Return a callback that wraps a tailed line for the processing pipeline."""
    from app.core import pipeline

    def handle(payload: str, path: str) -> None:
        pipeline.enqueue(
            {
                "payload": payload,
                "ingestion_type": "file",
                "address": path,
                "content_type": "text/plain",
            }
        )

    return handle


def start_file_watcher(path: str | Path, interval: float = 1.0) -> FileWatcher:
    """Start tailing `path` into the pipeline; call `.stop()` to shut down."""
    return FileWatcher(path, build_file_handler(), interval=interval).start()
