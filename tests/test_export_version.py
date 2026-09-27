# Export version/profile re-render (Logs-only pickers).
# Uses the module-scoped `client` fixture from conftest.py.

RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny"


def _publish(client, name: str, source: str, fields: list[dict]) -> int:
    mapping_id = client.post(
        "/api/v1/mappings", json={"name": name, "source": source, "fields": fields}
    ).json()["id"]
    res = client.patch(f"/api/v1/mappings/{mapping_id}", json={"status": "published"})
    assert res.status_code == 200, res.text
    return mapping_id


def test_export_rerenders_against_chosen_version_with_nulls(client):
    src = "Version Box"
    v1 = _publish(
        client,
        "Version Box Mapping",
        src,
        [
            {"input_field": "srcip", "semantic_field": "source.ip"},
            {"input_field": "action", "semantic_field": "network.action"},
        ],
    )
    # v2 adds a field the event does not carry (dstport) -> must come back null.
    v2 = _publish(
        client,
        "Version Box Mapping",
        src,
        [
            {"input_field": "srcip", "semantic_field": "source.ip"},
            {"input_field": "action", "semantic_field": "network.action"},
            {"input_field": "dstport", "semantic_field": "destination.port"},
        ],
    )
    ing = client.post("/api/v1/ingest", data={"raw": RAW, "source": src}).json()
    stored_id = ing["stored_event_id"]

    res = client.get(
        "/api/v1/export",
        params={"format": "json", "ids": str(stored_id), "mapping_id": v2},
    )
    assert res.status_code == 200, res.text
    event = res.json()["events"][0]
    assert event["normalized"]["source"]["ip"] == "10.1.1.5"
    assert event["normalized"]["destination"]["port"] is None

    res1 = client.get(
        "/api/v1/export",
        params={"format": "json", "ids": str(stored_id), "mapping_id": v1},
    )
    assert res1.status_code == 200, res1.text
    assert "destination" not in res1.json()["events"][0]["normalized"]

    res_bad = client.get("/api/v1/export", params={"format": "json", "mapping_id": 999999})
    assert res_bad.status_code == 404


def test_export_renders_chosen_output_profile(client):
    src = "Profile Box"
    _publish(
        client,
        "Profile Box Mapping",
        src,
        [
            {"input_field": "srcip", "semantic_field": "source.ip"},
            {"input_field": "dstip", "semantic_field": "destination.ip"},
            {"input_field": "proto", "semantic_field": "network.protocol"},
            {"input_field": "action", "semantic_field": "network.action"},
        ],
    )
    soc_id = next(
        p["id"] for p in client.get("/api/v1/output-profiles").json() if p["name"] == "SOC Investigation"
    )
    stored_id = client.post("/api/v1/ingest", data={"raw": RAW, "source": src}).json()["stored_event_id"]
    res = client.get(
        "/api/v1/export",
        params={"format": "json", "ids": str(stored_id), "output_profile_id": soc_id},
    )
    assert res.status_code == 200, res.text
    out = res.json()["events"][0]["output"]
    assert out["source"]["ip"] == "10.1.1.5"
    # SOC profile includes destination.port; event has none -> explicit null.
    assert out["destination"]["port"] is None
