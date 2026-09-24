# Format stamping + batch group actions for Telemetry Inspection.
# Uses the module-scoped `client` fixture (isolated DB + raw storage);
# unique source/payload per test so dedup never cross-talks.


def _raw(n: int) -> str:
    return f"<134>Sep 15 10:31:44 fw01 tfmt1=10.9.0.{n} tfmt2=deny"


def _quarantined(client, n: int, source: str) -> int:
    res = client.post("/api/v1/ingest", data={"raw": _raw(n), "source": source})
    assert res.json()["status"] == "quarantined", res.text
    return res.json()["stored_event_id"]


def test_summaries_carry_detected_format(client):
    stored = _quarantined(client, 21, "Box-Format")
    rows = client.get("/api/v1/events", params={"source": "Box-Format"}).json()
    row = next(r for r in rows if r["id"] == stored)
    assert row["detected_format"] == "syslog", row
    detail = client.get(f"/api/v1/events/{stored}").json()
    assert detail["detected_format"] == "syslog"


def test_search_by_index_number(client):
    stored = _quarantined(client, 22, "Box-IndexSearch")
    # Server requires q >= 2 chars; the padded index form is the real UX.
    padded = client.get("/api/v1/events/search", params={"q": str(stored).zfill(6)}).json()
    assert any(h["id"] == stored for h in padded), padded


def test_batch_results_carry_stored_ids(client):
    res = client.post(
        "/api/v1/process/batch",
        data={"raw": "<134>Sep 15 10:31:44 fw01 tb1=1\n<134>Sep 15 10:31:45 fw01 tb1=2"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 2
    ids = [r["stored_event_id"] for r in body["results"]]
    assert all(isinstance(i, int) for i in ids), body["results"]
    assert len(set(ids)) == 2


def test_export_ids_pins_exact_set(client):
    one = client.post("/api/v1/ingest", data={"raw": "<134>Sep 15 10:31:44 fw01 ex1=1"}).json()
    two = client.post("/api/v1/ingest", data={"raw": "<134>Sep 15 10:31:45 fw01 ex1=2"}).json()
    res = client.get(f"/api/v1/export?format=json&ids={one['stored_event_id']}")
    body = res.json()
    assert body["meta"]["count"] == 1
    assert [e["id"] for e in body["events"]] == [one["stored_event_id"]]
    assert two["stored_event_id"] not in [e["id"] for e in body["events"]]


def test_search_by_global_id(client):
    stored = _quarantined(client, 27, "Box-GlobalSearch")
    detail = client.get(f"/api/v1/events/{stored}").json()
    fragment = detail["event_id"][:8]
    assert len(fragment) >= 2
    hits = client.get("/api/v1/events/search", params={"q": fragment}).json()
    assert any(h["id"] == stored for h in hits), hits


def test_batch_retry_normalizes_group_after_onboard(client):
    a = _quarantined(client, 23, "Box-BatchRetry")
    b = _quarantined(client, 24, "Box-BatchRetry")
    # Onboard one: publishes mapping knowledge for the source...
    res = client.post(
        f"/api/v1/events/{a}/onboard",
        json={
            "connection_name": "Box-BatchRetry",
            "fields": [
                {"input_field": "tfmt1", "semantic_field": "source.ip"},
                {"input_field": "tfmt2", "semantic_field": "network.action"},
            ],
        },
    )
    assert res.status_code == 200, res.text
    # ...then the rest of the group follows with one call (approve-all).
    retry = client.post("/api/v1/events/batch-retry", json={"ids": [a, b]}).json()
    assert b in retry["retried"], retry
    assert str(a) in retry["skipped"], retry  # already normalized by onboard (JSON keys are strings)
    assert client.get(f"/api/v1/events/{b}").json()["status"] == "normalized"


def test_batch_delete_purges_group(client):
    a = _quarantined(client, 25, "Box-BatchDelete")
    b = _quarantined(client, 26, "Box-BatchDelete")
    res = client.post("/api/v1/events/batch-delete", json={"ids": [a, b, 999999]}).json()
    assert sorted(res["deleted"]) == sorted([a, b]), res
    assert client.get(f"/api/v1/events/{a}").status_code == 404
    assert client.get(f"/api/v1/events/{b}").status_code == 404
