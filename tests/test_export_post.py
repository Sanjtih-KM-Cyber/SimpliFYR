# POST /export carries id sets in JSON (no URL length cap -> no 431).
# Uses the module-scoped `client` fixture from conftest.py.


def test_export_post_ids_roundtrip(client):
    one = client.post(
        "/api/v1/ingest", data={"raw": "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"}
    ).json()["stored_event_id"]
    two = client.post(
        "/api/v1/ingest", data={"raw": "<134>Sep 15 10:31:45 fw01 srcip=10.1.1.6 action=deny"}
    ).json()["stored_event_id"]
    res = client.post("/api/v1/export", json={"format": "json", "ids": [one, two]})
    assert res.status_code == 200, res.text
    assert res.json()["meta"]["count"] == 2
    assert res.headers["Content-Disposition"].startswith("attachment;")


def test_export_post_rejects_oversize_ids(client):
    res = client.post("/api/v1/export", json={"format": "json", "ids": list(range(10001))})
    assert res.status_code == 422
