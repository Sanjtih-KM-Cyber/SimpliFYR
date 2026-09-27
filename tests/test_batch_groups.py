# Upload-first grouping: one batch -> deduplicated type groups (held included).
# Uses the module-scoped `client` fixture from conftest.py.

RAW = (
    "<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny\n"
    "<134>Sep 15 10:31:45 fw01 srcip=10.1.1.6 action=deny\n"
    "<134>Sep 15 10:31:46 fw01 srcip=10.1.1.7 action=deny dstip=8.8.8.8\n"
    "CEF:0|VendorX|FirewallY|6.5|1001|Deny|5|src=10.1.1.8 act=deny\n"
    "just some freeform raw line"
)


def test_batch_groups_split_types_and_include_held(client):
    # Distinct source per test: replay identity is hash+source+env, so a
    # second identical batch would dedup against the first one's events.
    batch_id = client.post("/api/v1/process/batch", data={"raw": RAW, "source": "Group Box A"}).json()["batch_id"]
    res = client.get(f"/api/v1/process/batches/{batch_id}/groups")
    assert res.status_code == 200, res.text
    groups = res.json()
    # syslog base x2, syslog+dstip x1, cef x1, raw x1 = 4 type groups.
    assert len(groups) == 4, groups
    assert sum(g["count"] for g in groups) == 5
    by_format = {}
    for g in groups:
        by_format.setdefault(g["format"], []).append(g)
    assert len(by_format["syslog"]) == 2
    assert by_format["cef"][0]["count"] == 1
    assert by_format["raw"][0]["count"] == 1
    # No mapping: everything quarantined -> held mirrors count.
    assert all(g["held"] == g["count"] for g in groups)
    assert all(g["rep_id"] is not None and not g["truncated"] for g in groups)
    assert all(len(g["event_ids"]) == g["count"] for g in groups)


def test_batch_groups_download_roundtrip(client):
    batch_id = client.post("/api/v1/process/batch", data={"raw": RAW, "source": "Group Box B"}).json()["batch_id"]
    groups = client.get(f"/api/v1/process/batches/{batch_id}/groups").json()
    biggest = max(groups, key=lambda g: g["count"])
    res = client.get(
        "/api/v1/export", params={"format": "json", "ids": ",".join(map(str, biggest["event_ids"]))}
    )
    assert res.status_code == 200, res.text
    assert res.json()["meta"]["count"] == biggest["count"]


def test_batch_groups_404(client):
    assert client.get("/api/v1/process/batches/999999/groups").status_code == 404
