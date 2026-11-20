import json

import pytest

from app.modules.planner.quantities import grams, total
from tests.test_recipes import SAMPLE, SLUG, upload

MON, WED, SUN = "2026-11-16", "2026-11-18", "2026-11-22"
NEXT_MON = "2026-11-23"


def make_recipe(client, slug, title, ingredients, pantry=()):
    data = json.loads(SAMPLE)
    data.update(title=title, ingredients=[list(i) for i in ingredients], pantry=[list(p) for p in pantry])
    r = upload(client, folder=slug, recipe=json.dumps(data).encode(), photos=[])
    assert r.status_code == 200, r.text


def plan(client, day, slug):
    r = client.post("/api/planner/meals", json={"day": day, "recipe_slug": slug})
    assert r.status_code == 201, r.text
    return r.json()


def week(client, day=MON):
    return client.get("/api/planner/week", params={"day": day}).json()


def titles(wk):
    return {d["day"]: [m["title"] for m in d["meals"]] for d in wk["days"] if d["meals"]}


def shopping(client, day=MON):
    return client.get("/api/planner/list", params={"day": day}).json()


# ---- quantities (M11) ----------------------------------------------------------------------------------

@pytest.mark.parametrize("qty,g", [("320 g", 320), ("128 g*", 128), ("1.5kg", 1500), ("1,5 kg", 1500),
                                   ("500 grams", 500), ("½ kg", 500), ("1½ kg", 1500), ("1 1/2 kg", 1500),
                                   ("1/2 kg", 500)])
def test_grams(qty, g):
    assert grams(qty) == pytest.approx(g)


@pytest.mark.parametrize("qty", ["2", "2 breasts", "½ tsp", "50 ml*", "", "a pinch", "1 tin"])
def test_not_grams(qty):
    assert grams(qty) is None


@pytest.mark.parametrize("qtys,expected", [
    (["100 g", "200 g", "400 g"], "700 g"),           # the example: one total, no breakdown
    (["500 g", "1 kg"], "1.5 kg"),
    (["250 ml", "1 l"], "1.25 l"),
    (["½ tsp", "½ tsp"], "1 tsp"),
    (["½ tsp", "¼ tsp"], "¾ tsp"),
    (["2 tbsp", "1 tsp"], "2 tbsp + 1 tsp"),
    (["2", "1"], "3"),
    (["1 bunch", "1 bunch"], "2 bunches"),
    (["2 cloves", "1 clove"], "3 cloves"),
    (["1 tin"], "1 tin"),
    (["300 g", "2"], "300 g + 2"),                    # can't be added up: shown side by side
    (["128 g*", "14 g"], "≈ 142 g"),                  # * = estimated in the recipe card
    (["", "", ""], ""),                               # "to taste"
    (["a pinch", "a pinch", "10 g"], "10 g + a pinch"),
    (["1 1/2 kg", "500g"], "2 kg"),
])
def test_total(qtys, expected):
    assert total(qtys) == expected


# ---- weeks (M1, M7) ------------------------------------------------------------------------------------

def test_week_runs_monday_to_sunday_from_any_day(client):
    wk = week(client, WED)
    assert wk["start"] == MON
    assert [d["day"] for d in wk["days"]] == [f"2026-11-{n}" for n in range(16, 23)]
    assert all(d["meals"] == [] for d in wk["days"])


def test_any_week_past_or_future(client):
    upload(client)
    plan(client, "2020-01-06", SLUG)
    plan(client, "2031-05-12", SLUG)
    assert titles(week(client, "2020-01-08")) == {"2020-01-06": ["Sticky Szechuan Prawn Bowl"]}
    assert titles(week(client, "2031-05-18")) == {"2031-05-12": ["Sticky Szechuan Prawn Bowl"]}


# ---- planning (M3–M6) ----------------------------------------------------------------------------------

def test_add_replace_and_remove_meals(client):
    upload(client)
    make_recipe(client, "lasagne", "Lasagne", [["500 g", "Mince", ""]])
    first = plan(client, MON, SLUG)  # M3: empty day
    assert first["recipe"]["slug"] == SLUG and first["position"] == 0
    second = plan(client, MON, "lasagne")  # M5: "Add new" adds another meal to the day
    assert second["position"] == 1
    assert titles(week(client)) == {MON: ["Sticky Szechuan Prawn Bowl", "Lasagne"]}

    r = client.put(f"/api/planner/meals/{first['id']}", json={"recipe_slug": "lasagne"})  # M4
    assert r.status_code == 200 and r.json()["position"] == 0
    assert titles(week(client)) == {MON: ["Lasagne", "Lasagne"]}

    assert client.delete(f"/api/planner/meals/{second['id']}").status_code == 204  # M6
    assert titles(week(client)) == {MON: ["Lasagne"]}


def test_unknown_recipe_or_meal(client):
    assert client.post("/api/planner/meals", json={"day": MON, "recipe_slug": "nope"}).status_code == 404
    assert client.put("/api/planner/meals/99", json={"recipe_slug": "nope"}).status_code == 404
    assert client.delete("/api/planner/meals/99").status_code == 404


def test_deleted_recipe_stays_in_history_and_relinks_when_back(client, s3):
    upload(client)
    plan(client, MON, SLUG)
    client.delete(f"/api/recipes/{SLUG}", params={"where": "app"})
    meal = week(client)["days"][0]["meals"][0]
    assert meal["title"] == "Sticky Szechuan Prawn Bowl" and meal["recipe"] is None
    assert shopping(client)["meals"] == []

    client.post(f"/api/recipes/sync/{SLUG}/down")  # still in S3
    assert week(client)["days"][0]["meals"][0]["recipe"]["slug"] == SLUG


# ---- copy (M9) -----------------------------------------------------------------------------------------

def test_copy_week(client):
    upload(client)
    make_recipe(client, "lasagne", "Lasagne", [["500 g", "Mince", ""]])
    plan(client, MON, SLUG)
    plan(client, MON, "lasagne")
    plan(client, SUN, "lasagne")
    r = client.post("/api/planner/copy", json={"from_day": WED, "to_day": NEXT_MON})
    assert r.status_code == 200 and r.json() == {"copied": 3}
    assert titles(week(client, NEXT_MON)) == {
        "2026-11-23": ["Sticky Szechuan Prawn Bowl", "Lasagne"], "2026-11-29": ["Lasagne"]}
    assert titles(week(client)) == {MON: ["Sticky Szechuan Prawn Bowl", "Lasagne"], SUN: ["Lasagne"]}  # unchanged


def test_copy_into_week_with_meals_needs_replace(client):
    upload(client)
    make_recipe(client, "lasagne", "Lasagne", [["500 g", "Mince", ""]])
    plan(client, MON, SLUG)
    plan(client, NEXT_MON, "lasagne")
    r = client.post("/api/planner/copy", json={"from_day": MON, "to_day": NEXT_MON})
    assert r.status_code == 409 and r.json()["detail"]["count"] == 1
    r = client.post("/api/planner/copy", json={"from_day": MON, "to_day": NEXT_MON, "replace": True})
    assert r.status_code == 200
    assert titles(week(client, NEXT_MON)) == {NEXT_MON: ["Sticky Szechuan Prawn Bowl"]}


def test_copy_onto_same_week_refused(client):
    assert client.post("/api/planner/copy", json={"from_day": MON, "to_day": SUN}).status_code == 422


# ---- the week's ingredient list (M8, M11) --------------------------------------------------------------

def names(lines):
    return [line["name"] for line in lines]


def test_list_splits_buy_pantry_freezer(client):
    make_recipe(client, "pasta", "Pasta", [["200 g", "Spaghetti", ""], ["1 bunch", "Basil", ""],
                                           ["400 g", "Mince", ""], ["2", "Garlic cloves", ""]],
                pantry=[["2 tbsp", "Olive oil"], ["", "Salt &amp; pepper, to taste"]])
    plan(client, MON, "pasta")
    client.post("/api/pantry", json={"name": "Olive oil"})  # fully stocked -> already in pantry
    basil = client.post("/api/pantry", json={"name": "Basil"}).json()["entry"]
    client.patch(f"/api/pantry/{basil['id']}", json={"level": "one"})  # only one -> to buy
    client.post("/api/freezer", json={"name": "Mince", "packs": [{"weight_g": 500}]})

    sl = shopping(client)
    assert sl["start"] == MON
    assert sl["meals"] == [{"day": MON, "weekday": "Mon", "title": "Pasta"}]
    assert names(sl["buy"]) == ["Basil", "Garlic cloves", "Salt & pepper", "Spaghetti"]
    assert names(sl["pantry"]) == ["Olive oil"]
    assert names(sl["freezer"]) == ["Mince"]
    basil_line = next(x for x in sl["buy"] if x["name"] == "Basil")
    assert basil_line["pantry_level"] == "one"
    assert sl["freezer"][0]["freezer_label"] == "500 g" and sl["freezer"][0]["unit_mismatch"] is False
    assert sl["unit_mismatches"] == []


def test_same_ingredient_listed_once_with_its_weekly_total(client):
    make_recipe(client, "a", "Recipe A", [["100 g", "Ingredient X", ""], ["1", "Lime", ""]])
    make_recipe(client, "b", "Recipe B", [["200 g", "ingredient x", ""]])
    make_recipe(client, "c", "Recipe C", [["400 g", "Ingredient X", ""], ["2", "Limes", ""]])
    plan(client, MON, "a")
    plan(client, WED, "b")
    plan(client, SUN, "c")
    sl = shopping(client)
    lines = {x["name"]: x["total"] for x in sl["buy"]}
    assert lines["Ingredient X"] == "700 g"  # no per-recipe breakdown
    assert lines["Lime"] == "3"
    assert "amounts" not in sl["buy"][0]
    # The meals are listed once, in their own section
    assert sl["meals"] == [
        {"day": MON, "weekday": "Mon", "title": "Recipe A"},
        {"day": WED, "weekday": "Wed", "title": "Recipe B"},
        {"day": SUN, "weekday": "Sun", "title": "Recipe C"},
    ]


def test_same_recipe_twice_counts_twice(client):
    make_recipe(client, "a", "Recipe A", [["320 g", "King prawns", ""]])
    plan(client, MON, "a")
    plan(client, SUN, "a")
    assert shopping(client)["buy"][0]["total"] == "640 g"


def test_stock_is_not_run_down_by_planning(client):
    make_recipe(client, "pesto", "Pesto", [["1 bunch", "Basil", ""]])
    for day in [MON, WED, SUN]:
        plan(client, day, "pesto")
    client.post("/api/pantry", json={"name": "Basil"})
    sl = shopping(client)
    assert names(sl["pantry"]) == ["Basil"] and sl["buy"] == []


def test_freezer_never_goes_on_buy_and_unit_mismatch_is_called_out(client):
    make_recipe(client, "curry", "Curry", [["2", "Chicken breasts", ""], ["600 g", "Mince", ""]])
    plan(client, MON, "curry")
    client.post("/api/freezer", json={"name": "Chicken breasts", "packs": [{"weight_g": 300, "count": 2}]})
    client.post("/api/freezer", json={"name": "Mince", "packs": [{"weight_g": 400}]})
    sl = shopping(client)
    assert sl["buy"] == []
    chicken, mince = sl["freezer"]
    assert (chicken["name"], chicken["unit_mismatch"], chicken["freezer_label"]) == ("Chicken breasts", True, "600 g")
    assert (chicken["total"], mince["total"]) == ("2", "600 g")
    assert (mince["name"], mince["unit_mismatch"], mince["short_label"]) == ("Mince", False, "200 g")
    assert sl["unit_mismatches"] == ["Chicken breasts"]


def test_freezer_takes_priority_over_pantry(client):
    make_recipe(client, "r", "R", [["100 g", "Peas", ""]])
    plan(client, MON, "r")
    e = client.post("/api/pantry", json={"name": "Peas"}).json()["entry"]
    client.patch(f"/api/pantry/{e['id']}", json={"level": "empty"})
    client.post("/api/freezer", json={"name": "Peas", "packs": [{"weight_g": 900}]})
    sl = shopping(client)
    assert names(sl["freezer"]) == ["Peas"] and sl["buy"] == []


def test_empty_week_has_empty_list(client):
    sl = shopping(client)
    assert sl == {"start": MON, "meals": [], "buy": [], "pantry": [], "freezer": [], "pantry_one": [],
                  "pantry_empty": [], "unit_mismatches": []}


def test_low_pantry_items_listed_below_in_one_left_then_empty(client):
    make_recipe(client, "r", "R", [["1 bunch", "Basil", ""]])
    plan(client, MON, "r")

    def stock(name, level):
        e = client.post("/api/pantry", json={"name": name}).json()["entry"]
        if level != "full":
            client.patch(f"/api/pantry/{e['id']}", json={"level": level})

    stock("Basil", "one")  # a meal needs it: stays on "to buy", not repeated below
    stock("Rice", "full")  # fully stocked: not listed
    stock("Tea", "one")
    stock("Flour", "one")
    stock("Sugar", "empty")
    stock("Peas", "empty")  # also in the freezer: never to buy (D6)
    client.post("/api/freezer", json={"name": "Peas", "packs": [{"weight_g": 900}]})

    sl = shopping(client)
    assert names(sl["buy"]) == ["Basil"]
    assert names(sl["pantry_one"]) == ["Flour", "Tea"]
    assert names(sl["pantry_empty"]) == ["Sugar"]
    assert sl["pantry_one"][0]["pantry_level"] == "one" and sl["pantry_one"][0]["total"] == ""


def test_low_pantry_items_listed_with_no_meals_planned(client):
    e = client.post("/api/pantry", json={"name": "Tea"}).json()["entry"]
    client.patch(f"/api/pantry/{e['id']}", json={"level": "empty"})
    sl = shopping(client)
    assert sl["meals"] == [] and names(sl["pantry_empty"]) == ["Tea"]


def test_ingredient_whose_item_was_deleted_still_listed(client):
    make_recipe(client, "r", "R", [["1", "Lime", ""]])
    plan(client, MON, "r")
    lime = client.get("/api/items", params={"q": "lime"}).json()[0]
    client.delete(f"/api/items/{lime['id']}", params={"force": True})
    assert names(shopping(client)["buy"]) == ["Lime"]


def test_recipe_usage_counts_upcoming_and_past_meals(client):
    from datetime import date, timedelta

    upload(client)
    today = date.today()
    for d in [today, today + timedelta(days=9), today - timedelta(days=30)]:
        plan(client, d.isoformat(), SLUG)
    assert client.get(f"/api/recipes/{SLUG}/usage").json() == {"upcoming meals": 2, "past meals": 1}


def test_unplanned_recipe_has_no_usage(client):
    upload(client)
    assert client.get(f"/api/recipes/{SLUG}/usage").json() == {}
    assert client.get("/api/recipes/nope/usage").status_code == 404
