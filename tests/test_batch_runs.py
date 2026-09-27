"""Batch runs: one set of logs parsed at one time gets a single identity."""

BATCH_RAW = "<134>Sep 15 10:31:44 fw01 srcip=10.20.0.{n} action=deny"


def _run_batch(client, source, count=3, start=1):
    raw = "\n".join(BATCH_RAW.format(n=start + i) for i in range(count))
    res = client.post("/api/v1/process/batch", data={"raw": raw, "source": source})
    assert res.status_code == 200, res.text
    return res.json()


def test_batch_creates_run_and_tags_members(client):
    body = _run_batch(client, "BatchRun-Vendor", count=3, start=1)
    assert body["batch_id"]
    assert body["total"] == 3

    listing = client.get("/api/v1/process/batches").json()
    run = next(r for r in listing if r["id"] == body["batch_id"])
    assert run["source"] == "BatchRun-Vendor"
    assert run["total"] == 3

    events = client.get("/api/v1/events", params={"source": "BatchRun-Vendor"}).json()
    assert len(events) == 3
    assert {e["batch_id"] for e in events} == {body["batch_id"]}


def test_batch_duplicates_keep_original_batch(client):
    first = _run_batch(client, "BatchDup-Vendor", count=2, start=41)
    first_ids = {r["stored_event_id"] for r in first["results"]}
    second = _run_batch(client, "BatchDup-Vendor", count=2, start=41)
    assert second["batch_id"] != first["batch_id"]
    # Replays reference the original rows; the originals keep their batch.
    events = client.get("/api/v1/events", params={"source": "BatchDup-Vendor"}).json()
    assert {e["id"] for e in events} == first_ids
    assert {e["batch_id"] for e in events} == {first["batch_id"]}


def test_single_ingest_has_no_batch(client):
    res = client.post(
        "/api/v1/ingest",
        data={"raw": BATCH_RAW.format(n=99), "source": "BatchSingle-Vendor"},
    )
    assert res.status_code == 200
    detail = client.get(f"/api/v1/events/{res.json()['stored_event_id']}").json()
    assert detail["batch_id"] is None


def test_batches_list_newest_first(client):
    first = _run_batch(client, "BatchOrder-Vendor", count=1, start=61)
    second = _run_batch(client, "BatchOrder-Vendor", count=1, start=62)
    listing = client.get("/api/v1/process/batches").json()
    mine = [r["id"] for r in listing if r["source"] == "BatchOrder-Vendor"]
    assert mine == sorted(mine, reverse=True)
    assert mine[0] == second["batch_id"]
    assert mine[1] == first["batch_id"]
