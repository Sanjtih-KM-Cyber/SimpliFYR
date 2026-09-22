from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class SemanticField:
    """Definition of a canonical semantic field."""

    name: str  # dotted path, e.g. "source.ip"
    data_type: str  # ip, port, string, int, timestamp, protocol, ...
    description: str = ""


# Canonical semantic field catalog. Referenced by dotted paths so that nested
# normalized events are unambiguous and output profiles can pick from it.
SEMANTIC_FIELDS: dict[str, SemanticField] = {}


def register(name: str, data_type: str, description: str = "") -> SemanticField:
    f = SemanticField(name=name, data_type=data_type, description=description)
    SEMANTIC_FIELDS[name] = f
    return f


# --- Event ---------------------------------------------------------------
register("event.timestamp", "timestamp", "When the event occurred")
register("event.type", "string", "General event classification")
register("event.severity", "string", "Severity / priority of the event")
register("event.outcome", "string", "Overall result: success, failure, allowed, blocked")

# --- Source --------------------------------------------------------------
register("source.ip", "ip", "Source IP address")
register("source.port", "port", "Source port")
register("source.hostname", "string", "Source hostname")
register("source.user", "string", "Source identity / username")
register("source.mac", "string", "Source MAC address")

# --- Destination ---------------------------------------------------------
register("destination.ip", "ip", "Destination IP address")
register("destination.port", "port", "Destination port")
register("destination.hostname", "string", "Destination hostname")

# --- Network -------------------------------------------------------------
register("network.protocol", "protocol", "Transport protocol (TCP, UDP, ICMP, ...)")
register("network.action", "string", "Decision applied: allowed, blocked, denied")
register("network.transport", "string", "Transport-layer classification")

# --- Identity ------------------------------------------------------------
register("identity.user", "string", "Authenticated principal / username")
register("identity.session_id", "string", "Session or connection identifier")

# --- Device --------------------------------------------------------------
register("device.hostname", "string", "Reporting device hostname")
register("device.product", "string", "Reporting device product")
register("device.vendor", "string", "Reporting device vendor")
register("device.version", "string", "Reporting device software version")

# --- Threat --------------------------------------------------------------
register("threat.signature", "string", "Detection signature / rule name")
register("threat.category", "string", "Threat classification")
register("threat.severity", "int", "Numeric severity (higher = worse)")

# --- Authentication ------------------------------------------------------
register("authentication.result", "string", "Authentication outcome (success/failure)")
register("authentication.reason", "string", "Reason for an authentication outcome")


def get_semantic_field(name: str) -> SemanticField | None:
    return SEMANTIC_FIELDS.get(name)


def is_registered(name: str) -> bool:
    return name in SEMANTIC_FIELDS


__all__ = [
    "SemanticField",
    "SEMANTIC_FIELDS",
    "register",
    "get_semantic_field",
    "is_registered",
]