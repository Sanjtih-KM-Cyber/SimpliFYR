import json
import pathlib

import pytest

from simplifyr_parsers import (
    Format,
    detect_format,
    parse_cef,
    parse_csv,
    parse_json,
    parse_leef,
    parse_syslog,
)

GOLDEN_CASES = [
    ("syslog", "firewall.txt", Format.SYSLOG),
    ("json", "firewall.json", Format.JSON),
    ("xml", "firewall.xml", Format.XML),
    ("csv", "firewall.csv", Format.CSV),
    ("cef", "firewall.cef", Format.CEF),
    ("leef", "firewall.leef", Format.LEEF),
    ("raw", "firewall.txt", Format.RAW),
]


@pytest.mark.parametrize("subdir,filename,expected", GOLDEN_CASES)
def test_detect_golden(sample_dir: pathlib.Path, subdir, filename, expected):
    raw = (sample_dir / subdir / filename).read_text(encoding="utf-8")
    result = detect_format(raw)
    assert result.format == expected, f"{filename} detected as {result.format}: {result.detail}"


def test_detect_empty():
    result = detect_format("")
    assert result.format == Format.UNKNOWN
    assert result.confidence == 0.0


def test_detect_unknown_text_is_raw():
    result = detect_format("this is just some freeform text with no structure")
    assert result.format == Format.RAW


def test_detect_hint_overrides():
    result = detect_format("srcip=1.2.3.4", hint=Format.CEF)
    assert result.format == Format.CEF


def test_detect_content_type_json():
    result = detect_format('{"a": 1}', content_type="application/json")
    assert result.format == Format.JSON


def test_detect_rfc5424():
    raw = "<165>1 2026-09-15T10:31:44Z fw01 firewall 123 - src=1.2.3.4"
    assert detect_format(raw).format == Format.SYSLOG


def test_detect_cef_with_space():
    assert detect_format("CEF :0|Vendor|Prod|1|1|name|3|a=b").format == Format.CEF


def test_parse_syslog_pri():
    parsed = parse_syslog("<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny")
    assert parsed["pri"] == 134
    assert parsed["hostname"] == "fw01"
    assert parsed["message"].startswith("srcip=")


def test_parse_syslog_no_pri():
    parsed = parse_syslog("Sep 15 10:31:44 fw01 hello")
    assert parsed["pri"] is None
    assert parsed["hostname"] == "fw01"


def test_parse_cef():
    parsed = parse_cef("CEF:0|VendorX|FirewallY|6.5|1001|Deny|5|src=10.1.1.5 dst=8.8.8.8")
    assert parsed["cef"]["device_product"] == "FirewallY"
    assert parsed["cef"]["severity"] == "5"
    assert parsed["extensions"]["src"] == "10.1.1.5"


def test_parse_leef():
    parsed = parse_leef("LEEF:1.0|VendorX|FirewallY|6.5|traffic|src=10.1.1.5 action=deny")
    assert parsed["leef"]["device_product"] == "FirewallY"
    assert parsed["fields"]["action"] == "deny"


def test_parse_json():
    parsed = parse_json('{"src": "10.1.1.5", "action": "deny"}')
    assert parsed["src"] == "10.1.1.5"


def test_parse_csv():
    parsed = parse_csv("a,b,c\n1,2,3\n4,5,6\n")
    assert parsed == [["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"]]


def test_parse_json_roundtrip_with_detect():
    raw = '{"src": "10.1.1.5"}'
    assert detect_format(raw).format == Format.JSON
    assert json.loads(raw) == parse_json(raw)