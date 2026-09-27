# Online field memory: a custom semantic approved once is reused on next proposal.
# Uses the module-scoped `client` fixture from conftest.py.

CUSTOM_INPUT = "myvendor_cohort_xyz"
CUSTOM_SEMANTIC = "device.product"


def _publish_custom(client, source: str):
    mapping_id = client.post(
        "/api/v1/mappings",
        json={
            "name": f"Mapping {source}",
            "source": source,
            "fields": [{"input_field": CUSTOM_INPUT, "semantic_field": CUSTOM_SEMANTIC}],
        },
    ).json()["id"]
    res = client.patch(f"/api/v1/mappings/{mapping_id}", json={"status": "published"})
    assert res.status_code == 200, res.text
    return mapping_id


def test_custom_semantic_reused_without_retraining(client):
    _publish_custom(client, "Memory Box A")
    res = client.post(
        "/api/v1/onboarding/analyze",
        data={"raw": f"<134>Sep 15 10:31:44 fw01 {CUSTOM_INPUT}=zone9 srcip=10.1.1.5", "source": "Memory Box B"},
    )
    assert res.status_code == 200, res.text
    suggestions = {s["input_field"]: s for s in res.json()["suggestions"]}
    assert CUSTOM_INPUT in suggestions, suggestions
    assert suggestions[CUSTOM_INPUT]["semantic_field"] == CUSTOM_SEMANTIC
    assert "learned" in suggestions[CUSTOM_INPUT]["reason"].lower()


def test_keyword_mappings_not_overridden_by_memory(client):
    _publish_custom(client, "Memory Box C")
    res = client.post(
        "/api/v1/onboarding/analyze",
        data={"raw": "<134>Sep 15 10:31:44 fw01 srcip=10.9.9.9 action=deny", "source": "Memory Box D"},
    )
    assert res.status_code == 200, res.text
    suggestions = {s["input_field"]: s["semantic_field"] for s in res.json()["suggestions"]}
    assert suggestions["srcip"] == "source.ip"
    assert suggestions["action"] == "network.action"
