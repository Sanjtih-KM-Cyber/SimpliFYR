# Per-connection numbering: each source counts 1, 2, 3...; sourceless stays NULL.
# Uses the module-scoped `client` fixture from conftest.py.

A1 = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"
A2 = "<134>Sep 15 10:31:45 fw01 srcip=10.1.1.6 action=deny"
B1 = "<134>Sep 15 10:31:46 fw02 srcip=10.2.2.5 action=allow"


def _seq(client, stored_id: int):
    return client.get(f"/api/v1/events/{stored_id}").json()["source_seq"]


def test_sequences_are_per_source(client):
    a1 = client.post("/api/v1/ingest", data={"raw": A1, "source": "Seq A"}).json()
    b1 = client.post("/api/v1/ingest", data={"raw": B1, "source": "Seq B"}).json()
    a2 = client.post("/api/v1/ingest", data={"raw": A2, "source": "Seq A"}).json()
    bare = client.post("/api/v1/ingest", data={"raw": A1}).json()
    assert _seq(client, a1["stored_event_id"]) == 1
    assert _seq(client, b1["stored_event_id"]) == 1
    assert _seq(client, a2["stored_event_id"]) == 2
    assert _seq(client, bare["stored_event_id"]) is None


def test_batch_continues_sequence(client):
    src = "Seq Batch"
    first = client.post("/api/v1/ingest", data={"raw": A1, "source": src}).json()
    assert _seq(client, first["stored_event_id"]) == 1
    batch = client.post(
        "/api/v1/process/batch",
        data={"raw": "\n".join([A2, B1]), "source": src},
    ).json()
    assert batch["processed"] == 2
    rows = client.get("/api/v1/events", params={"source": src}).json()
    assert sorted(r["source_seq"] for r in rows) == [1, 2, 3]
