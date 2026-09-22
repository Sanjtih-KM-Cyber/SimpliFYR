from app.core.ai.heuristic import HeuristicAIProvider

provider = HeuristicAIProvider()

KNOWN = {"srcip": "source.ip", "dstip": "destination.ip", "proto": "network.protocol", "action": "network.action"}


def test_keyword_match_new_field():
    proposal = provider.analyze_drift(
        source="FW", new_fields={"decision"}, missing_fields={"action"},
        known_semantics=KNOWN, sample=None,
    )
    assert proposal.new_field_suggestions[0].semantic_field == "network.action"
    assert proposal.new_field_suggestions[0].confidence > 0.8


def test_rename_detection_by_similarity():
    proposal = provider.analyze_drift(
        source="FW", new_fields={"srcaddress"}, missing_fields={"srcip"},
        known_semantics=KNOWN, sample=None,
    )
    s = proposal.new_field_suggestions[0]
    assert s.semantic_field == "source.ip"
    assert s.input_field == "srcaddress"


def test_no_confident_match_suggests_empty():
    proposal = provider.analyze_drift(
        source="FW", new_fields={"zzqx"}, missing_fields={"action"},
        known_semantics=KNOWN, sample=None,
    )
    s = proposal.new_field_suggestions[0]
    assert s.semantic_field == ""
    assert s.confidence == 0.0
    assert "requires review" in s.reason


def test_confidence_is_average():
    proposal = provider.analyze_drift(
        source="FW", new_fields={"decision", "srcip2"}, missing_fields={"action"},
        known_semantics=KNOWN, sample=None,
    )
    assert proposal.confidence > 0
    assert proposal.explanation


def test_multiple_new_fields():
    proposal = provider.analyze_drift(
        source="FW", new_fields={"decision", "username"}, missing_fields={"action"},
        known_semantics=KNOWN, sample=None,
    )
    fields = {s.input_field: s.semantic_field for s in proposal.new_field_suggestions}
    assert fields["decision"] == "network.action"
    assert fields["username"] == "identity.user"