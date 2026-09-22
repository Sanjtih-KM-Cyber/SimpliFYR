# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).

RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"


def test_ingest_populates_source_id(client):
    res = client.post("/api/v1/ingest", data={"raw": RAW, "source": "Acme FW"})
    assert res.status_code == 200
    event_id = res.json()["stored_event_id"]

    detail = client.get(f"/api/v1/events/{event_id}").json()
    assert detail["source"] == "Acme FW"
    assert detail["source_id"] is not None


def test_ingest_reuses_source_identity(client):
    first = client.post("/api/v1/ingest", data={"raw": RAW, "source": "Acme FW"}).json()
    second = client.post("/api/v1/ingest", data={"raw": RAW, "source": "Acme FW"}).json()
    first_id = client.get(f"/api/v1/events/{first['stored_event_id']}").json()["source_id"]
    second_id = client.get(f"/api/v1/events/{second['stored_event_id']}").json()["source_id"]
    assert first_id == second_id


def test_events_filter_by_source_id(client):
    client.post("/api/v1/ingest", data={"raw": RAW, "source": "Acme FW"})
    detail = client.get("/api/v1/events?limit=1").json()[0]
    source_id = detail["source_id"]
    filtered = client.get(f"/api/v1/events?source_id={source_id}").json()
    assert filtered, "expected events for source_id filter"
    assert all(e["source_id"] == source_id for e in filtered)


def test_parse_failure_goes_to_dlq(client):
    # A forced JSON hint with malformed JSON makes the parser raise:
    # malformed input must dead-letter, not quarantine.
    res = client.post("/api/v1/ingest", data={"raw": "{not valid json", "hint": "json"})
    assert res.status_code == 200
    assert res.json()["status"] == "dlq"


def test_dlq_event_can_be_retried(client):
    res = client.post("/api/v1/ingest", data={"raw": "{not valid json", "hint": "json"})
    stored_id = res.json()["stored_event_id"]
    retry = client.post(f"/api/v1/events/{stored_id}/retry")
    assert retry.status_code == 200
    assert retry.json()["status"] in ("dlq", "quarantined", "normalized", "output")


def test_retry_rejects_finished_events(client):
    mapping = client.post(
        "/api/v1/mappings",
        json={
            "name": "Acme Mapping",
            "source": "Acme FW",
            "fields": [
                {"input_field": "srcip", "semantic_field": "source.ip"},
                {"input_field": "action", "semantic_field": "network.action"},
            ],
        },
    ).json()
    res = client.post(
        "/api/v1/ingest", data={"raw": RAW, "mapping_id": str(mapping["id"])}
    )
    assert res.json()["status"] == "normalized"
    retry = client.post(f"/api/v1/events/{res.json()['stored_event_id']}/retry")
    assert retry.status_code == 409
