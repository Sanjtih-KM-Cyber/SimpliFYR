from __future__ import annotations

import xml.etree.ElementTree as ET

from simplifyr_parsers.detect import (
    parse_cef,
    parse_csv,
    parse_json,
    parse_leef,
    parse_syslog,
)
from simplifyr_parsers.format import Format


def parse_key_values(text: str) -> dict:
    """Extract whitespace-separated `key=value` tokens from a body of text."""
    fields: dict = {}
    for token in text.split():
        if "=" in token:
            key, _, value = token.partition("=")
            fields[key] = value
    return fields


def xml_to_dict(element: ET.Element) -> dict:
    """Convert a parsed XML element tree into nested dictionaries."""
    result: dict = {}
    for child in element:
        value = xml_to_dict(child) if len(child) else (child.text or "")
        if child.tag in result:
            existing = result[child.tag]
            if isinstance(existing, list):
                existing.append(value)
            else:
                result[child.tag] = [existing, value]
        else:
            result[child.tag] = value
    return result


class BaseParser:
    """A parser knows how to *structurally* read a format into source fields."""

    format: Format = Format.UNKNOWN

    def parse(self, raw: str) -> dict:
        raise NotImplementedError


class SyslogParser(BaseParser):
    format = Format.SYSLOG

    def parse(self, raw: str) -> dict:
        parsed = parse_syslog(raw)
        parsed["fields"] = parse_key_values(parsed.get("message", ""))
        return parsed


class JsonParser(BaseParser):
    format = Format.JSON

    def parse(self, raw: str) -> dict:
        return parse_json(raw)


class XmlParser(BaseParser):
    format = Format.XML

    def parse(self, raw: str) -> dict:
        return xml_to_dict(ET.fromstring(raw))


class CsvParser(BaseParser):
    format = Format.CSV

    def parse(self, raw: str) -> dict:
        rows = parse_csv(raw)
        header = rows[0] if rows else []
        return {
            "header": header,
            "rows": [dict(zip(header, row)) for row in rows[1:]],
        }


class CefParser(BaseParser):
    format = Format.CEF

    def parse(self, raw: str) -> dict:
        return parse_cef(raw)


class LeefParser(BaseParser):
    format = Format.LEEF

    def parse(self, raw: str) -> dict:
        return parse_leef(raw)


class RawParser(BaseParser):
    format = Format.RAW

    def parse(self, raw: str) -> dict:
        fields = parse_key_values(raw)
        return {"fields": fields} if fields else {"text": raw.strip()}


# Registry: format -> parser instance. Registered parsers are the only ones the
# pipeline will call; formats without a parser are left unparsed (fail-safe).
PARSERS: dict[Format, BaseParser] = {
    parser.format: parser
    for parser in (
        SyslogParser(),
        JsonParser(),
        XmlParser(),
        CsvParser(),
        CefParser(),
        LeefParser(),
        RawParser(),
    )
}


def get_parser(fmt: Format) -> BaseParser | None:
    return PARSERS.get(fmt)


def parse(fmt: Format, raw: str) -> dict | None:
    """Parse `raw` according to `fmt`. Returns None when no parser exists."""
    parser = get_parser(fmt)
    if parser is None:
        return None
    return parser.parse(raw)


def extract_fields(parsed: dict, fmt: Format) -> dict:
    """Return a flat map of source fields suitable for semantic mapping.

    Parsers keep format-specific structure (e.g. syslog header vs. body, CEF header
    vs. extensions). This collapses each shape into a simple {field: value} map so
    that mappings reference stable source field names regardless of format.
    """
    if fmt == Format.SYSLOG:
        out = dict(parsed.get("fields", {}))
        if parsed.get("timestamp"):
            out.setdefault("timestamp", parsed["timestamp"])
        if parsed.get("hostname"):
            out.setdefault("hostname", parsed["hostname"])
        return out
    if fmt == Format.JSON:
        return parsed if isinstance(parsed, dict) else {}
    if fmt == Format.CEF:
        return dict(parsed.get("extensions", {}))
    if fmt == Format.LEEF:
        return dict(parsed.get("fields", {}))
    if fmt == Format.CSV:
        rows = parsed.get("rows") or []
        return dict(rows[0]) if rows else {}
    if fmt == Format.XML:
        return parsed if isinstance(parsed, dict) else {}
    if fmt == Format.RAW:
        return dict(parsed.get("fields", {}))
    return {}