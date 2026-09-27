"""Export shapes: normalized-only by default, full on request, batch-pinned.

Default exports answer "what came out of Simplifyr?" — the mapped payload
plus traceability, never raw input text. `shape=full` keeps the legacy
diagnostic row for debugging.
"""

BATCH_RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.30.0.{n} action=deny"


def _run_batch(client, source, count=2, start=1):
    raw = "\n".join(BATCH_RAW.format(n=start + i) for i in range(count))
    res = client.post("/api/v1/process/batch", data={"raw": raw, "source": source})
    assert res.status_code == 200, res.text
    return res.json()


def test_default_export_is_normalized_only(client):
    _run_batch(client, "Shape-Vendor", count=2, start=1)
    body = client.get("/api/v1/export?format=json&source=Shape-Vendor").json()
    assert body["meta"]["shape"] == "normalized"
    assert body["meta"]["count"] == 2
    assert len(body["events"]) == 2
    for record in body["events"]:
        assert "raw" not in record
        assert "parsed" not in record
        assert "output" not in record
        assert set(record) >= {
            "id",
            "event_id",
            "source",
            "status",
            "received_at",
            "batch_id",
            "normalized",
        }


def test_full_shape_keeps_diagnostic_row(client):
    _run_batch(client, "ShapeFull-Vendor", count=1, start=11)
    body = client.get("/api/v1/export?format=json&source=ShapeFull-Vendor&shape=full").json()
    assert body["meta"]["shape"] == "full"
    assert body["events"][0]["raw"].startswith("<134>")


def test_bad_shape_rejected(client):
    assert client.get("/api/v1/export?shape=xml").status_code == 422


def test_batch_id_pins_run_and_names_file(client):
    first = _run_batch(client, "ShapeBatch-Vendor", count=2, start=21)
    _run_batch(client, "ShapeBatch-Vendor", count=2, start=31)
    res = client.get(f"/api/v1/export?format=json&batch_id={first['batch_id']}")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["meta"]["count"] == 2
    assert body["meta"]["batch_id"] == first["batch_id"]
    assert {e["batch_id"] for e in body["events"]} == {first["batch_id"]}
    # Sequential numbering: every row of the complete set, 0-based, no gaps.
    assert [e["seq"] for e in body["events"]] == list(range(len(body["events"])))
    disposition = res.headers["content-disposition"]
    assert f"batch-{first['batch_id']}" in disposition
    assert "simplifyr-" in disposition


def test_batch_export_is_complete_n_in_n_out(client):
    """N inputs -> N independently numbered export rows, schema untouched."""
    batch = _run_batch(client, "ShapeComplete-Vendor", count=5, start=41)
    assert batch["total"] == 5
    body = client.get(f"/api/v1/export?format=json&batch_id={batch['batch_id']}").json()
    assert body["meta"]["count"] == 5
    assert len(body["events"]) == 5
    assert [e["seq"] for e in body["events"]] == [0, 1, 2, 3, 4]
    assert {e["batch_id"] for e in body["events"]} == {batch["batch_id"]}
    # NDJSON carries the same complete numbered set, one object per line.
    lines = client.get(
        f"/api/v1/export?format=ndjson&batch_id={batch['batch_id']}"
    ).text.strip().splitlines()
    assert len(lines) == 5
    import json as jsonlib

    assert [jsonlib.loads(ln)["seq"] for ln in lines] == [0, 1, 2, 3, 4]


def test_ids_export_is_slim_too(client):
    one = client.post("/api/v1/ingest", data={"raw": "<134>Sep 15 10:31:44 fw01 ex9=1"}).json()
    body = client.get(f"/api/v1/export?format=json&ids={one['stored_event_id']}").json()
    assert len(body["events"]) == 1
    assert "raw" not in body["events"][0]


def test_payload_output_uses_profile_result(client):
    """Download output = the bound output-profile structure, never generic."""
    mid = client.post(
        "/api/v1/mappings",
        json={
            "name": "Payload FW",
            "source": "Payload FW",
            "fields": [
                {"input_field": "srcip", "semantic_field": "source.ip"},
                {"input_field": "dstip", "semantic_field": "destination.ip"},
                {"input_field": "proto", "semantic_field": "network.protocol"},
                {"input_field": "action", "semantic_field": "network.action"},
            ],
        },
    ).json()["id"]
    soc_id = next(
        p["id"] for p in client.get("/api/v1/output-profiles").json() if p["name"] == "SOC Investigation"
    )
    res = client.post(
        "/api/v1/ingest",
        data={
            "raw": "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny",
            "mapping_id": str(mid),
            "output_profile_id": str(soc_id),
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "output"
    stored = res.json()["stored_event_id"]

    out_body = client.get(f"/api/v1/export?format=json&ids={stored}&payload=output").json()
    assert out_body["meta"]["payload"] == "output"
    assert len(out_body["events"]) == 1
    row = out_body["events"][0]
    assert "output" in row and "normalized" not in row
    # Exact profile structure, derived from the profile — not hardcoded here
    # beyond what the SOC preset defines.
    assert row["output"]["source"]["ip"] == "10.1.1.5"
    assert "output" in client.get(f"/api/v1/export?format=csv&ids={stored}&payload=output").text.splitlines()[0]

    # Default stays the generic normalized dataset, unconfused.
    norm_body = client.get(f"/api/v1/export?format=json&ids={stored}").json()
    assert norm_body["meta"]["payload"] == "normalized"
    assert "normalized" in norm_body["events"][0]
    assert "output" not in norm_body["events"][0]


def test_bad_payload_rejected(client):
    assert client.get("/api/v1/export?payload=xml").status_code == 422
