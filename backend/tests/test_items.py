import pytest

from app.modules.items import service
from app.modules.items.service import normalise_key, tidy_name


# ---- names ---------------------------------------------------------------------------------------------

@pytest.mark.parametrize("a,b", [
    ("Carrots", "carrot"),
    ("  CARROT ", "Carrot"),
    ("Tomatoes", "tomato"),
    ("Berries", "berry"),
    ("Peaches", "peach"),
    ("Chicken breasts", "chicken breast"),
    ("Salt &amp; pepper", "salt & pepper"),
    ("<b>Rice</b>", "rice"),
    ("Balsamic  vinegar", "balsamic vinegar"),
])
def test_same_key(a, b):
    assert normalise_key(a) == normalise_key(b)


@pytest.mark.parametrize("word", ["Glass", "Hummus", "Couscous", "Swiss", "Basil", "Peas"])
def test_words_that_must_not_lose_their_s_wrongly(word):
    # These keep a stable key whatever happens; what matters is singular and plural agree where both exist.
    assert normalise_key(word) == normalise_key(word.upper())


def test_hummus_and_glass_not_truncated():
    assert normalise_key("Hummus") == "hummus"
    assert normalise_key("Glass") == "glass"


def test_tidy_name():
    assert tidy_name("  balsamic   vinegar ") == "Balsamic vinegar"
    assert tidy_name("Salt &amp; pepper") == "Salt & pepper"


# ---- API -----------------------------------------------------------------------------------------------

def add(client, name):
    return client.post("/api/items", json={"name": name})


def test_create_then_same_name_returns_existing(client):
    r1 = add(client, "Carrots")
    assert r1.status_code == 201 and r1.json()["created"] is True
    r2 = add(client, "carrot")
    assert r2.status_code == 200 and r2.json() == {"item": r1.json()["item"], "created": False}
    assert [i["name"] for i in client.get("/api/items").json()] == ["Carrots"]


def test_create_rejects_blank(client):
    assert add(client, "   ").status_code == 422


def test_search_suggests_prefix_then_word_matches(client):
    for n in ["Basil", "Balsamic Vinegar", "Bay leaves", "Red wine vinegar", "Garlic"]:
        add(client, n)
    names = lambda q: [i["name"] for i in client.get("/api/items", params={"q": q}).json()]
    assert names("Ba") == ["Balsamic Vinegar", "Basil", "Bay leaves"]
    assert names("vin") == ["Balsamic Vinegar", "Red wine vinegar"]
    assert names("ba%") == []  # LIKE wildcards are literal
    assert names("") == []


def test_list_is_alphabetical(client):
    for n in ["garlic", "Basil", "apple"]:
        add(client, n)
    assert [i["name"] for i in client.get("/api/items").json()] == ["Apple", "Basil", "Garlic"]


def test_rename_fixes_typo(client):
    item = add(client, "Bazil").json()["item"]
    r = client.patch(f"/api/items/{item['id']}", json={"name": "Basil"})
    assert r.status_code == 200
    assert r.json() == {"item": {"id": item["id"], "name": "Basil"}, "merged_from": None}


def test_rename_same_key_changes_display_only(client):
    item = add(client, "carrot").json()["item"]
    r = client.patch(f"/api/items/{item['id']}", json={"name": "Carrots"})
    assert r.json()["item"] == {"id": item["id"], "name": "Carrots"}


def test_rename_onto_existing_name_needs_merge(client):
    basil = add(client, "Basil").json()["item"]
    typo = add(client, "Bazil").json()["item"]
    r = client.patch(f"/api/items/{typo['id']}", json={"name": "basil"})
    assert r.status_code == 409
    assert r.json()["detail"]["conflict"] == basil

    r = client.patch(f"/api/items/{typo['id']}", json={"name": "basil", "merge": True})
    assert r.status_code == 200
    assert r.json() == {"item": basil, "merged_from": typo["id"]}
    assert client.get(f"/api/items/{typo['id']}").status_code == 404


def test_delete_unused(client):
    item = add(client, "Basil").json()["item"]
    assert client.delete(f"/api/items/{item['id']}").status_code == 204
    assert client.get("/api/items").json() == []
    assert client.delete(f"/api/items/{item['id']}").status_code == 404


# ---- references from other modules ---------------------------------------------------------------------

class FakeRefs:
    """Stands in for e.g. the pantry: a set of item ids it references."""

    label = "pantry"

    def __init__(self):
        self.ids: set[int] = set()

    def usage(self, db, item_id):
        return int(item_id in self.ids)

    def reassign(self, db, from_id, to_id):
        if from_id in self.ids:
            self.ids.discard(from_id)
            self.ids.add(to_id)

    def detach(self, db, item_id):
        self.ids.discard(item_id)


@pytest.fixture
def refs(monkeypatch):
    fake = FakeRefs()
    monkeypatch.setattr(service, "_providers", {"pantry": fake})
    return fake


def test_detail_shows_usage(client, refs):
    item = add(client, "Basil").json()["item"]
    refs.ids.add(item["id"])
    assert client.get(f"/api/items/{item['id']}").json() == {**item, "usage": {"pantry": 1}}


def test_delete_in_use_refused_unless_forced(client, refs):
    item = add(client, "Basil").json()["item"]
    refs.ids.add(item["id"])
    r = client.delete(f"/api/items/{item['id']}")
    assert r.status_code == 409 and r.json()["detail"]["usage"] == {"pantry": 1}

    assert client.delete(f"/api/items/{item['id']}", params={"force": True}).status_code == 204
    assert refs.ids == set()


def test_merge_moves_references(client, refs):
    basil = add(client, "Basil").json()["item"]
    typo = add(client, "Bazil").json()["item"]
    refs.ids.add(typo["id"])
    client.patch(f"/api/items/{typo['id']}", json={"name": "Basil", "merge": True})
    assert refs.ids == {basil["id"]}
