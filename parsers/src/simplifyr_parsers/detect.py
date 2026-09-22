from __future__ import annotations

import csv
import io
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass

from simplifyr_parsers.format import Format


@dataclass
class DetectionResult:
    """Outcome of deterministic format detection."""

    format: Format
    confidence: float
    detail: str


# CEF header: "CEF:Version|DeviceVendor|DeviceProduct|DeviceVersion|..."
_CEF_RE = re.compile(r"^CEF\s*:[0-9]")
_LEEF_RE = re.compile(r"^LEEF\s*:?[0-9]")
_SYSLOG_PRI_RE = re.compile(r"^<\d{1,3}>")
_RFC3164_RE = re.compile(r"^[A-Z][a-z]{2}\s+\d{1,2}\s+\d{1,2}:\d{2}:\d{2}")
_ISO8601_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
_RFC5424_RE = re.compile(r"^<(?:\d{1,3})>?\d{4}-\d{2}-\d{2}T")


def _looks_like_csv(text: str) -> bool:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return False
    for delimiter in (",", "\t", ";", "|"):
        counts = {line.count(delimiter) for line in lines}
        if delimiter in text and len(counts) == 1 and next(iter(counts)) > 0:
            return True
    return False


def detect_format(
    raw: str,
    content_type: str | None = None,
    hint: Format | None = None,
) -> DetectionResult:
    """Determine the probable input representation using deterministic signals.

    Priority: configured hint > structural signatures. Content type is used as a
    supporting signal only and never overrides a strong structural match.
    """
    stripped = (raw or "").lstrip()

    if not stripped:
        return DetectionResult(Format.UNKNOWN, 0.0, "Empty payload")

    if hint is not None and hint != Format.UNKNOWN:
        return DetectionResult(hint, 0.9, f"Configured source format: {hint.value}")

    # CEF / LEEF: unambiguous vendor header lines.
    if _CEF_RE.match(stripped):
        return DetectionResult(Format.CEF, 0.95, "CEF header detected")
    if _LEEF_RE.match(stripped):
        return DetectionResult(Format.LEEF, 0.95, "LEEF header detected")

    # JSON: must actually parse.
    if stripped.startswith(("{", "[")):
        try:
            json.loads(raw)
            return DetectionResult(Format.JSON, 0.95, "Valid JSON parsed")
        except (json.JSONDecodeError, ValueError):
            pass

    # XML: must actually parse as well-formed XML.
    if stripped.startswith("<"):
        try:
            ET.fromstring(raw)
            return DetectionResult(Format.XML, 0.9, "Well-formed XML parsed")
        except ET.ParseError:
            pass

    # Syslog with a <PRI> prefix.
    if _SYSLOG_PRI_RE.match(stripped):
        return DetectionResult(Format.SYSLOG, 0.9, "Syslog PRI prefix detected")

    # RFC 5424 / ISO-8601 timestamped syslog.
    if _RFC5424_RE.match(stripped) or _ISO8601_RE.match(stripped):
        return DetectionResult(Format.SYSLOG, 0.8, "Timestamped syslog header detected")

    # CSV: delimited, consistent column counts.
    if _looks_like_csv(raw):
        return DetectionResult(Format.CSV, 0.6, "Consistent delimited columns detected")

    # RFC 3164: "Mon DD HH:MM:SS host ..." without a PRI.
    if _RFC3164_RE.match(stripped):
        return DetectionResult(Format.SYSLOG, 0.7, "RFC3164 syslog timestamp detected")

    return DetectionResult(Format.RAW, 0.4, "Unstructured raw text")


def parse_syslog(raw: str) -> dict:
    """Structurally split an RFC3164-style syslog line into its parts.

    Returns a dict with any recognizable header fields plus the message body.
    """
    stripped = raw.strip()
    pri = None
    rest = stripped
    m = _SYSLOG_PRI_RE.match(rest)
    if m:
        pri = m.group(0).strip("<>")
        rest = rest[m.end():].lstrip()

    parsed: dict = {}
    if pri:
        parsed["pri"] = int(pri)
    else:
        parsed["pri"] = None

    # RFC3164: "Mon DD HH:MM:SS hostname message"
    m = _RFC3164_RE.match(rest)
    if m:
        ts = m.group(0).strip()
        rest = rest[m.end():].lstrip()
        hostname, _, msg = rest.partition(" ")
        parsed["timestamp"] = ts
        parsed["hostname"] = hostname
        parsed["message"] = msg.strip()
    else:
        parsed["message"] = rest
    return parsed


def parse_cef(raw: str) -> dict:
    """Split a CEF event into header fields and key=value extensions.

    Returns {"cef": {...}, "extensions": {key: value}}.
    """
    stripped = raw.strip()
    header_end = -1
    # Header is: CEF:Version|...| with 7 |-delimited fields before the extension.
    parts = stripped.split("|", 7)
    if len(parts) >= 8:
        header = parts[:7]
        extensions_str = parts[7]
        header_end = stripped.index(extensions_str)
        cef = {
            "version": header[0].split(":")[1] if ":" in header[0] else header[0],
            "device_vendor": header[1],
            "device_product": header[2],
            "device_version": header[3],
            "signature_id": header[4],
            "name": header[5],
            "severity": header[6],
        }
    else:
        cef = {"version": None}
        extensions_str = ""
        header_end = len(stripped)

    extensions: dict = {}
    for token in extensions_str.strip().split():
        if "=" in token:
            key, _, value = token.partition("=")
            extensions[key] = value

    return {"cef": cef, "extensions": extensions}


def parse_leef(raw: str) -> dict:
    """Split a LEEF event into header attributes and key=value fields."""
    stripped = raw.strip()
    # LEEF:1.0|Vendor|Product|Version|eventid|attr=val...
    parts = stripped.split("|", 5)
    header = {
        "version": parts[0].split(":")[1] if len(parts) > 0 and ":" in parts[0] else parts[0],
        "device_vendor": parts[1] if len(parts) > 1 else None,
        "device_product": parts[2] if len(parts) > 2 else None,
        "device_version": parts[3] if len(parts) > 3 else None,
        "event_id": parts[4] if len(parts) > 4 else None,
    }
    fields: dict = {}
    if len(parts) > 5:
        for token in parts[5].strip().split():
            if "=" in token:
                key, _, value = token.partition("=")
                fields[key] = value
    return {"leef": header, "fields": fields}


def parse_csv(raw: str) -> list[list[str]]:
    """Parse CSV text, auto-detecting the delimiter."""
    sample = raw.splitlines()[:5]
    dialect = csv.Sniffer().sniff("\n".join(sample), delimiters=",\t;|")
    return [row for row in csv.reader(io.StringIO(raw), dialect)]


def parse_json(raw: str) -> dict:
    """Parse a JSON event body (must be an object or array)."""
    return json.loads(raw)


def parse_xml(raw: str) -> ET.Element:
    """Parse an XML event body."""
    return ET.fromstring(raw)


__all__ = [
    "DetectionResult",
    "detect_format",
    "parse_syslog",
    "parse_cef",
    "parse_leef",
    "parse_csv",
    "parse_json",
    "parse_xml",
]