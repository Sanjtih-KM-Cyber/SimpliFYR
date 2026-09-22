# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).


def _mapping_payload(source: str) -> dict:
    return {
        "name": f"Mapping {source}",
        "source": source,
        "fields": [
            {"input_field": "srcip", "semantic_field": "source.ip"},
            {"input_field": "dstip", "semantic_field": "destination.ip"},
            {"input_field": "dport", "semantic_field": "destination.port"},
            {"input_field": "action", "semantic_field": "network.action"},
        ],
    }


def _publish(client, mapping_id: int):
    from app.core.database import SessionLocal
    from app.models import Mapping

    with SessionLocal() as db:
        db.get(Mapping, mapping_id).status = "published"
        db.commit()


def _setup(client, source: str) -> None:
    _publish(client, client.post("/api/v1/mappings", json=_mapping_payload(source)).json()["id"])


def _ingest(client, raw: str, source: str) -> dict:
    res = client.post("/api/v1/ingest", data={"raw": raw, "source": source})
    assert res.status_code == 200
    return res.json()


def test_search_hunts_by_semantic_field(client):
    src = "Search-Vendor-A"
    _setup(client, src)
    _ingest(client, "<134>Sep 15 10:00:00 fw srcip=10.0.0.1 dstip=8.8.8.8 dport=443 action=deny", src)
    _ingest(client, "<134>Sep 15 10:00:01 fw srcip=10.0.0.2 dstip=1.1.1.1 dport=80 action=allow", src)
    _ingest(client, "<134>Sep 15 10:00:02 fw srcip=10.0.0.1 dstip=9.9.9.9 dport=53 action=deny", src)

    hits = client.get(
        "/api/v1/analytics/search", params=[("filter", "source.ip=10.0.0.1")]
    ).json()
    assert len(hits) == 2
    assert all(h["normalized"]["source"]["ip"] == "10.0.0.1" for h in hits)

    denied = client.get(
        "/api/v1/analytics/search", params=[("filter", "network.action=deny")]
    ).json()
    assert len(denied) == 2


def test_aggregate_counts_by_group(client):
    src = "Aggregate-Vendor-B"
    _setup(client, src)
    _ingest(client, "<134>Sep 15 10:00:00 fw srcip=10.1.0.1 dstip=8.8.8.8 dport=443 action=deny", src)
    _ingest(client, "<134>Sep 15 10:00:01 fw srcip=10.1.0.2 dstip=1.1.1.1 dport=80 action=allow", src)

    rows = client.get("/api/v1/analytics/aggregate", params={"group_by": "source.ip"}).json()
    assert any(r["value"] == "10.1.0.1" and r["count"] == 1 for r in rows)
    assert any(r["value"] == "10.1.0.2" and r["count"] == 1 for r in rows)

    actions = client.get(
        "/api/v1/analytics/aggregate", params={"group_by": "network.action"}
    ).json()
    values = {r["value"] for r in actions}
    assert "allow" in values and "deny" in values


def test_anomalies_detects_high_volume_and_scanner(client):
    src = "Anomaly-Vendor-C"
    _setup(client, src)
    for i in range(5):
        _ingest(client, f"<134>Sep 15 10:01:0{i} fw srcip=10.2.0.1 dstip=2.2.2.{i} dport=80 action=deny", src)
    _ingest(client, "<134>Sep 15 10:02:00 fw srcip=10.2.0.9 dstip=3.3.3.1 dport=80 action=allow", src)

    res = client.get("/api/v1/analytics/anomalies", params={"threshold": 3}).json()
    assert any(s["source_ip"] == "10.2.0.1" for s in res["high_volume"])
    # 10.2.0.1 hit 5 distinct destinations -> scanner
    assert any(s["source_ip"] == "10.2.0.1" for s in res["scanners"])


def test_correlations_port_scan(client):
    src = "Correlation-Vendor-D"
    _setup(client, src)
    for port in (1, 2, 3, 4, 5):
        _ingest(
            client,
            f"<134>Sep 15 10:00:00 fw srcip=10.3.0.1 dstip=8.8.8.8 dport={port} action=deny",
            src,
        )

    res = client.get(
        "/api/v1/analytics/correlations", params={"rule": "port_scan", "threshold": 5}
    ).json()
    assert any(f["source_ip"] == "10.3.0.1" and f["distinct_ports"] >= 5 for f in res)


def test_correlations_beaconing(client):
    src = "Beacon-Vendor-E"
    _setup(client, src)
    # Distinct raw payloads (timestamps vary so dedup keeps all five);
    # semantic grouping key (source.ip, destination.ip) is unchanged.
    for i in range(5):
        _ingest(client, f"<134>Sep 15 10:00:0{i} fw srcip=10.4.0.1 dstip=8.8.8.8 dport=443 action=allow", src)

    res = client.get(
        "/api/v1/analytics/correlations", params={"rule": "beaconing", "threshold": 5}
    ).json()
    assert any(f["source_ip"] == "10.4.0.1" and f["count"] >= 5 for f in res)