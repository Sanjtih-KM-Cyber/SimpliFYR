import json
import pathlib

import pytest

from simplifyr_parsers import (
    Format,
    KNOWN_FORMATS,
    detect_format,
    extract_fields,
    get_parser,
    parse,
    parse_key_values,
    xml_to_dict,
)

SYSLOG_RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny"
JSON_RAW = '{"src": "10.1.1.5", "action": "deny"}'
XML_RAW = "<event><src>10.1.1.5</src><dst>8.8.8.8</dst></event>"
CSV_RAW = "a,b,c\n1,2,3\n4,5,6\n"
CEF_RAW = "CEF:0|VendorX|FirewallY|6.5|1001|Deny|5|src=10.1.1.5 dst=8.8.8.8"
LEEF_RAW = "LEEF:1.0|VendorX|FirewallY|6.5|traffic|src=10.1.1.5 action=deny"
RAW_KV = "srcip=10.1.1.5 action=deny"


def test_parse_key_values():
    assert parse_key_values("srcip=10.1.1.5 action=deny") == {
        "srcip": "10.1.1.5",
        "action": "deny",
    }


def test_parse_key_values_empty():
    assert parse_key_values("no equals here") == {}


def test_xml_to_dict():
    import xml.etree.ElementTree as ET

    result = xml_to_dict(ET.fromstring(XML_RAW))
    assert result == {"src": "10.1.1.5", "dst": "8.8.8.8"}


def test_xml_to_dict_repeated_tag_becomes_list():
    import xml.etree.ElementTree as ET

    result = xml_to_dict(ET.fromstring("<e><tag>a</tag><tag>b</tag></e>"))
    assert result == {"tag": ["a", "b"]}


def test_syslog_parser_extracts_fields():
    parsed = get_parser(Format.SYSLOG).parse(SYSLOG_RAW)
    assert parsed["hostname"] == "fw01"
    assert parsed["fields"]["srcip"] == "10.1.1.5"
    assert parsed["fields"]["action"] == "deny"


def test_json_parser():
    assert get_parser(Format.JSON).parse(JSON_RAW) == json.loads(JSON_RAW)


def test_xml_parser():
    assert get_parser(Format.XML).parse(XML_RAW) == {"src": "10.1.1.5", "dst": "8.8.8.8"}


def test_csv_parser():
    parsed = get_parser(Format.CSV).parse(CSV_RAW)
    assert parsed["header"] == ["a", "b", "c"]
    assert parsed["rows"][0] == {"a": "1", "b": "2", "c": "3"}


def test_cef_parser():
    parsed = get_parser(Format.CEF).parse(CEF_RAW)
    assert parsed["extensions"]["src"] == "10.1.1.5"
    assert parsed["cef"]["device_product"] == "FirewallY"


def test_leef_parser():
    parsed = get_parser(Format.LEEF).parse(LEEF_RAW)
    assert parsed["fields"]["src"] == "10.1.1.5"


def test_raw_parser_key_value():
    assert get_parser(Format.RAW).parse(RAW_KV) == {
        "fields": {"srcip": "10.1.1.5", "action": "deny"},
    }


def test_raw_parser_freeform():
    parsed = get_parser(Format.RAW).parse("just some plain prose")
    assert parsed == {"text": "just some plain prose"}


def test_get_parser_covers_all_known_formats():
    for fmt in KNOWN_FORMATS:
        assert get_parser(fmt) is not None, fmt


def test_get_parser_unknown_returns_none():
    assert get_parser(Format.UNKNOWN) is None


def test_parse_unknown_returns_none():
    assert parse(Format.UNKNOWN, "anything") is None


@pytest.mark.parametrize("fmt", [Format.JSON, Format.CEF, Format.LEEF])
def test_round_trip_detect_then_parse(fmt):
    raw = {
        Format.JSON: JSON_RAW,
        Format.CEF: CEF_RAW,
        Format.LEEF: LEEF_RAW,
    }[fmt]
    assert detect_format(raw).format == fmt
    assert parse(fmt, raw) is not None


def test_corpus_detects_and_parses(sample_dir: pathlib.Path):
    """Every golden sample must be detected as a known format and parse without error."""
    for path in sample_dir.rglob("*"):
        if not path.is_file():
            continue
        raw = path.read_text(encoding="utf-8")
        detection = detect_format(raw)
        assert detection.format in KNOWN_FORMATS, f"{path.name}: {detection.detail}"
        parsed = parse(detection.format, raw)
        assert parsed is not None, f"{path.name}: no parser for {detection.format}"


def test_extract_fields_syslog():
    parsed = parse(Format.SYSLOG, SYSLOG_RAW)
    fields = extract_fields(parsed, Format.SYSLOG)
    assert fields["srcip"] == "10.1.1.5"
    assert fields["action"] == "deny"
    assert fields["hostname"] == "fw01"


def test_extract_fields_json():
    parsed = parse(Format.JSON, JSON_RAW)
    assert extract_fields(parsed, Format.JSON) == {"src": "10.1.1.5", "action": "deny"}


def test_extract_fields_cef():
    parsed = parse(Format.CEF, CEF_RAW)
    assert extract_fields(parsed, Format.CEF)["src"] == "10.1.1.5"


def test_extract_fields_leef():
    parsed = parse(Format.LEEF, LEEF_RAW)
    assert extract_fields(parsed, Format.LEEF)["src"] == "10.1.1.5"


def test_extract_fields_csv_first_row():
    parsed = parse(Format.CSV, CSV_RAW)
    assert extract_fields(parsed, Format.CSV) == {"a": "1", "b": "2", "c": "3"}