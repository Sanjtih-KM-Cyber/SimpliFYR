# Multi-shape onboarding: one sample, all shapes mapped, one publish drains.
# Uses the module-scoped `client` fixture from conftest.py.

RAW = (
    "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny\n"
    "<134>Sep 15 10:31:45 fw01 srcip=10.1.1.6 action=deny\n"
    "<134>Sep 15 10:31:46 fw01 srcip=10.1.1.7 action=deny ruleid=1005\n"
    "just some freeform raw line"
)
SRC = "Shape Wizard Box"


def test_shapes_splits_sample(client):
    res = client.post("/api/v1/onboarding/shapes", json={"raw": RAW, "source_name": SRC})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"] == SRC
    shapes = body["shapes"]
    assert len(shapes) == 3, shapes
    assert [s["count"] for s in shapes] == [2, 1, 1]
    assert all(s["suggestions"] for s in shapes)
    assert all(s["sample"] for s in shapes)


def test_union_publish_drains_all_shapes(client):
    shapes = client.post("/api/v1/onboarding/shapes", json={"raw": RAW, "source_name": SRC}).json()["shapes"]
    # Two lines quarantined first (one per syslog shape); the union publish
    # must release both without manual retry.
    first = client.post(
        "/api/v1/ingest",
        data={"raw": "<134>Sep 15 10:31:44 fw01 srcip=10.9.9.1 action=deny", "source": SRC},
    ).json()
    second = client.post(
        "/api/v1/ingest",
        data={"raw": "<134>Sep 15 10:31:45 fw01 srcip=10.9.9.2 action=deny ruleid=7", "source": SRC},
    ).json()
    assert first["status"] == "quarantined"
    assert second["status"] == "quarantined"

    seen: dict[str, str] = {}
    for shape in shapes:
        for s in shape["suggestions"]:
            if s["input_field"] not in seen and s["semantic_field"]:
                seen[s["input_field"]] = s["semantic_field"]
    # raw_text fallback keeps the freeform line mappable too.
    assert seen.get("ruleid") == "rule.id"
    assert seen.get("raw_text") == "log.original"

    created = client.post("/api/v1/onboarding", json={"sample": RAW.splitlines()[0], "source_name": SRC}).json()
    approved = client.post(
        f"/api/v1/onboarding/{created['id']}/approve",
        json={"source_name": SRC, "fields": [{"input_field": k, "semantic_field": v} for k, v in seen.items()]},
    ).json()
    assert approved["reprocessed_events"] == 2, approved
    for stored_id in (first["stored_event_id"], second["stored_event_id"]):
        detail = client.get(f"/api/v1/events/{stored_id}").json()
        assert detail["status"] in ("normalized", "output"), detail
