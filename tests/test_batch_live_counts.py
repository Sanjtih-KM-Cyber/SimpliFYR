# Batch counters are frozen at ingest; live_* reflects rows as they stand now,
# so badges clear the moment held logs drain.
# Uses the module-scoped `client` fixture from conftest.py.

RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"
SRC = "Live Count Box"


def test_live_held_tracks_reality(client):
    batch_id = client.post("/api/v1/process/batch", data={"raw": RAW, "source": SRC}).json()["batch_id"]
    runs = {r["id"]: r for r in client.get("/api/v1/process/batches").json()}
    run = runs[batch_id]
    assert run["quarantined"] == 1
    assert run["live_held"] == 1

    # Publish a covering mapping, retry the held row, and watch live move
    # while the frozen ingest counters stand still.
    mapping_id = client.post(
        "/api/v1/mappings",
        json={
            "name": "Live Count Mapping",
            "source": SRC,
            "fields": [
                {"input_field": "srcip", "semantic_field": "source.ip"},
                {"input_field": "action", "semantic_field": "network.action"},
            ],
        },
    ).json()["id"]
    client.patch(f"/api/v1/mappings/{mapping_id}", json={"status": "published"})
    stored = client.post("/api/v1/events/batch-retry", json={"ids": [1]}).json()
    assert stored["retried"] == [1]
    runs = {r["id"]: r for r in client.get("/api/v1/process/batches").json()}
    run = runs[batch_id]
    assert run["quarantined"] == 1  # frozen history
    assert run["live_held"] == 0  # current truth
    assert run["live_normalized"] == 1
