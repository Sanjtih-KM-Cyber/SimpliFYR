import pytest

from semantic_model import (
    SEMANTIC_FIELDS,
    get_semantic_field,
    is_registered,
)


def test_registry_is_populated():
    assert len(SEMANTIC_FIELDS) >= 20


def test_core_semantic_fields_registered():
    for name in (
        "source.ip",
        "destination.ip",
        "network.protocol",
        "network.action",
        "event.timestamp",
        "identity.user",
        "threat.signature",
        "authentication.result",
    ):
        assert is_registered(name), name
        assert get_semantic_field(name) is not None


def test_semantic_field_data_type():
    assert get_semantic_field("source.ip").data_type == "ip"
    assert get_semantic_field("destination.port").data_type == "port"
    assert get_semantic_field("network.protocol").data_type == "protocol"


def test_unknown_semantic_field():
    assert get_semantic_field("does.not.exist") is None
    assert is_registered("does.not.exist") is False


def test_field_names_are_dotted_paths():
    for name in SEMANTIC_FIELDS:
        assert "." in name
        assert name.count(".") >= 1