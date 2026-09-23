RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"
MAPPING = {
    "name": "VendorX Firewall Traffic",
    "source": "VendorX Firewall",
    "fields": [
        {"input_field": "srcip", "semantic_field": "source.ip"},
        {"input_field": "action", "semantic_field": "network.action"},
    ],
}

_counter = {"n": 100}


def _unique_raw() -> str:
    """Distinct payload with an identical field set (dedup-safe, drift-free)."""
    _counter["n"] += 1
    n = _counter["n"]
    return f"<134>Sep 15 10:31:44 fw01 srcip=10.9.0.{n} action=deny"


def _setup_connection(client):
    created = client.post("/api/v1/mappings", json=MAPPING).json()
    client.patch(f"/api/v1/mappings/{created['id']}", json={"status": "published"})
    return created


def test_recipe_crud(client):
    created = _setup_connection(client)
    res = client.post(
        "/api/v1/recipes",
        json={"source": MAPPING["source"], "mapping_id": created["id"]},
    )
    assert res.status_code == 201
    recipe = res.json()
    assert recipe["source"] == MAPPING["source"]
    assert recipe["mapping_id"] == created["id"]

    listing = client.get("/api/v1/recipes").json()
    assert any(r["id"] == recipe["id"] for r in listing)

    detail = client.get(f"/api/v1/recipes/{recipe['id']}")
    assert detail.status_code == 200

    del_res = client.delete(f"/api/v1/recipes/{recipe['id']}")
    assert del_res.status_code == 204
    assert client.get(f"/api/v1/recipes/{recipe['id']}").status_code == 404


def test_recipe_requires_valid_bindings(client):
    res = client.post("/api/v1/recipes", json={"source": "X", "mapping_id": 999999})
    assert res.status_code == 404
    res = client.post("/api/v1/recipes", json={"source": "  ", "mapping_id": 1})
    assert res.status_code == 422


def test_engine_follows_recipe_mapping_and_output(client):
    created = _setup_connection(client)
    profiles = client.get("/api/v1/output-profiles").json()
    assert len(profiles) > 0
    client.post(
        "/api/v1/recipes",
        json={
            "source": MAPPING["source"],
            "mapping_id": created["id"],
            "output_profile_id": profiles[0]["id"],
        },
    )

    # Ingest WITHOUT explicit mapping/output ids: the recipe drives processing.
    res = client.post("/api/v1/ingest", data={"raw": RAW, "source": MAPPING["source"]})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "output"
    assert body["normalized"] is not None
    assert body["output"] is not None
    assert body["provenance"]["mapping"]["id"] == created["id"]

    # Connections façade now exposes the bound output profile.
    conn = client.get(f"/api/v1/connections/{MAPPING['source']}").json()
    assert conn["output_profile"]["id"] == profiles[0]["id"]


def test_recipe_uses_bound_mapping_even_unpublished(client):
    created = client.post("/api/v1/mappings", json=MAPPING).json()
    # mapping stays DRAFT: name-based lookup would quarantine, recipe binds it.
    client.post(
        "/api/v1/recipes",
        json={"source": MAPPING["source"], "mapping_id": created["id"]},
    )
    res = client.post("/api/v1/ingest", data={"raw": _unique_raw(), "source": MAPPING["source"]})
    assert res.status_code == 200
    assert res.json()["status"] == "normalized"


def test_delete_recipe_falls_back_to_name_lookup(client):
    created = _setup_connection(client)
    recipe = client.post(
        "/api/v1/recipes",
        json={"source": MAPPING["source"], "mapping_id": created["id"]},
    ).json()
    client.delete(f"/api/v1/recipes/{recipe['id']}")

    res = client.post("/api/v1/ingest", data={"raw": _unique_raw(), "source": MAPPING["source"]})
    assert res.status_code == 200
    body = res.json()
    # No recipe: falls back to the published name-based mapping, no output profile.
    assert body["status"] == "normalized"
    assert body["output"] is None


def test_resave_recipe_updates_binding(client):
    created = _setup_connection(client)
    r1 = client.post(
        "/api/v1/recipes", json={"source": MAPPING["source"], "mapping_id": created["id"]}
    ).json()
    mapping2 = client.post("/api/v1/mappings", json=MAPPING).json()
    r2 = client.post(
        "/api/v1/recipes", json={"source": MAPPING["source"], "mapping_id": mapping2["id"]}
    ).json()
    assert r2["id"] == r1["id"]
    assert r2["mapping_id"] == mapping2["id"]
    assert len(client.get("/api/v1/recipes").json()) == 1


def test_recipe_actions_audited(client):
    created = _setup_connection(client)
    recipe = client.post(
        "/api/v1/recipes", json={"source": MAPPING["source"], "mapping_id": created["id"]}
    ).json()
    client.delete(f"/api/v1/recipes/{recipe['id']}")

    audit = client.get("/api/v1/audit").json()
    actions = {(a["action"], a["entity_type"]) for a in audit}
    assert ("create", "recipe") in actions
    assert ("delete", "recipe") in actions


def test_export_json_ndjson_csv(client):
    created = _setup_connection(client)
    client.post(
        "/api/v1/recipes", json={"source": MAPPING["source"], "mapping_id": created["id"]}
    )
    client.post("/api/v1/ingest", data={"raw": RAW, "source": MAPPING["source"]})

    for fmt, expected_type in (("json", "application/json"), ("ndjson", "application/x-ndjson"), ("csv", "text/csv")):
        res = client.get(f"/api/v1/export?format={fmt}")
        assert res.status_code == 200, fmt
        assert res.headers["content-type"].startswith(expected_type), fmt
        assert "attachment" in res.headers["content-disposition"], fmt

    json_body = client.get("/api/v1/export?format=json").json()
    assert isinstance(json_body, list) and len(json_body) >= 1
    record = next(e for e in json_body if e["source"] == MAPPING["source"])
    assert record["normalized"] is not None
    assert record["raw"].startswith("<134>")

    ndjson = client.get("/api/v1/export?format=ndjson").text.strip().splitlines()
    assert len(ndjson) >= 1
    import json as jsonlib

    assert jsonlib.loads(ndjson[-1])["status"] in ("normalized", "output")

    csv_text = client.get("/api/v1/export?format=csv").text
    lines = csv_text.strip().splitlines()
    assert lines[0].startswith("id,event_id,status,received_at,source,raw,parsed,normalized")
    assert len(lines) >= 2


def test_export_filters(client):
    created = _setup_connection(client)
    client.post(
        "/api/v1/recipes", json={"source": MAPPING["source"], "mapping_id": created["id"]}
    )
    client.post("/api/v1/ingest", data={"raw": RAW, "source": MAPPING["source"]})
    client.post("/api/v1/ingest", data={"raw": "unknown stuff", "source": "Other Box"})

    by_source = client.get(f"/api/v1/export?source={MAPPING['source']}").json()
    assert all(e["source"] == MAPPING["source"] for e in by_source)

    by_status = client.get("/api/v1/export?status=quarantined").json()
    assert len(by_status) >= 1
    assert all(e["status"] == "quarantined" for e in by_status)

    multi = client.get("/api/v1/export?status=normalized,quarantined").json()
    assert all(e["status"] in ("normalized", "quarantined") for e in multi)


def test_export_bad_format_and_status(client):
    assert client.get("/api/v1/export?format=xml").status_code == 422
    assert client.get("/api/v1/export?status=bogus").status_code == 422
