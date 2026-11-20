"""Storage for freezer entries and their packs. No business rules."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.freezer.models import FreezerEntry, FreezerPack
from app.modules.items.models import Item


def list_all(db: Session) -> list[FreezerEntry]:
    stmt = select(FreezerEntry).join(FreezerEntry.item).order_by(func.lower(Item.name))
    return list(db.scalars(stmt))


def get(db: Session, entry_id: int) -> FreezerEntry | None:
    return db.get(FreezerEntry, entry_id)


def get_by_item(db: Session, item_id: int) -> FreezerEntry | None:
    return db.scalar(select(FreezerEntry).where(FreezerEntry.item_id == item_id))


def add(db: Session, item_id: int) -> FreezerEntry:
    entry = FreezerEntry(item_id=item_id, packs=[])
    db.add(entry)
    db.flush()
    return entry


def delete(db: Session, entry: FreezerEntry) -> None:
    db.delete(entry)
    db.flush()


def find_pack(entry: FreezerEntry, weight_g: int) -> FreezerPack | None:
    return next((p for p in entry.packs if p.weight_g == weight_g), None)


def add_pack(db: Session, entry: FreezerEntry, weight_g: int, count: int) -> None:
    if pack := find_pack(entry, weight_g):
        pack.count += count
    else:
        entry.packs.append(FreezerPack(weight_g=weight_g, count=count))
    entry.packs.sort(key=lambda p: -p.weight_g)
    db.flush()


def remove_pack(db: Session, entry: FreezerEntry, pack: FreezerPack) -> None:
    entry.packs.remove(pack)
    db.flush()


def totals_by_item(db: Session) -> dict[int, int]:
    stmt = (
        select(FreezerEntry.item_id, func.sum(FreezerPack.weight_g * FreezerPack.count))
        .join(FreezerPack, FreezerPack.entry_id == FreezerEntry.id)
        .group_by(FreezerEntry.item_id)
    )
    return {item_id: int(total) for item_id, total in db.execute(stmt)}
