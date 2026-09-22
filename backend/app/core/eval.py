"""AI evaluation harness (Phase 5.2).

Scores any intelligence provider against the golden corpus
(`tests/golden/records.json`, `tests/golden/drift_pairs.json`):

- format_detection: deterministic parser accuracy (not provider-scored,
  but tracked so regressions in detection show up here).
- field_mapping: micro precision/recall/F1 of propose_mapping vs expected.
- drift_rename_recall: analyze_drift suggestions matching expected renames.
- abstention: records with empty expectations must yield no confident mapping
  (measures no-hallucination on unknown/proprietary input).

`tests/golden/baseline.json` pins the heuristic scores. Any new model (or
threshold change) must score >= baseline — that is the ship gate.
"""

from __future__ import annotations

import json
from pathlib import Path

GOLDEN_DIR = Path(__file__).resolve().parents[3] / "tests" / "golden"


def load_golden() -> tuple[list[dict], list[dict]]:
    records = json.loads((GOLDEN_DIR / "records.json").read_text(encoding="utf-8"))
    pairs = json.loads((GOLDEN_DIR / "drift_pairs.json").read_text(encoding="utf-8"))
    return records, pairs


def _field_map_for(record: dict) -> tuple[dict, str]:
    from app.core.drift import meaningful_fields
    from simplifyr_parsers import detect_format, extract_fields, parse

    detection = detect_format(record["raw"])
    try:
        parsed = parse(detection.format, record["raw"])
    except Exception:
        parsed = None
    if parsed is None:
        return {}, str(getattr(detection.format, "value", detection.format))
    # META keys (timestamp/hostname/...) are structural metadata, not user
    # fields — excluded exactly like drift detection excludes them.
    fields = {k: v for k, v in extract_fields(parsed, detection.format).items() if k in meaningful_fields({k: v})}
    return fields, str(getattr(detection.format, "value", detection.format))


def score_mapping(provider, record: dict) -> dict:
    """Score propose_mapping on one golden record (empty expectations = abstention)."""
    field_map, _fmt = _field_map_for(record)
    expected: dict = record.get("expected_semantic", {})
    proposal = provider.propose_mapping(
        source=record.get("source"), field_map=field_map, sample=record["raw"]
    )
    predicted = {
        s.input_field: s.semantic_field
        for s in proposal.new_field_suggestions
        if s.input_field and s.semantic_field
    }
    if not expected:
        return {
            "tp": 0,
            "fp": len(predicted),
            "fn": 0,
            "abstained": not predicted,
        }
    tp = sum(1 for k, v in expected.items() if predicted.get(k) == v)
    fp = sum(1 for k, v in predicted.items() if expected.get(k) != v)
    fn = sum(1 for k in expected if predicted.get(k) != expected[k])
    return {"tp": tp, "fp": fp, "fn": fn, "abstained": True}


def score_drift(provider, pair: dict) -> dict:
    """Score analyze_drift rename recall on one drift pair."""
    proposal = provider.analyze_drift(
        source=pair.get("source"),
        new_fields=set(pair.get("new_fields", [])),
        missing_fields=set(pair.get("missing_fields", [])),
        known_semantics=dict(pair.get("known", {})),
        sample=pair.get("sample"),
    )
    predicted = {
        s.input_field: s.semantic_field
        for s in proposal.new_field_suggestions
        if s.input_field and s.semantic_field
    }
    expected: dict = pair.get("expected", {})
    hit = sum(1 for k, v in expected.items() if predicted.get(k) == v)
    return {"hit": hit, "total": len(expected)}


def run_eval(provider) -> dict:
    """Run the full golden eval; returns aggregate scores rounded to 4dp."""
    records, pairs = load_golden()
    tp = fp = fn = 0
    abstain_ok = abstain_total = 0
    detected = 0
    for record in records:
        from simplifyr_parsers import detect_format

        if str(getattr(detect_format(record["raw"]).format, "value", "")) == record["format"]:
            detected += 1
        scored = score_mapping(provider, record)
        tp += scored["tp"]
        fp += scored["fp"]
        fn += scored["fn"]
        if not record.get("expected_semantic"):
            abstain_total += 1
            abstain_ok += 1 if scored["abstained"] else 0
    hit = total = 0
    for pair in pairs:
        scored = score_drift(provider, pair)
        hit += scored["hit"]
        total += scored["total"]
    precision = tp / (tp + fp) if (tp + fp) else 1.0
    recall = tp / (tp + fn) if (tp + fn) else 1.0
    return {
        "format_detection": round(detected / len(records), 4) if records else 1.0,
        "field_precision": round(precision, 4),
        "field_recall": round(recall, 4),
        "field_f1": round(2 * precision * recall / (precision + recall), 4)
        if (precision + recall)
        else 0.0,
        "drift_rename_recall": round(hit / total, 4) if total else 1.0,
        "abstention": round(abstain_ok / abstain_total, 4) if abstain_total else 1.0,
        "records": len(records),
        "drift_pairs": len(pairs),
    }
