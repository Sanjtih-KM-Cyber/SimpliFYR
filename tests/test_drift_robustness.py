"""Drift proposal robustness: malformed model output must never reach storage
or break reads.

Regression: a model-written list value inside `renamed_from` was stored raw
and then 500'd every read of that drift detail.
"""

import pytest


def test_ollama_validation_rejects_non_string_renamed_values():
    from app.core.ai.ollama import _validate_response

    with pytest.raises(ValueError):
        _validate_response(
            {
                "suggestions": [
                    {"input_field": "ruleid", "semantic_field": "threat.signature", "confidence": 1.0}
                ],
                "renamed_from": {"new_field": "old_field", "source_fields": ["ruleid"]},
                "explanation": "x",
            }
        )
    # Clean proposals still validate.
    good = _validate_response(
        {
            "suggestions": [{"input_field": "src", "semantic_field": "source.ip", "confidence": 0.9}],
            "renamed_from": {"src": "srcip"},
            "explanation": "ok",
        }
    )
    assert good["renamed_from"] == {"src": "srcip"}


def test_proposal_contract_drops_non_string_renames():
    from app.core.ai.base import AIDriftProposal

    proposal = AIDriftProposal(
        renamed_from={"a": "b", "c": ["x"]},  # type: ignore[dict-item]
        explanation="e",
        confidence=1.0,
    )
    assert proposal.renamed_from == {"a": "b"}


def test_legacy_malformed_proposal_detail_renders(client):
    """A stored row shaped like the once-malformed proposal renders 200 with
    salvageable content intact (suggestions kept, garbage dropped)."""
    from app.core.database import SessionLocal
    from app.models import DriftRecord

    malformed = {
        "new_field_suggestions": [
            {"input_field": "ruleid", "semantic_field": "threat.signature", "confidence": 1.0, "reason": ""},
            {"input_field": "threatlvl", "semantic_field": "event.severity", "confidence": 1.0, "reason": ""},
        ],
        "renamed_from": {"new_field": "old_field", "source_fields": ["ruleid", "threatlvl"]},
        "explanation": "New fields were identified and mapped.",
        "confidence": 1.0,
    }
    with SessionLocal() as db:
        record = DriftRecord(
            source="Robustness-Vendor",
            mapping_id=None,
            status="analyzed",
            new_fields=["ruleid", "threatlvl"],
            missing_fields=[],
            proposal=malformed,
            confidence=1.0,
            sample="ruleid=1 threatlvl=2",
            event_ids=[],
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        drift_id = record.id

    res = client.get(f"/api/v1/drift/{drift_id}")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "analyzed"
    proposal = body["proposal"]
    assert proposal is not None
    assert [s["input_field"] for s in proposal["new_field_suggestions"]] == ["ruleid", "threatlvl"]
    assert proposal["renamed_from"] == {"new_field": "old_field"}
    assert proposal["confidence"] == 1.0


def test_non_object_proposal_detail_renders_without_proposal(client):
    from app.core.database import SessionLocal
    from app.models import DriftRecord

    with SessionLocal() as db:
        record = DriftRecord(
            source="Robustness-Vendor",
            mapping_id=None,
            status="detected",
            new_fields=["zzz"],
            missing_fields=[],
            proposal="not-a-proposal-object",  # type: ignore[assignment]
            confidence=0.0,
            sample="zzz=1",
            event_ids=[],
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        drift_id = record.id

    res = client.get(f"/api/v1/drift/{drift_id}")
    assert res.status_code == 200
    assert res.json()["proposal"] is None
