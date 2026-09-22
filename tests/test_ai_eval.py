"""AI eval gate (Phase 5.2): the configured provider must beat the heuristic baseline.

`tests/golden/baseline.json` pins today's heuristic scores. Swapping in a
fine-tuned model (or changing AI thresholds) is allowed only when this eval
scores >= baseline on every metric. Run the same `run_eval()` against any
candidate before shipping it.
"""

import json
import pathlib

GOLDEN_DIR = pathlib.Path(__file__).resolve().parent / "golden"

GATED_METRICS = (
    "format_detection",
    "field_precision",
    "field_recall",
    "field_f1",
    "drift_rename_recall",
    "abstention",
)

EPSILON = 0.001  # float-noise tolerance, not a quality discount


def test_golden_corpus_loads():
    records = json.loads((GOLDEN_DIR / "records.json").read_text(encoding="utf-8"))
    pairs = json.loads((GOLDEN_DIR / "drift_pairs.json").read_text(encoding="utf-8"))
    assert len(records) >= 8
    assert len(pairs) >= 2
    for record in records:
        assert record["id"] and record["raw"] and record["format"]
        assert isinstance(record.get("expected_semantic", {}), dict)


def test_configured_provider_beats_baseline():
    from app.core.ai.provider import get_ai_provider
    from app.core.eval import run_eval

    baseline = json.loads((GOLDEN_DIR / "baseline.json").read_text(encoding="utf-8"))
    scores = run_eval(get_ai_provider())
    print(f"\neval scores: {scores}")
    for metric in GATED_METRICS:
        assert scores[metric] + EPSILON >= baseline[metric], (
            f"{metric}: {scores[metric]} below baseline {baseline[metric]}"
        )


def test_eval_reports_honest_headroom():
    """The baseline must leave room to improve (else the eval proves nothing)."""
    baseline = json.loads((GOLDEN_DIR / "baseline.json").read_text(encoding="utf-8"))
    assert baseline["field_f1"] < 1.0  # port confusions: real headroom for tuning
    assert baseline["records"] >= 8 and baseline["drift_pairs"] >= 2
