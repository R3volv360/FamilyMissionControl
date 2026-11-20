from datetime import date, datetime

from pydantic import BaseModel


class RecipeRef(BaseModel):
    slug: str
    title: str
    updated_at: datetime  # for hero image cache-busting


class MealOut(BaseModel):
    id: int
    day: date
    position: int
    title: str
    recipe: RecipeRef | None  # None when the recipe has been deleted from the app


class DayOut(BaseModel):
    day: date
    meals: list[MealOut]


class WeekOut(BaseModel):
    start: date
    days: list[DayOut]


class MealAdd(BaseModel):
    day: date
    recipe_slug: str


class MealReplace(BaseModel):
    recipe_slug: str


class WeekCopy(BaseModel):
    from_day: date
    to_day: date
    replace: bool = False


class Copied(BaseModel):
    copied: int


class PlannedOut(BaseModel):
    day: date
    weekday: str  # "Mon"
    title: str


class ListLineOut(BaseModel):
    name: str
    item_id: int | None
    total: str  # the week's total, e.g. "700 g", "300 g + 2", "≈ 142 g"; "" when no amounts are given
    pantry_level: str | None
    freezer_g: int | None
    freezer_label: str | None
    unit_mismatch: bool
    short_label: str | None


class ShoppingListOut(BaseModel):
    start: date
    meals: list[PlannedOut]  # what we're shopping for
    buy: list[ListLineOut]
    pantry: list[ListLineOut]
    freezer: list[ListLineOut]
    pantry_one: list[ListLineOut]  # other pantry items down to their last one (not needed by a meal)
    pantry_empty: list[ListLineOut]  # other pantry items that have run out
    unit_mismatches: list[str]
