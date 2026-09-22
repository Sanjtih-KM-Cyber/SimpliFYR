"""Training-data contract tests (Phase 5.3).

Validates the committed inputs (golden corpus) and the record builder without
requiring generated artifacts (training/data is gitignored and reproducible).
"""

import json
import pathlib

GOLDEN = pathlib.Path(__file__).resolve().parent / "golden"


def test_golden_records_schema():
    records = json.loads((GOLDEN / "records.json").read_text(encoding="utf-8"))
    assert len(records) >= 8
    for record in records:
        assert record["id"] and record["raw"] and record["format"]
        assert isinstance(record.get("expected_semantic", {}), dict)


def test_training_record_schema():
    from app.core.training import training_record

    record = training_record(
        kind="drift-correct",
        source="Acme FW",
        version="v2",
        detected_format="syslog",
        fields=["decision"],
        sample="decision=drop",
        proposed=[{"input_field": "decision", "semantic_field": "network.action", "confidence": 0.8}],
        final={"decision": "network.action"},
        confidence=0.8,
        record_id="test-1",
    )
    assert record["instruction"] and record["input"]
    out = json.loads(record["output"])
    assert out["suggestions"] == [
        {"input_field": "decision", "semantic_field": "network.action", "confidence": 1.0}
    ]
    assert record["meta"]["split"] in ("train", "val")
    assert record["meta"]["agreement"]["full_agreement"] is True


def test_augment_generator_deterministic():
    import subprocess
    import sys

    root = pathlib.Path(__file__).resolve().parent.parent
    first = (root / "training" / "data" / "augmented.jsonl")
    if not first.exists():
        raise AssertionError("run training/augment.py first (deterministic seed)")
    before = first.read_bytes()
    subprocess.run([sys.executable, "training/augment.py"], cwd=root, check=True)
    assert first.read_bytes() == before, "augmentation must be byte-reproducible"


def test_modelfile_references_catalog():
    modelfile = pathlib.Path(__file__).resolve().parent.parent / "training" / "Modelfile-simplifyr"
    text = modelfile.read_text(encoding="utf-8")
    for field in ("source.ip", "network.action", "identity.user", "threat.signature"):
        assert field in text
