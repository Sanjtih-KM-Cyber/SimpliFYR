"""Nested normalized view + format-segregated rendering (zero-loss).

The deterministic engine stores ``normalized=None`` for quarantined/DLQ rows
(by design: no mapping, no normalization). For display/export that reads as
"data dropped". This module builds a lossless *view* on top of the stored
row: when ``normalized`` exists it is returned as-is; otherwise a nested
fallback is constructed from ``raw`` + ``parsed`` + ``detected_format`` so
every line survives under ``log.original`` with best-effort nested fields.

Nested schema: event / observer / source / destination / network / rule /
threat / device / log. Keys here mirror the semantic catalog
(``semantic_model.fields``) plus the lossless ``log.*`` bucket.
"""

from __future__ import annotations


FORMAT_TITLES = {
    "syslog": "Key-Value Syslog Logs",
    "cef": "Common Event Format (CEF) Logs",
    "leef": "LEEF Logs",
    "json": "JSON Formatted Logs",
    "xml": "XML Logs",
    "csv": "CSV Logs",
    "raw": "Unstructured / Unparsed Raw Logs",
    "unknown": "Unknown Format Logs",
}

FORMAT_ORDER = ["syslog", "cef", "leef", "json", "xml", "csv", "raw", "unknown"]


def format_title(detected_format: str | None) -> str:
    key = (detected_format or "unknown").strip().lower()
    return FORMAT_TITLES.get(key, f"{key.upper()} Logs")


def _set_nested(target: dict, path: str, value) -> None:
    parts = path.split(".")
    node = target
    for part in parts[:-1]:
        nxt = node.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            node[part] = nxt
        node = nxt
    node[parts[-1]] = value


# Flat input field -> nested semantic path for the fallback view. Mirrors the
# heuristic keyword rules so the fallback agrees with future mappings.
_FALLBACK_MAP = {
    "srcip": "source.ip",
    "src": "source.ip",
    "sourceip": "source.ip",
    "sourceaddress": "source.ip",
    "sip": "source.ip",
    "dstip": "destination.ip",
    "dst": "destination.ip",
    "destip": "destination.ip",
    "destinationaddress": "destination.ip",
    "dip": "destination.ip",
    "srcport": "source.port",
    "sport": "source.port",
    "dstport": "destination.port",
    "dport": "destination.port",
    "proto": "network.protocol",
    "protocol": "network.protocol",
    "action": "network.action",
    "act": "network.action",
    "decision": "network.action",
    "ruleid": "rule.id",
    "rule_id": "rule.id",
    "signature_id": "rule.id",
    "signatureid": "rule.id",
    "rulename": "rule.name",
    "rule_name": "rule.name",
    "threatlvl": "threat.level",
    "threat_level": "threat.level",
    "threatlevel": "threat.level",
    "sessionbytes": "network.bytes",
    "session_bytes": "network.bytes",
    "bytes": "network.bytes",
    "hostname": "observer.hostname",
    "host": "observer.hostname",
    "timestamp": "event.timestamp",
    "severity": "event.severity",
    "sev": "event.severity",
    "signature": "threat.signature",
    "sig": "threat.signature",
    "category": "threat.category",
    "device_vendor": "device.vendor",
    "device_product": "device.product",
    "device_version": "device.version",
    "src": "source.ip",
    "dst": "destination.ip",
    "raw_text": "log.original",
    "text": "log.original",
}


def _flat_fields(parsed) -> dict:
    """Best-effort flat field map from a stored parsed payload."""
    if not isinstance(parsed, dict):
        return {}
    # Syslog shape: {fields: {...}, hostname, timestamp, ...}
    if isinstance(parsed.get("fields"), dict) and ("message" in parsed or "hostname" in parsed):
        out = dict(parsed["fields"])
        if parsed.get("timestamp") is not None:
            out.setdefault("timestamp", parsed["timestamp"])
        if parsed.get("hostname") is not None:
            out.setdefault("hostname", parsed["hostname"])
        if parsed.get("pri") is not None:
            out.setdefault("pri", parsed["pri"])
        return out
    # CEF shape: {cef: {...}, extensions: {...}}
    if "extensions" in parsed and isinstance(parsed.get("extensions"), dict):
        out = dict(parsed["extensions"])
        cef = parsed.get("cef") or {}
        if isinstance(cef, dict):
            for k in ("device_vendor", "device_product", "device_version", "signature_id", "name", "severity", "version"):
                if cef.get(k) is not None:
                    out.setdefault(k, cef[k])
        return out
    # LEEF shape: {leef: {...}, fields: {...}}
    if "leef" in parsed and isinstance(parsed.get("fields"), dict):
        out = dict(parsed["fields"])
        leef = parsed.get("leef") or {}
        if isinstance(leef, dict):
            for k in ("device_vendor", "device_product", "device_version", "event_id", "version"):
                if leef.get(k) is not None:
                    out.setdefault(k, leef[k])
        return out
    # RAW shape: {fields: {...}} or {text: ...}
    if set(parsed.keys()) <= {"fields", "text"}:
        fields = parsed.get("fields")
        if isinstance(fields, dict) and fields:
            return dict(fields)
        text = parsed.get("text")
        if isinstance(text, str) and text.strip():
            return {"raw_text": text.strip()}
        return {}
    # JSON / XML / CSV-row dicts are already flat-ish.
    if all(isinstance(k, str) for k in parsed.keys()):
        # CSV shape has header/rows — surface first row.
        if isinstance(parsed.get("rows"), list) and parsed.get("rows"):
            first = parsed["rows"][0]
            if isinstance(first, dict):
                return dict(first)
            return {}
        return {k: v for k, v in parsed.items() if k not in ("header", "rows")}
    return {}


def field_keys(parsed) -> list[str]:
    """Sorted flat field names of a stored parsed payload (grouping key).

    Same shape logic as the fallback view, so upload-type groups and
    lossless display can never disagree on what a "type" is.
    """
    return sorted(_flat_fields(parsed).keys())


def build_nested_fallback(
    *,
    raw: str | None,
    parsed: dict | None,
    detected_format: str | None,
) -> dict:
    """Lossless nested view for rows without a normalized payload."""
    nested: dict = {}
    flat = _flat_fields(parsed)
    consumed: set[str] = set()
    for key, value in flat.items():
        if value is None:
            continue
        norm_key = str(key).strip().lower()
        path = _FALLBACK_MAP.get(norm_key)
        if path:
            _set_nested(nested, path, value)
            # Firewall device hostname doubles as source hostname in the
            # connection-centric UI (see TryItNow example) — keep both so
            # neither view reads as dropped.
            if norm_key in ("hostname", "host"):
                _set_nested(nested, "source.hostname", value)
                _set_nested(nested, "device.hostname", value)
            consumed.add(key)
    # Anything unmapped survives under log.fields — never stripped.
    leftover = {k: v for k, v in flat.items() if k not in consumed}
    if leftover:
        _set_nested(nested, "log.fields", leftover)
    _set_nested(nested, "log.original", raw or "")
    _set_nested(nested, "log.format", (detected_format or "unknown").lower())
    if "event" not in nested:
        nested["event"] = {}
    return nested


def nested_view(record: dict) -> dict:
    """Return the display payload: stored normalized, else lossless fallback."""
    normalized = record.get("normalized")
    if isinstance(normalized, dict) and normalized:
        return normalized
    # Output-profile rows render the profiled payload when present.
    output = record.get("output")
    if isinstance(output, dict) and output:
        return output
    return build_nested_fallback(
        raw=record.get("raw"),
        parsed=record.get("parsed"),
        detected_format=record.get("detected_format"),
    )


def group_by_format(records: list[dict]) -> list[tuple[str, str, list[dict]]]:
    """Group records by detected_format in stable FORMAT_ORDER.

    Returns [(format_key, title, [records...]), ...] omitting empty groups.
    Unknown keys sort last, alphabetically.
    """
    buckets: dict[str, list[dict]] = {}
    for record in records:
        key = str(record.get("detected_format") or "unknown").lower()
        buckets.setdefault(key, []).append(record)

    def sort_key(key: str) -> tuple[int, str]:
        if key in FORMAT_ORDER:
            return (FORMAT_ORDER.index(key), key)
        return (len(FORMAT_ORDER), key)

    grouped: list[tuple[str, str, list[dict]]] = []
    for key in sorted(buckets, key=sort_key):
        grouped.append((key, format_title(key), buckets[key]))
    return grouped


def render_markdown_sections(records: list[dict], *, scope_label: str = "Simplifyr export") -> str:
    """Render records segregated under ## headings per detected format."""
    lines: list[str] = [f"# {scope_label}", ""]
    groups = group_by_format(records)
    if not groups:
        lines.append("_No events matched._")
        return "\n".join(lines) + "\n"
    for index, (key, title, items) in enumerate(groups, start=1):
        lines.append(f"## {index}. {title}")
        lines.append("")
        lines.append(f"_Format: `{key}` · Count: {len(items)}_")
        lines.append("")
        for seq, record in enumerate(items):
            import json as _json

            payload = nested_view(record)
            lines.append(f"### {title} - event {seq + 1} (id {record.get('id')})")
            lines.append("")
            lines.append("```json")
            lines.append(_json.dumps(payload, indent=2, default=str))
            lines.append("```")
            lines.append("")
    return "\n".join(lines)
