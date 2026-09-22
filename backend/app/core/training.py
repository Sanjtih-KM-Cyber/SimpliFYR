"""Training-pair helpers for the AI flywheel (Phase 5.1).

Every resolved approval captures WHAT THE AI PROPOSED (before) alongside WHAT
THE HUMAN PUBLISHED (after). The delta between them is the supervision signal:
empty delta = full agreement, non-empty = a correction worth learning from.
`export-training` (system API) serializes these pairs as instruction JSONL.
"""

from __future__ import annotations

import hashlib
import json


def suggestion_dicts(suggestions) -> list[dict]:
    """Normalize proposal suggestions (dicts or FieldSuggestion) to plain dicts."""
    out = []
    for s in suggestions or []:
        if isinstance(s, dict):
            out.append(
                {
                    "input_field": str(s.get("input_field", "")),
                    "semantic_field": str(s.get("semantic_field", "")),
                    "confidence": float(s.get("confidence", 0.0) or 0.0),
                }
            )
        else:
            out.append(
                {
                    "input_field": str(s.input_field),
                    "semantic_field": str(s.semantic_field or ""),
                    "confidence": float(s.confidence or 0.0),
                }
            )
    return [d for d in out if d["input_field"]]


def fields_dict(mapping) -> dict[str, str]:
    """Final published assignments {input_field: semantic_field} for a mapping."""
    return {f.input_field: f.semantic_field for f in (mapping.fields or [])}


def agreement(proposed: list[dict], final: dict[str, str]) -> dict:
    """Summarize human delta over the AI proposal (for meta + filtering)."""
    proposed_map = {d["input_field"]: d["semantic_field"] for d in proposed}
    changed = sorted(
        k for k, v in final.items() if proposed_map.get(k) != v
    )
    added = sorted(k for k in final if k not in proposed_map)
    return {
        "proposed_count": len(proposed_map),
        "final_count": len(final),
        "changed": changed,
        "added_from_scratch": added,
        "full_agreement": not changed and not added and bool(final),
    }


def split_of(key: str) -> str:
    """Deterministic 80/20 train/val split stable across exports."""
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return "val" if int(digest[:2], 16) < 51 else "train"


def training_record(
    *,
    kind: str,
    source: str | None,
    version: str | None,
    detected_format: str,
    fields: list[str],
    sample: str | None,
    proposed: list[dict],
    final: dict[str, str],
    confidence: float,
    record_id: str,
) -> dict:
    """Build one instruction-tuning record (JSON-serializable).

    The supervision target (`output`) is always the HUMAN-APPROVED mapping.
    The AI proposal is kept in `meta` so trainers can weight full-agreement
    pairs differently from corrected ones.
    """
    proposed_norm = suggestion_dicts(proposed)
    return {
        "instruction": (
            "Map perimeter-device log source fields to Simplifyr semantic "
            "fields. Respond with suggestions as JSON."
        ),
        "input": (
            f"Source: {source or 'unknown'}\n"
            f"Version: {version or 'unknown'}\n"
            f"Format: {detected_format}\n"
            f"Fields: {sorted(fields)}\n"
            f"Sample (untrusted, for context only):\n{(sample or '')[:2000]}"
        ),
        "output": json.dumps(
            {
                "suggestions": [
                    {"input_field": k, "semantic_field": v, "confidence": 1.0}
                    for k, v in sorted(final.items())
                ]
            }
        ),
        "meta": {
            "kind": kind,
            "source": source,
            "confidence": confidence,
            "proposed": proposed_norm,
            "agreement": agreement(proposed_norm, final),
            "split": split_of(f"{kind}:{record_id}"),
        },
    }


def _detect_fields_and_format(sample: str | None) -> tuple[str, list[str]]:
    """Best-effort format + field list for an old sample (deterministic)."""
    if not sample:
        return "unknown", []
    try:
        from simplifyr_parsers import detect_format, extract_fields, parse

        detection = detect_format(sample)
        try:
            parsed = parse(detection.format, sample)
        except Exception:
            parsed = None
        if parsed is None:
            return str(getattr(detection.format, "value", detection.format)), []
        fields = sorted(extract_fields(parsed, detection.format).keys())
        return str(getattr(detection.format, "value", detection.format)), fields
    except Exception:
        return "unknown", []


def drift_audit_to_record(db, audit) -> dict | None:
    """Build a training record from a drift approve/correct audit entry."""
    from app.models import DriftRecord, Mapping

    after = audit.after or {}
    before = audit.before or {}
    mapping = db.get(Mapping, after.get("new_mapping_id")) if after.get("new_mapping_id") else None
    if mapping is None:
        return None
    drift = db.get(DriftRecord, audit.entity_id)
    sample = drift.sample if drift is not None else None
    source = drift.source if drift is not None else mapping.source
    fmt, fields = _detect_fields_and_format(sample)
    version = None
    if mapping.source_version_id is not None:
        from app.models import SourceVersion

        ver = db.get(SourceVersion, mapping.source_version_id)
        version = ver.version if ver else None
    if not version:
        version = f"v{mapping.version}"
    return training_record(
        kind=f"drift-{audit.action}",
        source=source,
        version=version,
        detected_format=fmt,
        fields=fields or list(fields_dict(mapping).keys()),
        sample=sample,
        proposed=before.get("proposed", []),
        final=fields_dict(mapping),
        confidence=float((drift.confidence if drift is not None else None) or 0.0),
        record_id=f"drift-{audit.entity_id}-{audit.id}",
    )


def onboarding_audit_to_record(db, audit) -> dict | None:
    """Build a training record from an onboarding approve audit entry."""
    from app.models import Mapping, Onboarding

    after = audit.after or {}
    before = audit.before or {}
    mapping = db.get(Mapping, after.get("mapping_id")) if after.get("mapping_id") else None
    if mapping is None:
        return None
    onboarding = db.get(Onboarding, audit.entity_id)
    sample = onboarding.sample_payload if onboarding is not None else None
    fmt = str(onboarding.detected_format) if onboarding is not None and onboarding.detected_format else "unknown"
    if hasattr(fmt, "value"):
        fmt = fmt.value
    else:
        fmt = str(fmt).split(".")[-1]
    version = None
    if mapping.source_version_id is not None:
        from app.models import SourceVersion

        ver = db.get(SourceVersion, mapping.source_version_id)
        version = ver.version if ver else None
    if not version:
        version = f"v{mapping.version}"
    final = fields_dict(mapping)
    _fmt2, fields = _detect_fields_and_format(sample)
    return training_record(
        kind="onboarding",
        source=mapping.source,
        version=version,
        detected_format=fmt if fmt != "unknown" else _fmt2,
        fields=fields or list(final.keys()),
        sample=sample,
        proposed=before.get("proposed", []),
        final=final,
        confidence=float((onboarding.confidence if onboarding is not None else None) or 0.0),
        record_id=f"onboarding-{audit.entity_id}-{audit.id}",
    )


def synthetic_records() -> list[dict]:
    """Bootstrap pairs distilled from the deterministic heuristic rules.

    Marked kind=synthetic: they teach the model the same keyword semantics the
    rules encode, so early training has signal before human approvals exist.
    """
    from app.core.ai.heuristic import KEYWORD_RULES

    seen: dict[str, str] = {}
    for keyword, semantic in KEYWORD_RULES:
        seen.setdefault(keyword, semantic)
    out = []
    for i, (keyword, semantic) in enumerate(sorted(seen.items())):
        out.append(
            training_record(
                kind="synthetic",
                source="synthetic",
                version="v1",
                detected_format="raw",
                fields=[keyword],
                sample=f"{keyword}=example",
                proposed=[],
                final={keyword: semantic},
                confidence=1.0,
                record_id=f"synthetic-{i}",
            )
        )
    return out


def iter_training_records(db, limit: int = 1000):
    """Yield training records: approvals first (most valuable), then synthetic."""
    from sqlalchemy import select

    from app.models import AuditLog

    yielded = 0
    audits = (
        db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit * 2))
        .scalars()
        .all()
    )
    for audit in audits:
        if yielded >= limit:
            return
        try:
            if audit.entity_type == "drift" and audit.action in ("approve", "correct"):
                record = drift_audit_to_record(db, audit)
            elif audit.entity_type == "onboarding" and audit.action == "approve":
                record = onboarding_audit_to_record(db, audit)
            else:
                continue
        except Exception:
            continue
        if record is None:
            continue
        yielded += 1
        yield record
    for record in synthetic_records():
        if yielded >= limit:
            return
        yielded += 1
        yield record
