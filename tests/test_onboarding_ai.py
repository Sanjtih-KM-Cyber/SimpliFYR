import pytest

from app.core.ai.heuristic import HeuristicAIProvider

provider = HeuristicAIProvider()

SYSLOG_FIELDS = {"srcip", "dstip", "proto", "action", "hostname", "timestamp"}


def test_propose_mapping_suggests_semantic_fields():
    proposal = provider.propose_mapping(
        source="FW", field_map={k: "x" for k in SYSLOG_FIELDS}, sample=None
    )
    by_field = {s.input_field: s.semantic_field for s in proposal.new_field_suggestions}
    assert by_field["srcip"] == "source.ip"
    assert by_field["dstip"] == "destination.ip"
    assert by_field["proto"] == "network.protocol"
    assert by_field["action"] == "network.action"
    assert proposal.confidence > 0


def test_propose_mapping_unknown_field_flagged():
    proposal = provider.propose_mapping(source="FW", field_map={"zzqx": "1"}, sample=None)
    s = proposal.new_field_suggestions[0]
    assert s.semantic_field == ""
    assert s.confidence == 0.0
    assert "review" in s.reason