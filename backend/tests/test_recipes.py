import json
from pathlib import Path

import pytest

from app.modules.recipes.service import item_name, slugify
from tests.conftest import BUCKET

SAMPLE = (Path(__file__).parent / "fixtures" / "sticky-szechuan-prawn-bowl.json").read_bytes()
SLUG = "sticky-szechuan-prawn-bowl"
PHOTOS = ["hero.jpg", "s1.jpg", "s2.jpg", "s3.jpg", "s4.jpg", "s5.jpg"]


def folder_files(recipe: bytes = SAMPLE, photos=PHOTOS, extra=()):
    files = [("files", (f"{SLUG}/recipe.json", recipe, "application/json"))]
    files += [("files", (f"{SLUG}/{p}", f"jpeg:{p}".encode(), "image/jpeg")) for p in photos]
    files += [("files", (f"{SLUG}/{n}", b"x", "application/octet-stream")) for n in extra]
    return files


def upload(client, overwrite=False, folder=SLUG, same_title_ok=False, **kw):
    data = {"folder": folder, "overwrite": str(overwrite).lower(), "same_title_ok": str(same_title_ok).lower()}
    return client.post("/api/recipes/upload", data=data, files=folder_files(**kw))


def s3_keys(s3):
    return sorted(o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET).get("Contents", []))


def s3_index(s3):
    return json.loads(s3.get_object(Bucket=BUCKET, Key="recipes/index.json")["Body"].read())


def put_s3_recipe(s3, slug=SLUG, recipe=SAMPLE, photos=PHOTOS):
    s3.put_object(Bucket=BUCKET, Key=f"recipes/{slug}/recipe.json", Body=recipe)
    for p in photos:
        s3.put_object(Bucket=BUCKET, Key=f"recipes/{slug}/{p}", Body=f"s3:{p}".encode())


# ---- helpers -------------------------------------------------------------------------------------------

def test_slugify_matches_upload_script():
    assert slugify("Sticky Szechuan Prawn Bowl") == SLUG
    assert slugify("  Mum's  Lasagne! ") == "mum-s-lasagne"


@pytest.mark.parametrize("raw,expected", [
    ("Salt &amp; pepper, to taste", "Salt & pepper"),
    ("<b>King prawns</b>", "King prawns"),
    ("Coriander (to serve)", "Coriander"),
    ("Oil", "Oil"),
])
def test_item_name(raw, expected):
    assert item_name(raw) == expected


# ---- upload (R2) and known items (R1) ------------------------------------------------------------------

def test_upload_saves_locally_and_pushes_to_s3(client, settings, s3):
    r = upload(client, extra=["notes.txt"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["recipe"]["slug"] == SLUG
    assert body["recipe"]["title"] == "Sticky Szechuan Prawn Bowl"
    assert body["recipe"]["subtitle"] == "with fragrant rice and charred carrot"  # case kept
    assert body["replaced"] is False and body["warnings"] == [] and body["ignored"] == ["notes.txt"]

    local = settings.recipes_dir / SLUG
    assert sorted(p.name for p in local.iterdir()) == sorted(["recipe.json", *PHOTOS])

    # Background upload ran after the response (TestClient runs it synchronously).
    detail = client.get(f"/api/recipes/{SLUG}").json()
    assert detail["s3_state"] == "done"
    assert s3_keys(s3) == sorted([f"recipes/{SLUG}/{n}" for n in ["recipe.json", *PHOTOS]] + ["recipes/index.json"])
    assert s3_index(s3) == [{"slug": SLUG, "title": "Sticky Szechuan Prawn Bowl",
                             "spoken": "sticky szechuan prawn bowl", "aliases": []}]


def test_upload_adds_ingredients_to_known_items(client):
    upload(client)
    names = [i["name"] for i in client.get("/api/items").json()]
    for expected in ["King prawns", "Jasmine rice", "Aioli", "Garlic clove", "Lime", "Salt", "Oil", "Salt & pepper"]:
        assert expected in names
    detail = client.get(f"/api/recipes/{SLUG}").json()
    first = detail["ingredients"][0]
    assert first == {"section": "ingredients", "qty": "320 g", "name": "King prawns",
                     "allergens": "Crustaceans", "item_id": first["item_id"]}
    assert all(i["item_id"] for i in detail["ingredients"])
    assert [i["qty"] for i in detail["ingredients"] if i["section"] == "pantry"] == ["½ tsp", "2 tbsp", ""]
    # Usage is reported back to the items module
    assert client.get(f"/api/items/{first['item_id']}").json()["usage"] == {"recipes": 1}


def test_upload_reuses_existing_items(client):
    client.post("/api/items", json={"name": "lime"})
    upload(client)
    assert [i["name"] for i in client.get("/api/items", params={"q": "lim"}).json()] == ["Lime"]


def test_reupload_needs_overwrite(client):
    upload(client)
    r = upload(client)
    assert r.status_code == 409 and r.json()["detail"]["exists_in"] == "the app"
    r = upload(client, overwrite=True, photos=["hero.jpg"])
    assert r.status_code == 200 and r.json()["replaced"] is True
    assert r.json()["warnings"] == ["Missing photos: s1.jpg, s2.jpg, s3.jpg, s4.jpg, s5.jpg"]
    assert client.get(f"/api/recipes/{SLUG}").json()["files"] == ["hero.jpg", "recipe.json"]


def test_same_title_in_another_folder_needs_confirming(client):
    assert upload(client).status_code == 200
    title = client.get(f"/api/recipes/{SLUG}").json()["title"]
    r = upload(client, folder="prawn-bowl-v2")
    assert r.status_code == 409 and r.json()["detail"]["same_title"] == SLUG
    assert title in r.json()["detail"]["message"]
    r = upload(client, folder="prawn-bowl-v2", same_title_ok=True)
    assert r.status_code == 200 and r.json()["recipe"]["slug"] == "prawn-bowl-v2"
    # Replacing a recipe in its own folder isn't a clash with itself
    assert upload(client, overwrite=True).status_code == 409  # ...but now another folder has its title
    assert upload(client, overwrite=True, same_title_ok=True).status_code == 200


def test_reupload_removes_stale_s3_files(client, s3):
    upload(client)
    upload(client, overwrite=True, photos=["hero.jpg"])
    assert s3_keys(s3) == sorted([f"recipes/{SLUG}/hero.jpg", f"recipes/{SLUG}/recipe.json", "recipes/index.json"])


def test_reupload_keeps_alexa_spoken_name_and_aliases(client, s3):
    s3.put_object(Bucket=BUCKET, Key="recipes/index.json", Body=json.dumps(
        [{"slug": SLUG, "title": "Old", "spoken": "prawn bowl", "aliases": ["szechuan prawns"]}]))
    upload(client)
    assert s3_index(s3) == [{"slug": SLUG, "title": "Sticky Szechuan Prawn Bowl", "spoken": "prawn bowl",
                             "aliases": ["szechuan prawns"]}]


@pytest.mark.parametrize("files_kw,message", [
    ({"recipe": b"{not json"}, "isn't valid JSON"),
    ({"recipe": b'{"title": "", "ingredients": [], "steps": []}'}, "no title"),
    ({"recipe": b'{"title": "X", "ingredients": "eggs", "steps": []}'}, "ingredients"),
])
def test_upload_rejects_bad_recipe_json(client, files_kw, message):
    r = upload(client, **files_kw)
    assert r.status_code == 422 and message in r.json()["detail"]
    assert client.get("/api/recipes").json() == []


def test_upload_without_recipe_json(client):
    r = client.post("/api/recipes/upload", data={"folder": "x"},
                    files=[("files", ("x/hero.jpg", b"j", "image/jpeg"))])
    assert r.status_code == 422 and "no recipe.json" in r.json()["detail"]


def test_s3_failure_marks_recipe_failed_and_can_retry(client, s3, monkeypatch):
    from app.modules.recipes import service

    def boom(*a):
        raise RuntimeError("network down")

    monkeypatch.setattr(service, "push_to_s3", boom)
    upload(client)
    detail = client.get(f"/api/recipes/{SLUG}").json()
    assert detail["s3_state"] == "failed" and "network down" in detail["s3_error"]

    monkeypatch.undo()
    assert client.post(f"/api/recipes/{SLUG}/s3-upload").status_code == 202
    assert client.get(f"/api/recipes/{SLUG}").json()["s3_state"] == "done"


# ---- files (R5) ----------------------------------------------------------------------------------------

def test_hero_image_served_and_placeholder_when_missing(client):
    upload(client)
    r = client.get(f"/api/recipes/{SLUG}/files/hero.jpg")
    assert r.status_code == 200 and r.content == b"jpeg:hero.jpg"
    assert client.get(f"/api/recipes/{SLUG}/files/s1.jpg").content == b"jpeg:s1.jpg"

    upload(client, overwrite=True, photos=[])
    r = client.get(f"/api/recipes/{SLUG}/files/hero.jpg")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml")
    assert client.get(f"/api/recipes/{SLUG}/files/s1.jpg").status_code == 404


def test_files_outside_whitelist_or_bad_slug_refused(client):
    upload(client)
    assert client.get(f"/api/recipes/{SLUG}/files/..%2Frecipe.json").status_code == 404
    assert client.get(f"/api/recipes/{SLUG}/files/notes.txt").status_code == 404
    assert client.get("/api/recipes/..%2F..%2Fdata/files/hero.jpg").status_code in (404, 422)


def test_list_recipes(client):
    assert client.get("/api/recipes").json() == []
    upload(client)
    assert [r["slug"] for r in client.get("/api/recipes").json()] == [SLUG]
    assert client.get("/api/recipes/nope").status_code == 404


# ---- sync (R3/R4) --------------------------------------------------------------------------------------

def test_sync_status_matrix(client, s3):
    upload(client)  # in both (background upload)
    other = json.loads(SAMPLE)
    other["title"] = "App Only Pie"
    upload(client, folder="app-only-pie", recipe=json.dumps(other).encode())
    client.delete("/api/recipes/app-only-pie", params={"where": "s3"})  # now app only
    put_s3_recipe(s3, slug="s3-only-stew")

    rows = {r["slug"]: r for r in client.get("/api/recipes/sync").json()}
    assert {s: r["state"] for s, r in rows.items()} == {SLUG: "both", "app-only-pie": "app", "s3-only-stew": "s3"}
    assert rows["s3-only-stew"]["title"] == "S3 only stew"  # no index entry, so made from the slug


def test_sync_down_brings_recipe_into_app(client, s3, settings):
    put_s3_recipe(s3)
    r = client.post(f"/api/recipes/sync/{SLUG}/down")
    assert r.status_code == 200, r.text
    assert (settings.recipes_dir / SLUG / "hero.jpg").read_bytes() == b"s3:hero.jpg"
    assert "King prawns" in [i["name"] for i in client.get("/api/items").json()]  # R1 applies
    assert client.get("/api/recipes/sync").json()[0]["state"] == "both"


def test_sync_down_over_existing_needs_overwrite(client, s3, settings):
    upload(client)
    put_s3_recipe(s3)  # S3 copy now differs
    r = client.post(f"/api/recipes/sync/{SLUG}/down")
    assert r.status_code == 409 and r.json()["detail"]["exists_in"] == "the app"
    assert client.post(f"/api/recipes/sync/{SLUG}/down", params={"overwrite": True}).status_code == 200
    assert (settings.recipes_dir / SLUG / "hero.jpg").read_bytes() == b"s3:hero.jpg"


def test_sync_down_missing_in_s3(client):
    assert client.post("/api/recipes/sync/nothing-here/down").status_code == 404


def test_sync_up(client, s3):
    upload(client)
    client.delete(f"/api/recipes/{SLUG}", params={"where": "s3"})
    assert s3_keys(s3) == ["recipes/index.json"] and s3_index(s3) == []

    assert client.post(f"/api/recipes/sync/{SLUG}/up").status_code == 204
    assert f"recipes/{SLUG}/hero.jpg" in s3_keys(s3)
    assert [r["slug"] for r in s3_index(s3)] == [SLUG]

    r = client.post(f"/api/recipes/sync/{SLUG}/up")
    assert r.status_code == 409 and r.json()["detail"]["exists_in"] == "S3"
    assert client.post(f"/api/recipes/sync/{SLUG}/up", params={"overwrite": True}).status_code == 204


def test_delete_from_app_keeps_s3_and_unlinks_items(client, s3, settings):
    upload(client)
    item_id = client.get(f"/api/recipes/{SLUG}").json()["ingredients"][0]["item_id"]
    assert client.delete(f"/api/recipes/{SLUG}", params={"where": "app"}).status_code == 204
    assert client.get("/api/recipes").json() == []
    assert not (settings.recipes_dir / SLUG).exists()
    assert f"recipes/{SLUG}/recipe.json" in s3_keys(s3)
    # Known item stays (central list), just no longer used by a recipe
    assert client.get(f"/api/items/{item_id}").json()["usage"] == {}


def test_delete_from_both(client, s3):
    upload(client)
    assert client.delete(f"/api/recipes/{SLUG}", params={"where": "both"}).status_code == 204
    assert client.get("/api/recipes").json() == []
    assert s3_keys(s3) == ["recipes/index.json"]


def test_delete_missing_from_app_is_404(client):
    assert client.delete("/api/recipes/nope", params={"where": "app"}).status_code == 404


def test_deleting_known_item_unlinks_recipe_ingredient(client):
    upload(client)
    ing = client.get(f"/api/recipes/{SLUG}").json()["ingredients"][0]
    assert client.delete(f"/api/items/{ing['item_id']}").status_code == 409  # in use by a recipe
    assert client.delete(f"/api/items/{ing['item_id']}", params={"force": True}).status_code == 204
    assert client.get(f"/api/recipes/{SLUG}").json()["ingredients"][0]["item_id"] is None


def test_merging_items_relinks_recipe_ingredients(client):
    upload(client)
    typo = client.post("/api/items", json={"name": "Kng prawns"}).json()["item"]
    prawns = client.get(f"/api/recipes/{SLUG}").json()["ingredients"][0]["item_id"]
    # Renaming the recipe's item onto an existing name merges it; the recipe follows the surviving item.
    client.patch(f"/api/items/{prawns}", json={"name": "Kng prawns", "merge": True})
    assert client.get(f"/api/recipes/{SLUG}").json()["ingredients"][0]["item_id"] == typo["id"]


def test_bad_aws_config_is_a_clear_s3_error(client, settings, monkeypatch):
    settings.aws_profile = "no-such-profile"
    r = client.get("/api/recipes/sync")
    assert r.status_code == 502 and "no-such-profile" in r.json()["detail"]


# ---- uploading the recipe-card skill's zip (R2) --------------------------------------------------------

def make_zip(entries: dict[str, bytes]) -> bytes:
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in entries.items():
            z.writestr(name, data)
    return buf.getvalue()


def zip_upload(client, data: bytes, filename="recipe.zip", **form):
    return client.post("/api/recipes/upload", data=form, files=[("files", (filename, data, "application/zip"))])


def test_upload_zip_with_folder_inside(client, settings):
    data = make_zip({f"{SLUG}/recipe.json": SAMPLE, f"{SLUG}/hero.jpg": b"h", f"{SLUG}/s1.jpg": b"1",
                     f"{SLUG}/notes.txt": b"x", "__MACOSX/._hero.jpg": b"junk"})
    r = zip_upload(client, data, filename="download (3).zip")
    assert r.status_code == 200, r.text
    assert r.json()["recipe"]["slug"] == SLUG  # from the folder inside, not the zip's name
    assert sorted(p.name for p in (settings.recipes_dir / SLUG).iterdir()) == ["hero.jpg", "recipe.json", "s1.jpg"]


def test_upload_flat_zip_uses_zip_name(client):
    data = make_zip({"recipe.json": SAMPLE, "hero.jpg": b"h"})
    r = zip_upload(client, data, filename="Prawn Bowl.zip")
    assert r.status_code == 200 and r.json()["recipe"]["slug"] == "prawn-bowl"


def test_upload_zip_folder_name_can_be_overridden(client):
    data = make_zip({f"{SLUG}/recipe.json": SAMPLE})
    assert zip_upload(client, data, folder="my-bowl").json()["recipe"]["slug"] == "my-bowl"


def test_upload_zip_ignores_nested_or_escaping_paths(client, settings):
    data = make_zip({f"{SLUG}/recipe.json": SAMPLE, f"{SLUG}/deep/hero.jpg": b"deep",
                     f"{SLUG}/../hero.jpg": b"escape"})
    r = zip_upload(client, data)
    assert r.status_code == 200
    assert sorted(p.name for p in (settings.recipes_dir / SLUG).iterdir()) == ["recipe.json"]


def test_upload_bad_zip(client):
    r = zip_upload(client, b"not a zip", filename="x.zip")
    assert r.status_code == 422 and "isn't a valid zip" in r.json()["detail"]
    r = zip_upload(client, make_zip({"hero.jpg": b"h"}), filename="y.zip")
    assert r.status_code == 422 and "no recipe.json" in r.json()["detail"]


def test_upload_zip_respects_overwrite(client):
    data = make_zip({f"{SLUG}/recipe.json": SAMPLE})
    zip_upload(client, data)
    assert zip_upload(client, data).status_code == 409
    assert zip_upload(client, data, overwrite="true").json()["replaced"] is True
