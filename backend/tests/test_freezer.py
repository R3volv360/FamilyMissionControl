import pytest

from app.modules.freezer.service import format_grams

MINCE = [{"weight_g": 400, "count": 2}, {"weight_g": 200, "count": 1}]


def add(client, name="Mince", packs=MINCE, total_g=None):
    body = {"name": name, "packs": packs}
    if total_g is not None:
        body["total_g"] = total_g
    return client.post("/api/freezer", json=body)


@pytest.mark.parametrize("g,label", [(200, "200 g"), (999, "999 g"), (1000, "1 kg"), (1250, "1.25 kg"),
                                     (1500, "1.5 kg"), (2005, "2.005 kg"), (12000, "12 kg")])
def test_format_grams(g, label):
    assert format_grams(g) == label


def test_add_with_packs_shows_total_and_breakdown(client):
    r = add(client, total_g=1000)  # F1: Mince, 1 kg as 2 × 400 g + 1 × 200 g
    assert r.status_code == 201, r.text
    e = r.json()["entry"]
    assert (e["name"], e["total_g"], e["total_label"], e["breakdown"]) == ("Mince", 1000, "1 kg", "2 × 400 g, 1 × 200 g")
    assert [(p["weight_g"], p["count"], p["label"]) for p in e["packs"]] == [(400, 2, "400 g"), (200, 1, "200 g")]
    assert [i["name"] for i in client.get("/api/items").json()] == ["Mince"]  # remembered


def test_total_must_match_packs(client):
    r = add(client, total_g=1200)
    assert r.status_code == 422 and "add up to 1 kg, not 1.2 kg" in r.json()["detail"]


@pytest.mark.parametrize("packs", [[], [{"weight_g": 0, "count": 1}], [{"weight_g": 400, "count": 0}],
                                   [{"weight_g": 60000, "count": 1}]])
def test_invalid_packs(client, packs):
    assert add(client, packs=packs).status_code == 422


def test_adding_same_item_again_adds_packs(client):
    first = add(client).json()["entry"]
    r = add(client, name="mince", packs=[{"weight_g": 400, "count": 1}, {"weight_g": 500, "count": 1}])
    assert r.status_code == 200 and r.json()["created"] is False
    e = r.json()["entry"]
    assert e["id"] == first["id"]
    assert e["breakdown"] == "1 × 500 g, 3 × 400 g, 1 × 200 g" and e["total_label"] == "1.9 kg"


def test_list_is_alphabetical(client):
    add(client, name="Peas", packs=[{"weight_g": 900}])
    add(client, name="chicken thighs", packs=[{"weight_g": 500, "count": 2}])
    assert [(e["name"], e["total_label"]) for e in client.get("/api/freezer").json()] == [
        ("Chicken thighs", "1 kg"), ("Peas", "900 g")]


def test_add_and_remove_packs_updates_total(client):
    e = add(client).json()["entry"]
    r = client.post(f"/api/freezer/{e['id']}/packs", json={"weight_g": 400})
    assert r.json()["breakdown"] == "3 × 400 g, 1 × 200 g" and r.json()["total_g"] == 1400
    r = client.post(f"/api/freezer/{e['id']}/packs", json={"weight_g": 250, "count": 2})
    assert r.json()["breakdown"] == "3 × 400 g, 2 × 250 g, 1 × 200 g"

    r = client.delete(f"/api/freezer/{e['id']}/packs/200")
    assert r.json()["entry"]["breakdown"] == "3 × 400 g, 2 × 250 g"
    r = client.delete(f"/api/freezer/{e['id']}/packs/400")
    assert r.json()["entry"]["breakdown"] == "2 × 400 g, 2 × 250 g" and r.json()["entry"]["total_g"] == 1300
    assert client.delete(f"/api/freezer/{e['id']}/packs/123").status_code == 404


def test_last_pack_gone_removes_item_but_keeps_name(client):
    e = add(client, packs=[{"weight_g": 400, "count": 1}]).json()["entry"]
    r = client.delete(f"/api/freezer/{e['id']}/packs/400")
    assert r.status_code == 200 and r.json() == {"entry": None}
    assert client.get("/api/freezer").json() == []
    assert [i["name"] for i in client.get("/api/items").json()] == ["Mince"]  # F3


def test_remove_whole_item(client):
    e = add(client).json()["entry"]
    assert client.delete(f"/api/freezer/{e['id']}").status_code == 204
    assert client.get("/api/freezer").json() == []
    assert client.delete(f"/api/freezer/{e['id']}").status_code == 404


def test_deleting_known_item_removes_freezer_entry(client):
    e = add(client).json()["entry"]
    assert client.get(f"/api/items/{e['item_id']}").json()["usage"] == {"freezer": 1}
    client.delete(f"/api/items/{e['item_id']}", params={"force": True})
    assert client.get("/api/freezer").json() == []


def test_merging_items_pools_packs(client):
    add(client, name="Mince")
    typo = add(client, name="Mnce", packs=[{"weight_g": 400, "count": 1}, {"weight_g": 750, "count": 1}]).json()["entry"]
    client.patch(f"/api/items/{typo['item_id']}", json={"name": "Mince", "merge": True})
    entries = client.get("/api/freezer").json()
    assert [(e["name"], e["breakdown"], e["total_label"]) for e in entries] == [
        ("Mince", "1 × 750 g, 3 × 400 g, 1 × 200 g", "2.15 kg")]


def test_item_in_pantry_and_freezer_reports_both(client):
    e = add(client).json()["entry"]
    client.post("/api/pantry", json={"name": "Mince"})
    assert client.get(f"/api/items/{e['item_id']}").json()["usage"] == {"pantry": 1, "freezer": 1}
