# Uses the module-scoped `client` fixture from conftest.py (isolated DB + raw storage).


def test_catalog_vendor_product_source_version_flow(client):
    vendor = client.post("/api/v1/catalog/vendors", json={"name": "Acme"}).json()
    assert vendor["id"] > 0

    product = client.post(
        "/api/v1/catalog/products", json={"name": "Firewall", "vendor_id": vendor["id"]}
    ).json()
    assert product["vendor_id"] == vendor["id"]

    source = client.post(
        "/api/v1/catalog/sources",
        json={"name": "Acme FW", "product_id": product["id"], "address": "10.0.0.1"},
    ).json()
    assert source["product_id"] == product["id"]
    assert source["status"] == "active"

    versions = client.get(f"/api/v1/catalog/sources/{source['id']}/versions").json()
    assert len(versions) == 1 and versions[0]["version"] == "v1"

    v2 = client.post(
        f"/api/v1/catalog/sources/{source['id']}/versions", json={"version": "v2"}
    ).json()
    assert v2["version"] == "v2"

    dup = client.post(
        f"/api/v1/catalog/sources/{source['id']}/versions", json={"version": "v2"}
    )
    assert dup.status_code == 409

    patched = client.patch(
        f"/api/v1/catalog/sources/{source['id']}", json={"status": "inactive"}
    ).json()
    assert patched["status"] == "inactive"

    assert client.get("/api/v1/catalog/vendors").json()
    assert client.get("/api/v1/catalog/sources").json()


def test_catalog_rejects_bad_refs(client):
    assert client.post("/api/v1/catalog/vendors", json={"name": "  "}).status_code == 422
    assert client.post("/api/v1/catalog/products", json={"name": "X", "vendor_id": 99999}).status_code == 404
    assert client.get("/api/v1/catalog/sources/99999").status_code == 404


def test_mapping_links_source_version(client):
    vendor = client.post("/api/v1/catalog/vendors", json={"name": "Acme"}).json()
    product = client.post(
        "/api/v1/catalog/products", json={"name": "FW", "vendor_id": vendor["id"]}
    ).json()
    source = client.post(
        "/api/v1/catalog/sources", json={"name": "Acme FW", "product_id": product["id"]}
    ).json()
    version_id = client.get(f"/api/v1/catalog/sources/{source['id']}/versions").json()[0]["id"]

    mapping = client.post(
        "/api/v1/mappings",
        json={
            "name": "Acme v1",
            "source_version_id": version_id,
            "fields": [{"input_field": "srcip", "semantic_field": "source.ip"}],
        },
    ).json()
    assert mapping["source_version_id"] == version_id
    assert mapping["source"] == "Acme FW"

    bad = client.post(
        "/api/v1/mappings",
        json={"name": "Bad", "source_version_id": 99999, "fields": []},
    )
    assert bad.status_code == 404


def test_mapping_lifecycle_rejects_backward(client):
    mapping = client.post(
        "/api/v1/mappings",
        json={"name": "M", "source": "S", "fields": []},
    ).json()
    assert client.patch(f"/api/v1/mappings/{mapping['id']}", json={"status": "published"}).status_code == 200
    back = client.patch(f"/api/v1/mappings/{mapping['id']}", json={"status": "draft"})
    assert back.status_code == 422
