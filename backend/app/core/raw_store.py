from __future__ import annotations

from pathlib import Path
from typing import Protocol

from app.core.config import settings


class RawStore(Protocol):
    """Abstract object store for raw events (lossless source preservation)."""

    def save(self, event_id: str, payload: str) -> str:
        """Persist a raw payload, returning a reference handle for later retrieval."""
        ...

    def load(self, ref: str) -> str:
        """Retrieve a raw payload by its reference handle."""
        ...

    def delete(self, ref: str) -> None:
        """Delete a stored payload (honoring retention policy at the caller)."""
        ...


class FilesystemRawStore:
    """Filesystem-backed raw store. Swap for MinIO/S3 later behind the same interface."""

    def __init__(self, base_dir: str | Path) -> None:
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, ref: str) -> Path:
        # Only allow safe, single-segment handles (uuid-based filenames).
        name = Path(ref).name
        if name != ref:
            raise ValueError(f"Unsafe raw store reference: {ref!r}")
        return self.base_dir / name

    def save(self, event_id: str, payload: str) -> str:
        ref = f"{event_id}.raw"
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self._path(ref).write_text(payload, encoding="utf-8")
        return ref

    def load(self, ref: str) -> str:
        return self._path(ref).read_text(encoding="utf-8")

    def delete(self, ref: str) -> None:
        self._path(ref).unlink(missing_ok=True)


class S3RawStore:
    """S3/MinIO-backed raw store implementing the same RawStore interface."""

    def __init__(self, client, bucket: str, prefix: str = "") -> None:
        self.client = client
        self.bucket = bucket
        self.prefix = prefix.rstrip("/") + "/" if prefix else ""

    def _key(self, ref: str) -> str:
        return f"{self.prefix}{ref}"

    def save(self, event_id: str, payload: str) -> str:
        ref = f"{event_id}.raw"
        self.client.put_object(
            Bucket=self.bucket, Key=self._key(ref), Body=payload.encode("utf-8")
        )
        return ref

    def load(self, ref: str) -> str:
        obj = self.client.get_object(Bucket=self.bucket, Key=self._key(ref))
        return obj["Body"].read().decode("utf-8")

    def delete(self, ref: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._key(ref))


_store: FilesystemRawStore | S3RawStore | None = None


def get_raw_store() -> FilesystemRawStore | S3RawStore:
    global _store
    if _store is None:
        _store = _build_store()
    return _store


def _build_store() -> FilesystemRawStore | S3RawStore:
    if settings.raw_store_backend == "s3":
        import boto3

        client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
        )
        return S3RawStore(client, settings.s3_bucket, settings.s3_prefix)
    return FilesystemRawStore(settings.raw_storage_dir)


def set_raw_store(store) -> None:
    """Override the raw store (used by tests / provider injection)."""
    global _store
    _store = store