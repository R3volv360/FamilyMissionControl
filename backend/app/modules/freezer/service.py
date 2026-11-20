"""What's in my Freezer (F1–F5). Unlike the pantry, the freezer tracks real quantities: grams, in packs.

Rename/delete of remembered items (F5) is the items module's job.
"""
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.modules.freezer import repository as repo
from app.modules.freezer.models import FreezerEntry
from app.modules.items import service as items

MAX_PACK_G = 50_000  # 50 kg: anything bigger is a typo
MAX_COUNT = 999


class FreezerError(Exception):
    pass


class NotFound(FreezerError):
    pass


class InvalidPacks(FreezerError):
    pass


@dataclass
class PackIn:
    weight_g: int
    count: int = 1


# ---- formatting (F2) -----------------------------------------------------------------------------------


def format_grams(g: int) -> str:
    """400 -> "400 g", 1000 -> "1 kg", 1250 -> "1.25 kg", 2005 -> "2.005 kg" (exact)."""
    if g < 1000:
        return f"{g} g"
    return f"{g / 1000:.3f}".rstrip("0").rstrip(".") + " kg"


def breakdown(entry: FreezerEntry) -> str:
    """"2 × 400 g, 1 × 200 g", biggest packs first."""
    return ", ".join(f"{p.count} × {format_grams(p.weight_g)}" for p in entry.packs)


def summary(entry: FreezerEntry) -> str:
    """"Mince 1 kg (2 × 400 g, 1 × 200 g)"."""
    return f"{entry.item.name} {format_grams(entry.total_g)} ({breakdown(entry)})"


# ---- references to known items -------------------------------------------------------------------------


class _FreezerItemRefs:
    label = "freezer"

    def usage(self, db: Session, item_id: int) -> int:
        return 1 if repo.get_by_item(db, item_id) else 0

    def reassign(self, db: Session, from_id: int, to_id: int) -> None:
        source = repo.get_by_item(db, from_id)
        if not source:
            return
        target = repo.get_by_item(db, to_id)
        if target:  # both in the freezer: pool their packs
            for p in list(source.packs):
                repo.add_pack(db, target, p.weight_g, p.count)
            repo.delete(db, source)
        else:
            source.item_id = to_id
            db.flush()

    def detach(self, db: Session, item_id: int) -> None:
        if entry := repo.get_by_item(db, item_id):
            repo.delete(db, entry)


items.register_references(_FreezerItemRefs())


# ---- operations ----------------------------------------------------------------------------------------


def _check_pack(weight_g: int, count: int) -> None:
    if not isinstance(weight_g, int) or not 0 < weight_g <= MAX_PACK_G:
        raise InvalidPacks(f"Pack weight must be between 1 g and {format_grams(MAX_PACK_G)}")
    if not isinstance(count, int) or not 0 < count <= MAX_COUNT:
        raise InvalidPacks(f"Number of packs must be between 1 and {MAX_COUNT}")


def list_entries(db: Session) -> list[FreezerEntry]:
    return repo.list_all(db)


def get(db: Session, entry_id: int) -> FreezerEntry:
    entry = repo.get(db, entry_id)
    if not entry:
        raise NotFound(f"No freezer entry {entry_id}")
    return entry


def add(db: Session, name: str, packs: list[PackIn], total_g: int | None = None) -> tuple[FreezerEntry, bool]:
    """F1: add an item with its packs, e.g. Mince, 2 × 400 g + 1 × 200 g. If `total_g` is given it must equal
    the packs' total. Adding an item that's already in the freezer adds the packs to it.
    Returns (entry, created)."""
    if not packs:
        raise InvalidPacks("Add at least one pack")
    for p in packs:
        _check_pack(p.weight_g, p.count)
    pack_total = sum(p.weight_g * p.count for p in packs)
    if total_g is not None and total_g != pack_total:
        raise InvalidPacks(f"The packs add up to {format_grams(pack_total)}, not {format_grams(total_g)}")
    try:
        item, _ = items.get_or_create(db, name)
    except items.InvalidName as e:
        raise FreezerError(str(e)) from e

    entry = repo.get_by_item(db, item.id)
    created = entry is None
    if created:
        entry = repo.add(db, item.id)
    for p in packs:
        repo.add_pack(db, entry, p.weight_g, p.count)
    return entry, created


def add_pack(db: Session, entry_id: int, weight_g: int, count: int = 1) -> FreezerEntry:
    """F3: add pack(s) of a size; the total updates with it."""
    _check_pack(weight_g, count)
    entry = get(db, entry_id)
    repo.add_pack(db, entry, weight_g, count)
    return entry


def remove_pack(db: Session, entry_id: int, weight_g: int) -> FreezerEntry | None:
    """F3: one pack of this size used up. When the last pack goes the item comes off the freezer list (its
    name stays in the central list of known items); returns None then."""
    entry = get(db, entry_id)
    pack = repo.find_pack(entry, weight_g)
    if not pack:
        raise NotFound(f"No {format_grams(weight_g)} pack of {entry.item.name}")
    if pack.count > 1:
        pack.count -= 1
        db.flush()
    else:
        repo.remove_pack(db, entry, pack)
    if not entry.packs:
        repo.delete(db, entry)
        return None
    return entry


def remove(db: Session, entry_id: int) -> None:
    """Take an item off the freezer list entirely; it stays in the central list of known items."""
    repo.delete(db, get(db, entry_id))


def totals_by_item(db: Session) -> dict[int, int]:
    """Item id -> grams in the freezer, for the Meal Planner (M8/M11)."""
    return repo.totals_by_item(db)
