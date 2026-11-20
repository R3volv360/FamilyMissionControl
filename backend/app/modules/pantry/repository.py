"""Storage for pantry entries. No business rules."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.items.models import Item
from app.modules.pantry.models import PantryEntry


def list_all(db: Session) -> list[PantryEntry]:
    stmt = select(PantryEntry).join(PantryEntry.item).order_by(func.lower(Item.name))
    return list(db.scalars(stmt))


def get(db: Session, entry_id: int) -> PantryEntry | None:
    return db.get(PantryEntry, entry_id)


def get_by_item(db: Session, item_id: int) -> PantryEntry | None:
    return db.scalar(select(PantryEntry).where(PantryEntry.item_id == item_id))


def add(db: Session, item_id: int, level: str) -> PantryEntry:
    entry = PantryEntry(item_id=item_id, level=level)
    db.add(entry)
    db.flush()
    return entry


def delete(db: Session, entry: PantryEntry) -> None:
    db.delete(entry)
    db.flush()


def levels_by_item(db: Session) -> dict[int, str]:
    # Not dict(result): a Result has .keys(), so dict() would treat it as a mapping and fail.
    return {item_id: level for item_id, level in db.execute(select(PantryEntry.item_id, PantryEntry.level))}
