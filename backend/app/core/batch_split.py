"""Batch content splitting for multi-event uploads (JSON/XML/CSV end-to-end).

The old batch path split strictly per non-empty line. That is correct for
line-delimited formats (syslog/CEF/LEEF/RAW/NDJSON) but destroys document
formats:

- pretty-printed JSON (one object across many lines),
- JSON arrays (``[{...}, {...}]`` = N events),
- multi-line XML documents,
- CSV tables (header + N rows = N events, not 1).

``split_batch_content`` returns one payload string per event while keeping
the line-delimited fast path for everything else, so mixed firehose files
(syslog + CEF + JSON-lines + raw) keep working per line.
"""

from __future__ import annotations

import csv
import io
import json
import xml.etree.ElementTree as ET


def _split_lines(content: str) -> list[str]:
    return [ln.strip() for ln in content.splitlines() if ln.strip()]


def _try_json_array(content: str) -> list[str] | None:
    stripped = content.lstrip()
    if not stripped.startswith("["):
        return None
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(data, list) or not data:
        return None
    out = []
    for item in data:
        if isinstance(item, (dict, list)):
            out.append(json.dumps(item))
        elif isinstance(item, str):
            out.append(item)
        elif item is None:
            continue
        else:
            out.append(json.dumps(item))
    return out or None


def _try_single_json_object(content: str) -> list[str] | None:
    stripped = content.strip()
    if not stripped.startswith("{"):
        return None
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, ValueError):
        return None
    if isinstance(data, dict):
        return [stripped]
    return None


def _try_single_xml(content: str) -> list[str] | None:
    stripped = content.strip()
    if not stripped.startswith("<"):
        return None
    try:
        ET.fromstring(content)
    except ET.ParseError:
        return None
    return [stripped]


def _try_csv_rows(content: str) -> list[str] | None:
    lines = _split_lines(content)
    if len(lines) < 2:
        return None
    try:
        sample = "\n".join(lines[:5])
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
        delimiter = dialect.delimiter
    except Exception:
        return None
    try:
        rows = [row for row in csv.reader(io.StringIO(content), dialect)]
    except Exception:
        return None
    rows = [row for row in rows if any(cell.strip() for cell in row)]
    if len(rows) < 2:
        return None
    # Consistency check: every row must have the header's column count,
    # otherwise this is not a CSV table (e.g. KV syslog lines with commas).
    width = len(rows[0])
    if width == 0 or any(len(row) != width for row in rows):
        return None
    header, data_rows = rows[0], rows[1:]
    if not any(cell.strip() for cell in header):
        return None
    out = []
    for row in data_rows:
        buf = io.StringIO()
        writer = csv.writer(buf, delimiter=delimiter)
        writer.writerow(header)
        writer.writerow(row)
        out.append(buf.getvalue().strip())
    return out or None


def split_batch_content(content: str) -> list[str]:
    """Split an upload into one payload per event (zero-loss).

    Order matters: document shapes (JSON array, single JSON object, single
    XML, CSV table) are tried before the per-line fast path.
    """
    if not content or not content.strip():
        return []
    array = _try_json_array(content)
    if array is not None:
        return array
    single_json = _try_single_json_object(content)
    if single_json is not None:
        return single_json
    single_xml = _try_single_xml(content)
    if single_xml is not None:
        return single_xml
    csv_rows = _try_csv_rows(content)
    if csv_rows is not None:
        return csv_rows
    return _split_lines(content)
