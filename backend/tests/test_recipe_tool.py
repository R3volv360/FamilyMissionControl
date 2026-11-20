"""Recipe Tool (spec T1–T9, T11): create and edit recipes, stored as recipe.json through the Recipes module."""
import json

from tests.conftest import BUCKET
from tests.test_recipes import SLUG, s3_index, s3_keys, upload

JPEG = b"\xff\xd8\xff\xe0" + b"photo"


def jpeg(tag: str) -> bytes:
    return JPEG + tag.encode()


def save(client, recipe: dict, photos: dict[str, bytes] | None = None, overwrite=False):
    files = [("photos", (name, content, "image/jpeg")) for name, content in (photos or {}).items()]
    return client.post("/api/recipe_tool/save", data={"recipe": json.dumps(recipe), "overwrite": str(overwrite).lower()},
                       files=files or None)


def stored_json(settings, slug):
    return json.loads((settings.recipes_dir / slug / "recipe.json").read_text(encoding="utf-8"))


def stored_files(settings, slug):
    return sorted(p.name for p in (settings.recipes_dir / slug).iterdir())


NEW = {
    "title": "  Mum's   Lasagne ",
    "subtitle": "with garlic bread",
    "serves": 6,
    "hero": "new",
    "ingredients": [
        {"qty": "500 g", "name": "Beef mince"},
        {"qty": "2", "name": "Onions"},
        {"qty": "", "name": "  "},  # blank row: dropped
        {"qty": "1 tbsp", "name": "Olive oil", "cupboard": True},
    ],
    "steps": [
        {"title": "Brown the mince", "text": "Heat the oil.\n\n  Fry the mince & onions.  "},
        {"title": "", "text": ""},  # blank step: dropped
        {"title": "Bake", "text": "40 mins at 180°C.", "photo": "new"},
    ],
}


# ---- creating (T1, T3, T4, T6, T7, T8) ------------------------------------------------------------------

def test_create_saves_recipe_json_photos_and_s3(client, settings, s3):
    r = save(client, NEW, {"hero.jpg": jpeg("hero"), "step-3.jpg": jpeg("bake")})
    assert r.status_code == 200, r.text
    assert r.json()["recipe"]["slug"] == "mum-s-lasagne"
    assert r.json()["warnings"] == []

    data = stored_json(settings, "mum-s-lasagne")
    assert data["title"] == "Mum's Lasagne"
    assert data["serves"] == 6
    assert data["ingredients"] == [["500 g", "Beef mince", ""], ["2", "Onions", ""]]
    assert data["pantry"] == [["1 tbsp", "Olive oil"]]
    assert data["steps"] == [
        ["Brown the mince", ["Heat the oil.", "Fry the mince &amp; onions."]],
        ["Bake", ["40 mins at 180°C."]],
    ]
    # The blank step is gone, so the third editor step's photo becomes s2.jpg.
    assert stored_files(settings, "mum-s-lasagne") == ["hero.jpg", "recipe.json", "s2.jpg"]
    assert (settings.recipes_dir / "mum-s-lasagne" / "s2.jpg").read_bytes() == jpeg("bake")

    # Same as an upload: known items linked (R1), pushed to S3 and the Alexa index (T8).
    names = {i["name"] for i in client.get("/api/items").json()}
    assert {"Beef mince", "Onions", "Olive oil"} <= names
    assert "recipes/mum-s-lasagne/s2.jpg" in s3_keys(s3)
    assert [e["title"] for e in s3_index(s3)] == ["Mum's Lasagne"]
    assert client.get("/api/recipes/mum-s-lasagne").json()["s3_state"] == "done"


def test_create_needs_a_name(client):
    assert save(client, {**NEW, "title": "   ", "hero": "none"}).status_code == 422
    assert save(client, {**NEW, "title": "!!!", "hero": "none"}).status_code == 422


def test_new_photo_must_arrive_and_be_a_jpeg(client):
    r = save(client, NEW, {"hero.jpg": jpeg("hero")})  # step-3.jpg missing
    assert r.status_code == 422 and "step-3.jpg" in r.json()["detail"]
    r = save(client, NEW, {"hero.jpg": b"GIF89a", "step-3.jpg": jpeg("x")})
    assert r.status_code == 422 and "JPEG" in r.json()["detail"]


def test_new_recipe_cannot_keep_photos(client):
    assert save(client, {**NEW, "hero": "keep"}).status_code == 422


def test_bad_payload_is_422(client):
    r = client.post("/api/recipe_tool/save", data={"recipe": "{not json"})
    assert r.status_code == 422
    assert save(client, {**NEW, "serves": 0}).status_code == 422


def test_create_with_existing_name_warns_then_replaces(client, settings):
    plain = {**NEW, "hero": "none", "steps": NEW["steps"][:1]}
    assert save(client, plain).status_code == 200
    r = save(client, {**plain, "subtitle": "second"})
    assert r.status_code == 409 and r.json()["detail"]["exists_in"] == "the app"
    r = save(client, {**plain, "subtitle": "second"}, overwrite=True)
    assert r.status_code == 200 and r.json()["replaced"] is True
    assert stored_json(settings, "mum-s-lasagne")["subtitle"] == "second"


# ---- editing a skill recipe (T2, T5, T6, T7) -----------------------------------------------------------

def test_load_gives_plain_text_rows(client):
    upload(client, photos=["hero.jpg", "s1.jpg", "s3.jpg"])
    r = client.get(f"/api/recipe_tool/recipes/{SLUG}")
    assert r.status_code == 200
    rec = r.json()
    assert rec["slug"] == SLUG and rec["serves"] == 4 and rec["hero"] == "keep"
    assert rec["ingredients"][0] == {"qty": "320 g", "name": "King prawns", "cupboard": False,
                                     "allergens": "Crustaceans"}
    assert rec["ingredients"][-1]["name"] == "Salt & pepper, to taste"
    assert rec["ingredients"][-1]["cupboard"] is True
    assert [s["photo"] for s in rec["steps"]] == ["keep", "none", "keep", "none", "none"]
    assert [s["photo_from"] for s in rec["steps"]] == [1, None, 3, None, None]
    assert "<b>" not in rec["steps"][0]["text"] and "Rinse the rice" in rec["steps"][0]["text"]


def test_load_unknown_recipe_is_404(client):
    assert client.get("/api/recipe_tool/recipes/nope").status_code == 404


def test_edit_keeps_hidden_fields_markup_and_slug(client, settings):
    upload(client)
    rec = client.get(f"/api/recipe_tool/recipes/{SLUG}").json()
    before = stored_json(settings, SLUG)
    rec["title"] = "Prawn Bowl"  # renamed: slug stays (T2)
    rec["steps"][1]["text"] += "\nAdd a pinch of chilli."
    r = save(client, rec)
    assert r.status_code == 200, r.text
    assert r.json()["recipe"]["slug"] == SLUG

    after = stored_json(settings, SLUG)
    assert after["title"] == "Prawn Bowl"
    for key in ("chips", "nutrition", "utensils", "estimate_note", "allergens", "footer"):
        assert after[key] == before[key]
    assert after["ingredients"] == before["ingredients"]  # allergens and "128 g*" carried through
    assert after["pantry"] == before["pantry"]  # "Salt &amp; pepper" markup kept
    assert after["steps"][0] == before["steps"][0]  # untouched step keeps its <b> markup
    assert after["steps"][1][1][:-1] == before["steps"][1][1]
    assert after["steps"][1][1][-1] == "Add a pinch of chilli."


def test_reordering_steps_moves_their_photos(client, settings, s3):
    upload(client, extra=["card.pdf"])
    rec = client.get(f"/api/recipe_tool/recipes/{SLUG}").json()
    rec["steps"] = [rec["steps"][4], rec["steps"][0]]  # keep steps 5 and 1, in that order
    rec["steps"][1]["photo"] = "none"
    rec["hero"] = "new"
    r = save(client, rec, {"hero.jpg": jpeg("new hero")})
    assert r.status_code == 200, r.text
    assert stored_files(settings, SLUG) == ["hero.jpg", "recipe.json", "s1.jpg"]
    folder = settings.recipes_dir / SLUG
    assert (folder / "s1.jpg").read_bytes() == b"jpeg:s5.jpg"
    assert (folder / "hero.jpg").read_bytes() == jpeg("new hero")
    assert [s[0] for s in stored_json(settings, SLUG)["steps"]] == ["Finish and Serve", "Cook Your Rice"]
    # S3 now matches the folder: removed step photos are gone there too.
    assert s3_keys(s3) == ["recipes/index.json"] + [f"recipes/{SLUG}/{n}" for n in ["hero.jpg", "recipe.json", "s1.jpg"]]


def test_replacing_a_step_photo(client, settings):
    upload(client)
    rec = client.get(f"/api/recipe_tool/recipes/{SLUG}").json()
    rec["steps"][0]["photo"] = "new"
    assert save(client, rec, {"step-1.jpg": jpeg("fresh")}).status_code == 200
    assert (settings.recipes_dir / SLUG / "s1.jpg").read_bytes() == jpeg("fresh")
    assert (settings.recipes_dir / SLUG / "s2.jpg").read_bytes() == b"jpeg:s2.jpg"


def test_keeping_a_photo_that_is_gone_is_an_error(client):
    upload(client, photos=["hero.jpg"])
    rec = client.get(f"/api/recipe_tool/recipes/{SLUG}").json()
    rec["steps"][0].update(photo="keep", photo_from=1)
    assert save(client, rec).status_code == 422


def test_editing_a_deleted_recipe_is_404(client):
    upload(client)
    rec = client.get(f"/api/recipe_tool/recipes/{SLUG}").json()
    client.delete(f"/api/recipes/{SLUG}")
    assert save(client, rec).status_code == 404


# ---- card.pdf no longer kept (T11) ---------------------------------------------------------------------

def test_upload_skips_card_pdf_quietly(client, settings, s3):
    r = upload(client, extra=["card.pdf"])
    assert r.json()["ignored"] == []
    assert "card.pdf" not in stored_files(settings, SLUG)
    assert f"recipes/{SLUG}/card.pdf" not in s3_keys(s3)


def test_sync_down_skips_card_pdf(client, settings, s3):
    upload(client)
    s3.put_object(Bucket=BUCKET, Key=f"recipes/{SLUG}/card.pdf", Body=b"%PDF")
    client.post(f"/api/recipes/sync/{SLUG}/down?overwrite=true")
    assert "card.pdf" not in stored_files(settings, SLUG)
