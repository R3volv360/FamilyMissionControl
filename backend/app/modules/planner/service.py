"""Meal Planner (M1–M11): weekly plans, and the week's consolidated ingredient list.

Reads Recipes for the planned meals, and Pantry and Freezer for what's already in the house. It only reads
those modules (through their services); it never changes them.
"""
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.modules.freezer import service as freezer
from app.modules.items import service as items
from app.modules.pantry import service as pantry
from app.modules.pantry.models import EMPTY, FULL, ONE
from app.modules.planner import repository as repo
from app.modules.planner.models import PlannedMeal
from app.modules.planner import quantities
from app.modules.recipes import service as recipes

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


class PlannerError(Exception):
    pass


class NotFound(PlannerError):
    pass


class TargetNotEmpty(PlannerError):
    def __init__(self, count: int):
        super().__init__(f"That week already has {count} meal{'s' if count != 1 else ''}")
        self.count = count


class InvalidCopy(PlannerError):
    pass


# ---- references to recipes (so deleting a recipe can warn about planned meals) -------------------------


class _PlannerRecipeRefs:
    def usage(self, db: Session, recipe_id: int) -> dict[str, int]:
        upcoming, past = repo.count_for_recipe(db, recipe_id, date.today())
        return {"upcoming meals": upcoming, "past meals": past}


recipes.register_recipe_references(_PlannerRecipeRefs())


# ---- weeks (M1, M7) ------------------------------------------------------------------------------------


def week_start(any_day: date) -> date:
    """The Monday of the week containing `any_day`."""
    return any_day - timedelta(days=any_day.weekday())


def week_days(start: date) -> list[date]:
    return [start + timedelta(days=i) for i in range(7)]


def _relink(db: Session, meals: list[PlannedMeal]) -> None:
    """Meals whose recipe was deleted re-link if a recipe with the same slug is back (e.g. synced down)."""
    for m in meals:
        if m.recipe_id is None:
            try:
                recipe = recipes.get(db, m.recipe_slug)
            except recipes.NotFound:
                continue
            m.recipe_id, m.recipe, m.recipe_title = recipe.id, recipe, recipe.title
    db.flush()


def get_week(db: Session, any_day: date) -> tuple[date, dict[date, list[PlannedMeal]]]:
    start = week_start(any_day)
    meals = repo.in_range(db, start, start + timedelta(days=6))
    _relink(db, meals)
    by_day: dict[date, list[PlannedMeal]] = {d: [] for d in week_days(start)}
    for m in meals:
        by_day[m.day].append(m)
    return start, by_day


# ---- planning (M3–M6) ----------------------------------------------------------------------------------


def _recipe(db: Session, slug: str):
    try:
        return recipes.get(db, slug)
    except recipes.NotFound as e:
        raise NotFound(str(e)) from e


def add_meal(db: Session, day: date, recipe_slug: str) -> PlannedMeal:
    """M3/M5: add a recipe to a day, after any meals already there."""
    recipe = _recipe(db, recipe_slug)
    meal = PlannedMeal(day=day, position=repo.next_position(db, day), recipe_id=recipe.id,
                       recipe_slug=recipe.slug, recipe_title=recipe.title)
    return repo.add(db, meal)


def replace_meal(db: Session, meal_id: int, recipe_slug: str) -> PlannedMeal:
    """M4: swap the recipe of a planned meal, keeping its place."""
    meal = _get(db, meal_id)
    recipe = _recipe(db, recipe_slug)
    meal.recipe_id, meal.recipe, meal.recipe_slug, meal.recipe_title = recipe.id, recipe, recipe.slug, recipe.title
    db.flush()
    return meal


def remove_meal(db: Session, meal_id: int) -> None:
    """M6."""
    repo.delete_meal(db, _get(db, meal_id))


def _get(db: Session, meal_id: int) -> PlannedMeal:
    meal = repo.get(db, meal_id)
    if not meal:
        raise NotFound(f"No planned meal {meal_id}")
    return meal


def copy_week(db: Session, from_day: date, to_day: date, replace: bool = False) -> int:
    """M9: copy one week's plan into another, day for day. A week that already has meals is only overwritten
    with replace=True. Returns the number of meals copied."""
    src, dst = week_start(from_day), week_start(to_day)
    if src == dst:
        raise InvalidCopy("Pick a different week to paste into")
    existing = repo.in_range(db, dst, dst + timedelta(days=6))
    if existing and not replace:
        raise TargetNotEmpty(len(existing))
    repo.delete_range(db, dst, dst + timedelta(days=6))
    meals = repo.in_range(db, src, src + timedelta(days=6))
    offset = dst - src
    for m in meals:
        repo.add(db, PlannedMeal(day=m.day + offset, position=m.position, recipe_id=m.recipe_id,
                                 recipe_slug=m.recipe_slug, recipe_title=m.recipe_title))
    return len(meals)


# ---- the week's ingredient list (M8, M11) --------------------------------------------------------------


@dataclass
class PlannedRecipe:
    day: date
    title: str


@dataclass
class ListLine:
    name: str
    item_id: int | None
    qtys: list[str] = field(default_factory=list)  # every planned meal's amount, as written
    pantry_level: str | None = None  # full / one / empty, when the item is in the pantry
    freezer_g: int | None = None  # grams in the freezer, when it's there
    unit_mismatch: bool = False  # M11: an amount can't be compared with the freezer's grams
    short_g: int | None = None  # freezer has less than the week's gram amounts add up to

    @property
    def total(self) -> str:
        """One total for the week, e.g. "700 g" (see quantities.total)."""
        return quantities.total(self.qtys)


@dataclass
class ShoppingList:
    start: date
    meals: list[PlannedRecipe]  # what we're shopping for, listed once, separately from the ingredients
    buy: list[ListLine]
    pantry: list[ListLine]
    freezer: list[ListLine]
    pantry_one: list[ListLine] = field(default_factory=list)  # restock: pantry items down to their last one
    pantry_empty: list[ListLine] = field(default_factory=list)  # restock: pantry items that have run out

    @property
    def unit_mismatches(self) -> list[str]:
        return [line.name for line in self.freezer if line.unit_mismatch]


def shopping_list(db: Session, any_day: date) -> ShoppingList:
    """M8: one list for the week. Each ingredient appears once with its total for the week (amounts in the
    same kind of unit are added up; nothing is scaled by servings), split by where it comes from:

    - in the freezer               -> "In the freezer" (freezer items never go on "to buy")
    - in the pantry, Fully stocked -> "Already in the pantry"
    - in the pantry, Only one / Empty, or not in either -> "To buy"

    Below that, every other pantry item that isn't fully stocked, so it gets restocked even when no meal
    needs it: "Only one left", then "Empty". An item already on "to buy" (a meal needs it) or in the
    freezer isn't repeated there.

    Only current stock is used: planning four basil recipes doesn't run the basil down. The week's meals
    are listed separately, not against each ingredient.
    """
    start, by_day = get_week(db, any_day)
    levels = pantry.levels_by_item(db)
    frozen = freezer.totals_by_item(db)
    lines: dict[object, ListLine] = {}
    planned: list[PlannedRecipe] = []

    for day, meals in by_day.items():
        for meal in meals:
            if meal.recipe is None:
                continue  # recipe deleted from the app: nothing to list
            planned.append(PlannedRecipe(day, meal.recipe.title))
            for ing in meal.recipe.ingredients:
                item_id = ing.item_id
                if item_id is None:  # its known item was deleted; match by name if one exists now
                    found = items.find(db, recipes.item_name(ing.name))
                    item_id = found.id if found else None
                key: object = item_id if item_id is not None else items.normalise_key(ing.name)
                if key not in lines:
                    name = items.get(db, item_id).name if item_id is not None else recipes.item_name(ing.name)
                    lines[key] = ListLine(name=name or ing.name, item_id=item_id)
                lines[key].qtys.append(ing.qty)

    buy, in_pantry, in_freezer = [], [], []
    for line in lines.values():
        if line.item_id is not None and line.item_id in frozen:
            line.freezer_g = frozen[line.item_id]
            weights = [quantities.grams(q) for q in line.qtys]
            # M11: "2" or "2 breasts" can't be compared with grams. Blank amounts ("to taste") are ignored.
            line.unit_mismatch = any(w is None and q.strip() for w, q in zip(weights, line.qtys))
            needed = sum(w for w in weights if w is not None)
            if not line.unit_mismatch and needed > line.freezer_g:
                line.short_g = round(needed - line.freezer_g)
            in_freezer.append(line)
            continue
        if line.item_id is not None and line.item_id in levels:
            line.pantry_level = levels[line.item_id]
        (in_pantry if line.pantry_level == FULL else buy).append(line)

    listed = {line.item_id for line in lines.values() if line.item_id is not None}
    restock: dict[str, list[ListLine]] = {ONE: [], EMPTY: []}
    for entry in pantry.list_entries(db):  # sorted by name
        if entry.level in restock and entry.item_id not in listed and entry.item_id not in frozen:
            restock[entry.level].append(ListLine(name=entry.item.name, item_id=entry.item_id, pantry_level=entry.level))

    by_name = lambda line: line.name.lower()  # noqa: E731
    return ShoppingList(start, planned, sorted(buy, key=by_name), sorted(in_pantry, key=by_name),
                        sorted(in_freezer, key=by_name), restock[ONE], restock[EMPTY])
