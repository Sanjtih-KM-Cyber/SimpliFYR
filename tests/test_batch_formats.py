# Batch coverage for document formats: JSON array / pretty object, XML, CSV tables.
# Uses the module-scoped `client` fixture from conftest.py.

CSV_TABLE = "timestamp,source_address,destination_address,protocol,action\n2026-09-15T10:31:44Z,10.1.1.5,8.8.8.8,TCP,DENY\n2026-09-15T10:31:46Z,192.168.10.20,93.184.216.34,UDP,ALLOW"

JSON_ARRAY = '[{"srcip": "10.1.1.5", "action": "deny"}, {"srcip": "10.1.1.6", "action": "allow"}]'

JSON_PRETTY = '{\n  "srcip": "10.1.1.5",\n  "dstip": "8.8.8.8",\n  "action": "deny"\n}'

XML_DOC = "<event><src>10.1.1.5</src><dst>8.8.8.8</dst><action>deny</action></event>"

MIXED = "\n".join(
    [
        "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny",
        '{"srcip": "10.1.1.6", "action": "allow"}',
        "CEF:0|VendorX|FirewallY|6.5|1001|Deny|5|src=10.1.1.7 act=deny",
        "just some freeform raw line",
    ]
)


def test_batch_csv_table_splits_per_row(client):
    res = client.post("/api/v1/process/batch", data={"raw": CSV_TABLE, "source": "CSV Box"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 2, body
    assert body["processed"] == 2
    formats = {r["detected_format"] for r in body["results"]}
    assert formats == {"csv"}, formats


def test_batch_json_array_splits_per_element(client):
    res = client.post("/api/v1/process/batch", data={"raw": JSON_ARRAY, "source": "JSON Box"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 2, body
    assert all(r["detected_format"] == "json" for r in body["results"])


def test_batch_pretty_json_is_single_event(client):
    res = client.post("/api/v1/process/batch", data={"raw": JSON_PRETTY, "source": "JSON Box"})
    assert res.status_code == 200, res.text
    assert res.json()["total"] == 1


def test_batch_single_xml_is_single_event(client):
    res = client.post("/api/v1/process/batch", data={"raw": XML_DOC, "source": "XML Box"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    assert body["results"][0]["detected_format"] == "xml"


def test_batch_mixed_formats_keep_per_line_detection(client):
    res = client.post("/api/v1/process/batch", data={"raw": MIXED, "source": "Mix Box"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 4, body
    formats = [r["detected_format"] for r in body["results"]]
    assert formats == ["syslog", "json", "cef", "raw"], formats


def test_ingest_rejects_json_array_with_batch_hint(client):
    res = client.post("/api/v1/ingest", data={"raw": JSON_ARRAY})
    assert res.status_code == 422
    assert "process/batch" in res.json()["detail"]


def test_ingest_rejects_multirow_csv_with_batch_hint(client):
    res = client.post("/api/v1/ingest", data={"raw": CSV_TABLE})
    assert res.status_code == 422
    assert "process/batch" in res.json()["detail"]
