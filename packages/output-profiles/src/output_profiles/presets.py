from __future__ import annotations

from output_profiles.model import OutputField, OutputProfile


def general_preset() -> OutputProfile:
    """General normalized event: emit the entire semantic event unchanged."""
    return OutputProfile(
        name="General Normalized Event",
        description="The full normalized semantic event.",
        is_preset=True,
        include_all=True,
    )


def soc_preset() -> OutputProfile:
    """Security Operations Center investigation view."""
    fields = [
        OutputField("timestamp", "event.timestamp"),
        OutputField("source.ip", "source.ip"),
        OutputField("source.port", "source.port"),
        OutputField("destination.ip", "destination.ip"),
        OutputField("destination.port", "destination.port"),
        OutputField("network.protocol", "network.protocol"),
        OutputField("network.action", "network.action"),
        OutputField("event.severity", "event.severity"),
        OutputField("identity.user", "identity.user"),
    ]
    return OutputProfile(
        name="SOC Investigation",
        description="Focused view for security investigation.",
        is_preset=True,
        fields=fields,
    )


def network_ops_preset() -> OutputProfile:
    """Network Operations monitoring view."""
    fields = [
        OutputField("source.ip", "source.ip"),
        OutputField("destination.ip", "destination.ip"),
        OutputField("network.protocol", "network.protocol"),
        OutputField("network.action", "network.action"),
        OutputField("device.hostname", "device.hostname"),
    ]
    return OutputProfile(
        name="Network Operations",
        description="Monitoring view for network operations.",
        is_preset=True,
        fields=fields,
    )


def siem_preset() -> OutputProfile:
    """SIEM ingestion view."""
    fields = [
        OutputField("timestamp", "event.timestamp"),
        OutputField("source.ip", "source.ip"),
        OutputField("source.port", "source.port"),
        OutputField("destination.ip", "destination.ip"),
        OutputField("destination.port", "destination.port"),
        OutputField("network.protocol", "network.protocol"),
        OutputField("network.action", "network.action"),
        OutputField("event.outcome", "event.outcome"),
    ]
    return OutputProfile(
        name="SIEM",
        description="Representation suited for SIEM ingestion.",
        is_preset=True,
        fields=fields,
    )


def analytics_preset() -> OutputProfile:
    """Analytics view."""
    fields = [
        OutputField("source.ip", "source.ip"),
        OutputField("destination.ip", "destination.ip"),
        OutputField("network.protocol", "network.protocol"),
        OutputField("network.action", "network.action"),
        OutputField("event.severity", "event.severity"),
    ]
    return OutputProfile(
        name="Analytics",
        description="Representation suited for analytics.",
        is_preset=True,
        fields=fields,
    )


def ml_preset() -> OutputProfile:
    """Machine-learning-ready view (bounded, consistent field set)."""
    fields = [
        OutputField("source.ip", "source.ip"),
        OutputField("source.port", "source.port"),
        OutputField("destination.ip", "destination.ip"),
        OutputField("destination.port", "destination.port"),
        OutputField("network.protocol", "network.protocol"),
        OutputField("network.action", "network.action"),
    ]
    return OutputProfile(
        name="Machine Learning",
        description="Consistent, bounded field set for model consumption.",
        is_preset=True,
        fields=fields,
    )


PRESETS: list[OutputProfile] = [
    general_preset(),
    soc_preset(),
    network_ops_preset(),
    siem_preset(),
    analytics_preset(),
    ml_preset(),
]