import pytest

from output_profiles import (
    PRESETS,
    OutputField,
    OutputProfile,
    analytics_preset,
    apply_output_profile,
    general_preset,
    ml_preset,
    network_ops_preset,
    siem_preset,
    soc_preset,
)

NORMALIZED = {
    "event": {"timestamp": "2026-09-15T10:31:44Z", "severity": "high", "outcome": "blocked"},
    "source": {"ip": "10.1.1.5", "port": 43122},
    "destination": {"ip": "8.8.8.8", "port": 443},
    "network": {"protocol": "TCP", "action": "BLOCKED"},
    "identity": {"user": "tjones"},
    "device": {"hostname": "fw01"},
}


def test_general_preset_returns_full_event():
    out = apply_output_profile(NORMALIZED, general_preset())
    assert out == NORMALIZED


def test_general_preset_is_deep_copy():
    out = apply_output_profile(NORMALIZED, general_preset())
    out["source"]["ip"] = "changed"
    assert NORMALIZED["source"]["ip"] == "10.1.1.5"


def test_soc_preset_subset():
    out = apply_output_profile(NORMALIZED, soc_preset())
    assert out["source"]["ip"] == "10.1.1.5"
    assert out["destination"]["port"] == 443
    assert out["identity"]["user"] == "tjones"


def test_network_ops_subset():
    out = apply_output_profile(NORMALIZED, network_ops_preset())
    assert out["device"]["hostname"] == "fw01"
    assert "identity" not in out


def test_siem_preset_subset():
    out = apply_output_profile(NORMALIZED, siem_preset())
    assert out["event"]["outcome"] == "blocked"
    assert "identity" not in out


def test_analytics_preset_subset():
    out = apply_output_profile(NORMALIZED, analytics_preset())
    assert out["event"]["severity"] == "high"
    assert "device" not in out


def test_ml_preset_subset():
    out = apply_output_profile(NORMALIZED, ml_preset())
    assert set(out.keys()) == {"source", "destination", "network"}
    assert out["source"]["port"] == 43122


def test_custom_profile():
    profile = OutputProfile(
        name="Custom",
        fields=[
            OutputField("src_ip", "source.ip"),
            OutputField("dst_ip", "destination.ip"),
            OutputField("decision", "network.action"),
        ],
    )
    out = apply_output_profile(NORMALIZED, profile)
    assert out == {"src_ip": "10.1.1.5", "dst_ip": "8.8.8.8", "decision": "BLOCKED"}


def test_missing_semantic_field_skipped():
    profile = OutputProfile(
        name="p", fields=[OutputField("a", "source.ip"), OutputField("b", "threat.signature")]
    )
    out = apply_output_profile(NORMALIZED, profile)
    assert out == {"a": "10.1.1.5"}


def test_presets_are_versioned_configurations():
    for preset in PRESETS:
        schema = preset.to_schema()
        assert isinstance(schema["fields"], list)
        assert preset.is_preset is True
    assert {p.name for p in PRESETS} >= {
        "General Normalized Event",
        "SOC Investigation",
        "Network Operations",
        "SIEM",
        "Analytics",
        "Machine Learning",
    }


def test_profile_round_trip_schema():
    p = soc_preset()
    rebuilt = OutputProfile.from_schema(p.name, p.to_schema(), is_preset=True, description=p.description)
    assert rebuilt.name == p.name
    assert rebuilt.include_all == p.include_all
    assert len(rebuilt.fields) == len(p.fields)