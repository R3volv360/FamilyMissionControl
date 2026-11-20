"""Storage for planned meals. No business rules."""
from datetime import date

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.modules.planner.models import PlannedMeal


def in_range(db: Session, first: date, last: date) -> list[PlannedMeal]:
    stmt = (
        select(PlannedMeal)
        .where(PlannedMeal.day >= first, PlannedMeal.day <= last)
        .order_by(PlannedMeal.day, PlannedMeal.position, PlannedMeal.id)
    )
    return list(db.scalars(stmt))


def get(db: Session, meal_id: int) -> PlannedMeal | None:
    return db.get(PlannedMeal, meal_id)


def next_position(db: Session, day: date) -> int:
    current = db.scalar(select(func.max(PlannedMeal.position)).where(PlannedMeal.day == day))
    return 0 if current is None else current + 1


def add(db: Session, meal: PlannedMeal) -> PlannedMeal:
    db.add(meal)
    db.flush()
    return meal


def delete_meal(db: Session, meal: PlannedMeal) -> None:
    db.delete(meal)
    db.flush()


def delete_range(db: Session, first: date, last: date) -> None:
    db.execute(delete(PlannedMeal).where(PlannedMeal.day >= first, PlannedMeal.day <= last))
    db.flush()


def count_for_recipe(db: Session, recipe_id: int, today: date) -> tuple[int, int]:
    """(upcoming, past) planned meals using a recipe; today counts as upcoming."""
    upcoming = PlannedMeal.day >= today
    stmt = select(upcoming, func.count()).where(PlannedMeal.recipe_id == recipe_id).group_by(upcoming)
    rows = db.execute(stmt).all()
    counts = {bool(upcoming): n for upcoming, n in rows}
    return counts.get(True, 0), counts.get(False, 0)
