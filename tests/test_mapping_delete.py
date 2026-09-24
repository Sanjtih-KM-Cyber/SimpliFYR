# DELETE /mappings/{id} (Schema Map delete): mapping + fields go, bound
# recipes are removed, audit records the deletion.
# Uses the module-scoped `client` fixture (isolated DB + raw storage).


def _create(client, name="Box-Delete Mapping"):
    res = client.post(
        "/api/v1/mappings",
        json={
            "name": name,
            "source": "Box-Delete",
            "fields": [{"input_field": "d1", "semantic_field": "source.ip"}],
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_delete_mapping_removes_recipe_binding(client):
    created = _create(client)
    recipe = client.post(
        "/api/v1/recipes", json={"source": "Box-Delete", "mapping_id": created["id"]}
    )
    assert recipe.status_code in (200, 201), recipe.text

    res = client.delete(f"/api/v1/mappings/{created['id']}")
    assert res.status_code == 204, res.text
    assert client.get(f"/api/v1/mappings/{created['id']}").status_code == 404

    recipes = client.get("/api/v1/recipes").json()
    assert all(r["mapping_id"] != created["id"] for r in recipes)

    audit = client.get("/api/v1/audit").json()
    assert any(
        a["action"] == "delete"
        and a["entity_type"] == "mapping"
        and a["entity_id"] == created["id"]
        for a in audit
    )


def test_delete_mapping_404(client):
    assert client.delete("/api/v1/mappings/999999").status_code == 404
