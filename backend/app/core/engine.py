from __future__ import annotations

import hashlib
import logging
import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.converters import to_package_mapping, to_package_profile
from app.core.drift import create_drift, detect_drift
from app.core.raw_store import get_raw_store
from app.core.sources import get_or_create_source
from app.models import Event, EventStatus, Mapping as MappingModel, OutputProfile, Recipe
from event_model import Envelope, new_envelope
from output_profiles import apply_output_profile
from simplifyr_mappings import apply_mapping_with_provenance
from simplifyr_parsers import Format, detect_format, extract_fields, parse

logger = logging.getLogger("simplifyr.engine")

_ACTIVE_STATUSES = ("approved", "published")


def find_active_mapping(db: Session, source: str) -> MappingModel | None:
    """Resolve the active mapping for a source by name."""
    return db.execute(
        select(MappingModel)
        .where(MappingModel.source == source, MappingModel.status.in_(_ACTIVE_STATUSES))
        .order_by(MappingModel.id.desc())
    ).scalars().first()


def find_recipe(db: Session, source: str) -> Recipe | None:
    """Resolve the configure-once recipe for a source by name."""
    return db.execute(
        select(Recipe).where(Recipe.source == source).order_by(Recipe.id.desc())
    ).scalars().first()


class ProcessingEngine:
    """Deterministic runtime that processes events for known sources.

    AI is never on this path. Known events with a matching structure are normalized;
    structural drift on a known source is detected and quarantined (a drift record is
    created for the intelligence layer); unknown sources are preserved + quarantined.
    """

    def __init__(self, db: Session) -> None:
        self.db = db
        # Memoizes (source, environment) -> Source for this engine's lifetime
        # so high-volume loops (batch, workers) resolve identity once.
        self._source_cache: dict = {}
        # Memoizes converted package mapping/profile objects per mapping id /
        # profile id (pure conversions otherwise rebuilt per event — hot-path
        # cost with zero semantic effect). Snapshot semantics per engine
        # lifetime (one request / one batch): a mapping published mid-batch
        # applies from the next request, consistent with the 30s mapping cache.
        self._package_cache: dict = {}
        # Batch fast path: (source, mapping_id) -> (mapping, recipe), resolved
        # once per batch instead of one SELECT per event (even cache-warm the
        # per-event `db.get` costs ~1ms — the top hot spot in profiling).
        self._resolved_cache: dict = {}
        # Batch fast path: pre-fetched {(raw_hash, source)} identities so the
        # per-event duplicate SELECT collapses into one IN query per batch.
        self._known_hashes: set | None = None

    def process_payload(
        self,
        payload: str,
        *,
        source: str | None = None,
        mapping_id: int | None = None,
        output_profile_id: int | None = None,
        content_type: str = "text/plain",
        hint: Format | None = None,
        environment: str = "default",
        ingestion_type: str = "http",
        address: str | None = None,
        commit: bool = True,
    ) -> dict:
        envelope = new_envelope(
            raw_payload=payload,
            ingestion_type=ingestion_type,
            address=address,
            content_type=content_type,
        )
        # Resolve the source to a real catalog identity (auto-created on first
        # sighting) so Event.source_id is always populated — never a bare
        # string passthrough with a NULL FK.
        source_id: int | None = None
        resolved_source: str | None = None
        if source is not None and source.strip():
            catalog_source = get_or_create_source(self.db, source, environment, self._source_cache)
            source_id = catalog_source.id
            resolved_source = catalog_source.name
        raw_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        duplicate_of = self._find_duplicate(raw_hash, resolved_source, environment)
        if duplicate_of is not None:
            # Idempotent replay: same payload + source + environment. Return the
            # original outcome without storing a second row or raw file.
            return self._duplicate_result(duplicate_of, envelope, payload, content_type, hint)
        raw_ref = get_raw_store().save(envelope.event_id, payload)
        event = Event(
            event_id=envelope.event_id,
            environment=environment,
            source_id=source_id,
            source=resolved_source,
            raw=payload,
            raw_hash=raw_hash,
            raw_ref=raw_ref,
        )
        compute_start = time.perf_counter()
        result = self._compute(
            event, payload, resolved_source, mapping_id, output_profile_id, content_type, hint
        )
        event.processing_ms = round((time.perf_counter() - compute_start) * 1000, 3)
        self.db.add(event)
        self.db.flush()  # assign PK without committing (batch callers commit)
        if commit:
            self.db.commit()
            self.db.refresh(event)

        self._publish_live(event)
        if result["status"] == EventStatus.OUTPUT and result["output"] is not None:
            self._deliver(result["output"], event_id=event.event_id, source=resolved_source)

        result.update(
            {
                "envelope": envelope,
                "stored_event_id": event.id,
                "mapping_id": self._resolved_mapping_id,
                "duplicate": False,
            }
        )
        return result

    def reprocess(
        self,
        event: Event,
        *,
        source: str | None = None,
        mapping_id: int | None = None,
        output_profile_id: int | None = None,
    ) -> dict:
        """Recompute an existing event in place (used after knowledge is updated)."""
        effective_source = source or event.source
        if effective_source is not None and effective_source.strip():
            catalog_source = get_or_create_source(
                self.db, effective_source, event.environment, self._source_cache
            )
            event.source_id = catalog_source.id
            effective_source = catalog_source.name
        compute_start = time.perf_counter()
        result = self._compute(
            event,
            event.raw,
            effective_source,
            mapping_id,
            output_profile_id,
            "text/plain",
            None,
        )
        event.processing_ms = round((time.perf_counter() - compute_start) * 1000, 3)
        self.db.commit()
        self.db.refresh(event)
        self._publish_live(event)
        if result["status"] == EventStatus.OUTPUT and result["output"] is not None:
            self._deliver(result["output"], event_id=event.event_id, source=effective_source)
        result["stored_event_id"] = event.id
        result["mapping_id"] = self._resolved_mapping_id
        return result

    def prefetch_hashes(self, payloads: list[str], source: str | None, environment: str) -> None:
        """Load {(raw_hash, source)} identities for a batch in ONE query.

        The batch loop then checks membership with zero roundtrips; only an
        actual duplicate hit falls back to the exact row lookup below.
        """
        hashes = list({hashlib.sha256(p.encode("utf-8")).hexdigest() for p in payloads})
        known: set = set()
        # Chunked: SQLite caps bound variables per statement (999 on old
        # builds), so one giant IN list would fail on large batches.
        for start in range(0, len(hashes), 500):
            chunk = hashes[start : start + 500]
            rows = self.db.execute(
                select(Event.raw_hash, Event.source).where(
                    Event.raw_hash.in_(chunk), Event.environment == environment
                )
            ).all()
            known.update((h, s) for h, s in rows)
        self._known_hashes = known

    def _find_duplicate(self, raw_hash: str, source: str | None, environment: str) -> Event | None:
        """Find a previously stored event with identical payload identity (§58).

        Identity = payload hash + source label + environment. Scoped to the
        environment so identical payloads from different tenants never collide.
        """
        if self._known_hashes is not None and (raw_hash, source) not in self._known_hashes:
            return None
        candidates = self.db.execute(
            select(Event).where(Event.raw_hash == raw_hash, Event.environment == environment)
        ).scalars().all()
        for candidate in candidates:
            if candidate.source == source:
                return candidate
        return None

    def _duplicate_result(self, existing: Event, envelope: Envelope, payload: str, content_type: str, hint: Format | None) -> dict:
        """Rebuild the original outcome for a duplicate replay (no new row)."""
        detection = detect_format(payload, content_type=content_type, hint=hint)
        provenance = existing.provenance
        mapping_id = None
        if isinstance(provenance, dict):
            ref = provenance.get("mapping")
            if isinstance(ref, dict):
                mapping_id = ref.get("id")
        return {
            "detection": detection,
            "parsed": existing.parsed,
            "normalized": existing.normalized,
            "provenance": provenance,
            "output": existing.output,
            "status": EventStatus(existing.status),
            "duplicate": True,
            "envelope": envelope,
            "stored_event_id": existing.id,
            "mapping_id": mapping_id,
        }

    def _compute(
        self,
        event: Event,
        payload: str,
        source: str | None,
        mapping_id: int | None,
        output_profile_id: int | None,
        content_type: str,
        hint: Format | None,
    ) -> dict:
        detection = detect_format(payload, content_type=content_type, hint=hint)

        parsed = None
        parse_failed = False
        try:
            parsed = parse(detection.format, payload)
        except Exception:
            parsed = None
            parse_failed = True

        mapping, recipe = self._resolve_mapping(source, mapping_id)
        self._resolved_mapping_id = mapping.id if mapping else None

        event.source = source
        event.parsed = parsed
        event.detected_format = detection.format.value

        normalized = provenance = output = None
        if parse_failed:
            # Malformed input that no parser can read: dead-letter, not
            # quarantine (reprocessing with new knowledge cannot fix it).
            status = EventStatus.DLQ
        elif parsed is not None and mapping is not None:
            field_map = extract_fields(parsed, detection.format)
            drift = detect_drift(field_map, mapping)
            if drift is None:
                new_fields, _ = set(), set()
                result = apply_mapping_with_provenance(field_map, self._package_mapping(mapping))
                normalized = result["normalized"]
                provenance = {
                    "mapping": {
                        "id": mapping.id,
                        "name": mapping.name,
                        "version": mapping.version,
                        "status": mapping.status,
                    },
                    "fields": result["provenance"],
                }
                status = EventStatus.NORMALIZED
                output = self._render_output(
                    normalized,
                    output_profile_id or (recipe.output_profile_id if recipe else None),
                )
                if output is not None:
                    status = EventStatus.OUTPUT
            else:
                new_fields, missing_fields = drift
                create_drift(
                    self.db,
                    source=source,
                    mapping_id=mapping.id,
                    new_fields=new_fields,
                    missing_fields=missing_fields,
                    sample=payload,
                    event_id=event.event_id,
                )
                status = EventStatus.QUARANTINED
        else:
            status = EventStatus.QUARANTINED

        event.status = status
        event.normalized = normalized
        event.provenance = provenance
        event.output = output

        return {
            "detection": detection,
            "parsed": parsed,
            "normalized": normalized,
            "provenance": provenance,
            "output": output,
            "status": status,
        }

    def _resolve_mapping(
        self, source: str | None, mapping_id: int | None
    ) -> tuple[MappingModel | None, Recipe | None]:
        """Resolve the mapping for an event.

        Order: explicit per-request mapping_id -> configure-once recipe -> active
        mapping by name. Returns (mapping, recipe-or-None).

        Resolved once per (source, mapping_id) per engine lifetime: batch runs
        share one source/mapping, so this collapses N per-event SELECTs into
        one (snapshot semantics unchanged — a mapping published mid-batch
        applies from the next request).
        """
        key = (source, mapping_id)
        if key not in self._resolved_cache:
            self._resolved_cache[key] = self._lookup_mapping(source, mapping_id)
        return self._resolved_cache[key]

    def _lookup_mapping(
        self, source: str | None, mapping_id: int | None
    ) -> tuple[MappingModel | None, Recipe | None]:
        if mapping_id is not None:
            return self.db.get(MappingModel, mapping_id), None
        if source:
            recipe = find_recipe(self.db, source)
            if recipe is not None:
                return self.db.get(MappingModel, recipe.mapping_id), recipe
            from app.core.mapping_cache import find_cached_or_lookup

            return find_cached_or_lookup(self.db, source), None
        return None, None

    def process_lines(
        self,
        lines: list[str],
        *,
        source: str | None = None,
        mapping_id: int | None = None,
        output_profile_id: int | None = None,
        content_type: str = "text/plain",
        hint: Format | None = None,
        environment: str = "default",
        ingestion_type: str = "batch",
        address: str | None = None,
        segment: int = 1000,
    ) -> list[dict]:
        """Process a batch of lines with batched I/O (same semantics as N calls).

        Fast path over process_payload: one mapping resolve, one duplicate
        prefetch query, one flush per `segment` lines (instead of per-event
        SELECTs/flushes). Duplicate identity, quarantine/drift behavior, live
        publish, and delivery are unchanged — including intra-batch replays,
        which reference the first occurrence's outcome like a stored replay.
        """
        # Resolve catalog identity + duplicate history once for the whole batch.
        source_id: int | None = None
        resolved_source: str | None = None
        if source is not None and source.strip():
            catalog_source = get_or_create_source(self.db, source, environment, self._source_cache)
            source_id = catalog_source.id
            resolved_source = catalog_source.name
        self.prefetch_hashes(lines, resolved_source, environment)

        results: list[dict] = []
        first_by_key: dict = {}
        pending: list[tuple] = []  # (event, result) awaiting segment flush
        backfills: list[tuple] = []  # (dupe result, first event) for PK backfill

        def checkpoint() -> None:
            for event, _result in pending:
                self.db.add(event)
            if pending:
                self.db.flush()  # PKs for the whole segment at once
            for event, result in pending:
                result["stored_event_id"] = event.id
            for dupe_result, first_event in backfills:
                dupe_result["stored_event_id"] = first_event.id
            if pending:
                self.db.commit()
            pending.clear()
            backfills.clear()

        for payload in lines:
            try:
                envelope = new_envelope(
                    raw_payload=payload,
                    ingestion_type=ingestion_type,
                    address=address,
                    content_type=content_type,
                )
                raw_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()
                key = (raw_hash, resolved_source)
                if key in first_by_key:
                    # Intra-batch replay: same outcome as the first occurrence.
                    first_result, first_event = first_by_key[key]
                    dupe = {
                        "detection": first_result["detection"],
                        "parsed": first_result["parsed"],
                        "normalized": first_result["normalized"],
                        "provenance": first_result["provenance"],
                        "output": first_result["output"],
                        "status": first_result["status"],
                        "duplicate": True,
                        "envelope": envelope,
                        "stored_event_id": None,  # backfilled at checkpoint
                        "mapping_id": first_result.get("mapping_id"),
                    }
                    backfills.append((dupe, first_event))
                    results.append(dupe)
                    continue
                if key in (self._known_hashes or set()):
                    # Historical replay: exact row lookup only for real hits.
                    duplicate_of = self._lookup_duplicate_row(raw_hash, resolved_source, environment)
                    if duplicate_of is not None:
                        results.append(
                            self._duplicate_result(duplicate_of, envelope, payload, content_type, hint)
                        )
                        continue
                    # Hash known but no row (stale prefetch): store normally.
                raw_ref = get_raw_store().save(envelope.event_id, payload)
                event = Event(
                    event_id=envelope.event_id,
                    environment=environment,
                    source_id=source_id,
                    source=resolved_source,
                    raw=payload,
                    raw_hash=raw_hash,
                    raw_ref=raw_ref,
                )
                compute_start = time.perf_counter()
                result = self._compute(
                    event, payload, resolved_source, mapping_id, output_profile_id, content_type, hint
                )
                event.processing_ms = round((time.perf_counter() - compute_start) * 1000, 3)
                result.update(
                    {
                        "envelope": envelope,
                        "stored_event_id": None,  # backfilled at checkpoint
                        "mapping_id": self._resolved_mapping_id,
                        "duplicate": False,
                    }
                )
                pending.append((event, result))
                first_by_key[key] = (result, event)
                results.append(result)

                self._publish_live(event)
                if result["status"] == EventStatus.OUTPUT and result["output"] is not None:
                    self._deliver(result["output"], event_id=event.event_id, source=resolved_source)
            except Exception:
                logger.exception("Batch line failed for source %s", resolved_source)
                results.append(
                    {
                        "detection": None,
                        "parsed": None,
                        "normalized": None,
                        "provenance": None,
                        "output": None,
                        "status": "failed",
                        "duplicate": False,
                        "envelope": None,
                        "stored_event_id": None,
                        "mapping_id": None,
                    }
                )
            if len(pending) >= segment:
                checkpoint()
        checkpoint()
        return results

    def _lookup_duplicate_row(self, raw_hash: str, source: str | None, environment: str) -> Event | None:
        """Exact stored-row lookup for a prefetch hit (rare path)."""
        candidates = self.db.execute(
            select(Event).where(Event.raw_hash == raw_hash, Event.environment == environment)
        ).scalars().all()
        for candidate in candidates:
            if candidate.source == source:
                return candidate
        return None

    def _package_mapping(self, mapping: MappingModel):
        """Converted package mapping, memoized per engine lifetime."""
        key = ("mapping", mapping.id)
        pkg = self._package_cache.get(key)
        if pkg is None:
            pkg = to_package_mapping(mapping)
            self._package_cache[key] = pkg
        return pkg

    def _render_output(self, normalized: dict, output_profile_id: int | None) -> dict | None:
        if output_profile_id is None:
            return None
        key = ("profile", output_profile_id)
        pkg = self._package_cache.get(key)
        if pkg is None:
            profile = self.db.get(OutputProfile, output_profile_id)
            if profile is None:
                return None
            pkg = to_package_profile(profile)
            self._package_cache[key] = pkg
        return apply_output_profile(normalized, pkg)

    def _publish_live(self, event: Event) -> None:
        try:
            from app.core.datetimes import as_utc_iso
            from app.core.live import hub

            hub.publish(
                {
                    "event_id": event.event_id,
                    "source": event.source,
                    "status": str(event.status),
                    "received_at": as_utc_iso(event.received_at),
                    "environment": event.environment,
                }
            )
        except Exception:  # noqa: BLE001
            logger.exception("Live publish failed for event %s", event.event_id)

    @staticmethod
    def _deliver(output: dict, *, event_id: str, source: str | None) -> None:
        try:
            from app.core.delivery import get_delivery_service

            get_delivery_service().deliver(output, event_id=event_id, source=source)
        except Exception:  # noqa: BLE001
            # Delivery is best-effort and must never break processing.
            logger.exception("Delivery failed for event %s", event_id)
        try:
            from app.core.destination_delivery import deliver_to_destinations

            deliver_to_destinations(output, event_id=event_id, source=source)
        except Exception:  # noqa: BLE001
            logger.exception("Destination delivery failed for event %s", event_id)
        try:
            # §35 stage bus: mirror standardized output when running on Kafka.
            from app.core.config import settings as _settings

            if _settings.pipeline_backend == "kafka":
                from app.core.kafka_pipeline import publish_stage

                publish_stage(
                    "output", {"event_id": event_id, "source": source, "payload": output}
                )
        except Exception:  # noqa: BLE001
            logger.exception("Stage publish failed for event %s", event_id)