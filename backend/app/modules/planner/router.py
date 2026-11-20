from datetime import date

from fastapi import APIRouter, HTTPException

from app.core.deps import DbSession
from app.modules.freezer.service import format_grams
from app.modules.planner import service
from app.modules.planner.models import PlannedMeal
from app.modules.planner.schemas import (
    Copied, DayOut, ListLineOut, MealAdd, MealOut, MealReplace, PlannedOut, RecipeRef, ShoppingListOut, WeekCopy,
    WeekOut,
)

router = APIRouter()


def _http(e: service.PlannerError) -> HTTPException:
    if isinstance(e, service.NotFound):
        return HTTPException(404, str(e))
    if isinstance(e, service.TargetNotEmpty):
        return HTTPException(409, {"message": str(e), "count": e.count})
    return HTTPException(422, str(e))


def _meal(m: PlannedMeal) -> MealOut:
    recipe = RecipeRef(slug=m.recipe.slug, title=m.recipe.title, updated_at=m.recipe.updated_at) if m.recipe else None
    return MealOut(id=m.id, day=m.day, position=m.position, title=m.recipe_title, recipe=recipe)


def _line(line: service.ListLine) -> ListLineOut:
    return ListLineOut(
        name=line.name,
        item_id=line.item_id,
        total=line.total,
        pantry_level=line.pantry_level,
        freezer_g=line.freezer_g,
        freezer_label=format_grams(line.freezer_g) if line.freezer_g is not None else None,
        unit_mismatch=line.unit_mismatch,
        short_label=format_grams(line.short_g) if line.short_g else None,
    )


@router.get("/week", response_model=WeekOut)
def get_week(db: DbSession, day: date | None = None):
    """The Monday–Sunday week containing `day` (default: today). Any week, past or future (M7)."""
    start, by_day = service.get_week(db, day or date.today())
    db.commit()  # keeps any re-linked recipes
    return WeekOut(start=start, days=[DayOut(day=d, meals=[_meal(m) for m in ms]) for d, ms in by_day.items()])


@router.post("/meals", response_model=MealOut, status_code=201)
def add_meal(body: MealAdd, db: DbSession):
    try:
        meal = service.add_meal(db, body.day, body.recipe_slug)
    except service.PlannerError as e:
        raise _http(e)
    db.commit()
    return _meal(meal)


@router.put("/meals/{meal_id}", response_model=MealOut)
def replace_meal(meal_id: int, body: MealReplace, db: DbSession):
    try:
        meal = service.replace_meal(db, meal_id, body.recipe_slug)
    except service.PlannerError as e:
        raise _http(e)
    db.commit()
    return _meal(meal)


@router.delete("/meals/{meal_id}", status_code=204)
def remove_meal(meal_id: int, db: DbSession):
    try:
        service.remove_meal(db, meal_id)
    except service.PlannerError as e:
        raise _http(e)
    db.commit()


@router.post("/copy", response_model=Copied)
def copy_week(body: WeekCopy, db: DbSession):
    try:
        n = service.copy_week(db, body.from_day, body.to_day, body.replace)
    except service.PlannerError as e:
        raise _http(e)
    db.commit()
    return Copied(copied=n)


@router.get("/list", response_model=ShoppingListOut)
def shopping_list(db: DbSession, day: date | None = None):
    sl = service.shopping_list(db, day or date.today())
    db.commit()
    return ShoppingListOut(
        start=sl.start,
        meals=[PlannedOut(day=m.day, weekday=service.DAY_NAMES[m.day.weekday()], title=m.title) for m in sl.meals],
        buy=[_line(x) for x in sl.buy], pantry=[_line(x) for x in sl.pantry], freezer=[_line(x) for x in sl.freezer],
        pantry_one=[_line(x) for x in sl.pantry_one], pantry_empty=[_line(x) for x in sl.pantry_empty],
        unit_mismatches=sl.unit_mismatches,
    )
