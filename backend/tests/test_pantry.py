def add(client, name):
    return client.post("/api/pantry", json={"name": name})


def names_levels(client):
    return [(e["name"], e["level"]) for e in client.get("/api/pantry").json()]


def test_add_by_name_is_remembered_and_fully_stocked(client):
    r = add(client, "basil")
    assert r.status_code == 201
    entry = r.json()["entry"]
    assert entry["name"] == "Basil" and entry["level"] == "full"
    assert [i["name"] for i in client.get("/api/items", params={"q": "ba"}).json()] == ["Basil"]  # P1/P4


def test_adding_again_returns_existing(client):
    first = add(client, "Basil").json()["entry"]
    r = add(client, "basil ")
    assert r.status_code == 200 and r.json() == {"entry": first, "created": False}
    assert len(client.get("/api/pantry").json()) == 1


def test_add_uses_existing_known_item(client):
    item = client.post("/api/items", json={"name": "Balsamic Vinegar"}).json()["item"]
    assert add(client, "balsamic vinegar").json()["entry"]["item_id"] == item["id"]


def test_add_rejects_blank(client):
    assert add(client, "  ").status_code == 422


def test_list_is_alphabetical_with_levels(client):
    for n in ["Salt", "basil", "Olive oil"]:
        add(client, n)
    assert names_levels(client) == [("Basil", "full"), ("Olive oil", "full"), ("Salt", "full")]


def test_set_stock_level_and_empty_stays_listed(client):
    e = add(client, "Basil").json()["entry"]
    for level in ["one", "empty", "full", "empty"]:
        r = client.patch(f"/api/pantry/{e['id']}", json={"level": level})
        assert r.status_code == 200 and r.json()["level"] == level
    assert names_levels(client) == [("Basil", "empty")]  # P3: empty items stay on the list


def test_set_invalid_level(client):
    e = add(client, "Basil").json()["entry"]
    assert client.patch(f"/api/pantry/{e['id']}", json={"level": "lots"}).status_code == 422
    assert client.patch("/api/pantry/999", json={"level": "one"}).status_code == 404


def test_remove_from_pantry_keeps_known_item(client):
    e = add(client, "Basil").json()["entry"]
    assert client.delete(f"/api/pantry/{e['id']}").status_code == 204
    assert client.get("/api/pantry").json() == []
    assert [i["name"] for i in client.get("/api/items").json()] == ["Basil"]


def test_rename_known_item_shows_in_pantry(client):
    e = add(client, "Bazil").json()["entry"]
    client.patch(f"/api/items/{e['item_id']}", json={"name": "Basil"})
    assert names_levels(client) == [("Basil", "full")]


def test_deleting_known_item_reports_and_removes_pantry_entry(client):
    e = add(client, "Basil").json()["entry"]
    r = client.delete(f"/api/items/{e['item_id']}")
    assert r.status_code == 409 and r.json()["detail"]["usage"] == {"pantry": 1}
    assert client.delete(f"/api/items/{e['item_id']}", params={"force": True}).status_code == 204
    assert client.get("/api/pantry").json() == []


def test_merging_items_both_in_pantry_keeps_lower_level(client):
    basil = add(client, "Basil").json()["entry"]
    typo = add(client, "Bazil").json()["entry"]
    client.patch(f"/api/pantry/{typo['id']}", json={"level": "empty"})
    client.patch(f"/api/items/{typo['item_id']}", json={"name": "Basil", "merge": True})
    assert names_levels(client) == [("Basil", "empty")]
    assert client.get("/api/pantry").json()[0]["id"] == basil["id"]


def test_merging_item_not_in_pantry_moves_entry(client):
    typo = add(client, "Bazil").json()["entry"]
    basil = client.post("/api/items", json={"name": "Basil"}).json()["item"]
    client.patch(f"/api/items/{typo['item_id']}", json={"name": "Basil", "merge": True})
    entries = client.get("/api/pantry").json()
    assert [(e["item_id"], e["name"]) for e in entries] == [(basil["id"], "Basil")]
