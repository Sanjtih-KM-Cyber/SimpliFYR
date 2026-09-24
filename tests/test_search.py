# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).


def _ingest(client, raw: str, source: str):
    res = client.post("/api/v1/ingest", data={"raw": raw, "source": source})
    assert res.status_code == 200
    return res.json()


def test_search_finds_substring(client):
    _ingest(client, "<134>Sep 15 10:31:44 fw01 srcip=10.77.0.1 action=deny", "Hunt Box")
    res = client.get("/api/v1/events/search", params={"q": "10.77.0.1"}).json()
    assert any(e["source"] == "Hunt Box" for e in res)


def test_search_filters_by_status_and_source(client):
    _ingest(client, "<134>Sep 15 10:31:44 fw01 srcip=10.77.0.2 action=deny", "Hunt Box")
    res = client.get(
        "/api/v1/events/search", params={"q": "10.77.0", "source": "Hunt Box"}
    ).json()
    assert res and all(e["source"] == "Hunt Box" for e in res)
    assert client.get("/api/v1/events/search", params={"q": "10.77.0", "source": "Nobody"}).json() == []


def test_search_rejects_short_or_blank_query(client):
    assert client.get("/api/v1/events/search", params={"q": "x"}).status_code == 422
    assert client.get("/api/v1/events/search").status_code == 422


def test_search_escapes_wildcards(client):
    # % must match literally, not as a LIKE wildcard: "100%" as a pattern
    # would otherwise match the stored "100pct".
    _ingest(client, "<134>Sep 15 10:31:44 fw01 note=100pct action=deny", "Hunt Box")
    assert any(
        e["source"] == "Hunt Box"
        for e in client.get("/api/v1/events/search", params={"q": "100pct"}).json()
    )
    assert (
        client.get("/api/v1/events/search", params={"q": "100%", "source": "Hunt Box"}).json()
        == []
    )
