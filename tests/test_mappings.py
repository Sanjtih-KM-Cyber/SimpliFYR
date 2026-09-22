import pytest

from simplifyr_mappings import (
    FieldMapping,
    Mapping,
    apply_mapping,
    apply_mapping_with_provenance,
    apply_transformation,
    get_path,
    set_path,
)


def make_firewall_mapping():
    return Mapping(
        name="VendorX Firewall v1 Traffic",
        source="VendorX Firewall v1",
        version=1,
        fields=[
            FieldMapping("srcip", "source.ip"),
            FieldMapping("dstip", "destination.ip"),
            FieldMapping("proto", "network.protocol"),
            FieldMapping("action", "network.action", {"deny": "BLOCKED", "allow": "ALLOWED"}),
        ],
    )


def test_apply_mapping_flat_input_nested_output():
    normalized = apply_mapping(
        {"srcip": "10.1.1.5", "dstip": "8.8.8.8", "proto": "TCP", "action": "deny"},
        make_firewall_mapping(),
    )
    assert normalized["source"]["ip"] == "10.1.1.5"
    assert normalized["destination"]["ip"] == "8.8.8.8"
    assert normalized["network"]["protocol"] == "TCP"
    assert normalized["network"]["action"] == "BLOCKED"


def test_apply_mapping_transformation():
    normalized = apply_mapping({"action": "allow"}, make_firewall_mapping())
    assert normalized["network"]["action"] == "ALLOWED"


def test_apply_mapping_unknown_value_passes_through():
    normalized = apply_mapping({"action": "unmapped_value"}, make_firewall_mapping())
    assert normalized["network"]["action"] == "unmapped_value"


def test_apply_mapping_ignores_missing_inputs():
    normalized = apply_mapping({"srcip": "10.1.1.5"}, make_firewall_mapping())
    assert "destination" not in normalized


def test_apply_mapping_with_provenance():
    result = apply_mapping_with_provenance(
        {"srcip": "10.1.1.5", "action": "deny"}, make_firewall_mapping()
    )
    assert result["normalized"]["network"]["action"] == "BLOCKED"
    prov = result["provenance"]["network.action"]
    assert prov["input_field"] == "action"
    assert prov["input_value"] == "deny"
    assert prov["transformed"] is True
    assert prov["mapping_version"] == 1


def test_apply_transformation_none_is_identity():
    assert apply_transformation("x", None) == "x"


def test_apply_transformation_dict():
    assert apply_transformation("deny", {"deny": "BLOCKED"}) == "BLOCKED"
    assert apply_transformation("other", {"deny": "BLOCKED"}) == "other"


def test_apply_transformation_default():
    assert apply_transformation("other", {"deny": "BLOCKED", "_default": "UNKNOWN"}) == "UNKNOWN"


def test_get_path():
    data = {"source": {"ip": "10.1.1.5"}}
    assert get_path(data, "source.ip") == "10.1.1.5"
    assert get_path(data, "source.port") is None
    assert get_path(data, "missing") is None


def test_set_path_builds_nested():
    target: dict = {}
    set_path(target, "network.action", "BLOCKED")
    set_path(target, "source.ip", "10.1.1.5")
    assert target == {"network": {"action": "BLOCKED"}, "source": {"ip": "10.1.1.5"}}


def test_mapping_add():
    m = Mapping(name="m")
    m.add(FieldMapping("a", "b"))
    assert len(m.fields) == 1


def test_nested_input_path():
    m = Mapping(
        name="json",
        fields=[FieldMapping("source.ip", "source.ip")],
    )
    normalized = apply_mapping({"source": {"ip": "1.2.3.4"}}, m)
    assert normalized == {"source": {"ip": "1.2.3.4"}}