from __future__ import annotations

import enum


class Format(str, enum.Enum):
    """Canonical event input format classification."""

    SYSLOG = "syslog"
    JSON = "json"
    XML = "xml"
    CSV = "csv"
    CEF = "cef"
    LEEF = "leef"
    RAW = "raw"
    UNKNOWN = "unknown"


# All known concrete formats (excludes the UNKNOWN catch-all).
KNOWN_FORMATS = (
    Format.SYSLOG,
    Format.JSON,
    Format.XML,
    Format.CSV,
    Format.CEF,
    Format.LEEF,
    Format.RAW,
)