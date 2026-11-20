"""Storage for known items. No business rules here."""
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.modules.items.models import Item


def get(db: Session, item_id: int) -> Item | None:
    return db.get(Item, item_id)


def get_by_key(db: Session, key: str) -> Item | None:
    return db.scalar(select(Item).where(Item.key == key))


def list_all(db: Session) -> list[Item]:
    return list(db.scalars(select(Item).order_by(func.lower(Item.name))))


def search_prefix(db: Session, prefix: str) -> list[Item]:
    """Items whose name, or any word in it, starts with `prefix` (case-insensitive)."""
    p = prefix.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    name = func.lower(Item.name)
    stmt = select(Item).where(or_(name.like(f"{p}%", escape="\\"), name.like(f"% {p}%", escape="\\")))
    return list(db.scalars(stmt))


def add(db: Session, name: str, key: str) -> Item:
    item = Item(name=name, key=key)
    db.add(item)
    db.flush()
    return item


def delete(db: Session, item: Item) -> None:
    db.delete(item)
    db.flush()
