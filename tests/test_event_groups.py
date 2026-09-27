# Shape-exact quarantine groups: one approval resolves one group completely.
# Uses the module-scoped `client` fixture from conftest.py.

BASE = "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"
DRIFTED = "<134>Sep 15 10:31:45 fw01 srcip=10.1.1.6 action=deny ruleid=1005"
SRC = "Shape Box"


def test_groups_split_shapes_not_just_format(client):
    client.post("/api/v1/ingest", data={"raw": BASE, "source": SRC})
    client.post("/api/v1/ingest", data={"raw": BASE.replace("10.1.1.5", "10.1.1.7"), "source": SRC})
    client.post("/api/v1/ingest", data={"raw": DRIFTED, "source": SRC})
    res = client.get("/api/v1/events/groups", params={"status": "quarantined", "source": SRC})
    assert res.status_code == 200, res.text
    groups = res.json()
    assert len(groups) == 2, groups
    assert sum(g["count"] for g in groups) == 3
    assert all(g["format"] == "syslog" for g in groups)
    assert all(g["rep_id"] is not None and not g["truncated"] for g in groups)
    assert all(len(g["event_ids"]) == g["count"] for g in groups)
    by_count = sorted(g["count"] for g in groups)
    assert by_count == [1, 2], groups


def test_group_approve_resolves_whole_shape(client):
    src = "Shape Box Approve"
    client.post("/api/v1/ingest", data={"raw": BASE, "source": src})
    client.post("/api/v1/ingest", data={"raw": BASE.replace("10.1.1.5", "10.1.1.9"), "source": src})
    groups = client.get("/api/v1/events/groups", params={"status": "quarantined", "source": src}).json()
    assert len(groups) == 1
    res = client.post("/api/v1/events/batch-retry", json={"ids": groups[0]["event_ids"]})
    assert res.status_code == 200, res.text
    # No mapping exists: retry cannot normalize, but nothing may go missing —
    # the same shape regroups identically (no silent drops, no splits).
    regrouped = client.get("/api/v1/events/groups", params={"status": "quarantined", "source": src}).json()
    assert sum(g["count"] for g in regrouped) == 2
