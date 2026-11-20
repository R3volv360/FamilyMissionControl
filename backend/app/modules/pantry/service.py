"""What's in my Pantry (P1–P5). Rename/delete of remembered items (P5) is the items module's job."""
from sqlalchemy.orm import Session

from app.modules.items import service as items
from app.modules.pantry import repository as repo
from app.modules.pantry.models import EMPTY, FULL, LEVELS, ONE, PantryEntry


class PantryError(Exception):
    pass


class NotFound(PantryError):
    pass


class InvalidLevel(PantryError):
    pass


# ---- references to known items -------------------------------------------------------------------------

# When two items merge and both are in the pantry, keep the lower stock level, so nothing drops off "to buy".
_RANK = {FULL: 2, ONE: 1, EMPTY: 0}


class _PantryItemRefs:
    label = "pantry"

    def usage(self, db: Session, item_id: int) -> int:
        return 1 if repo.get_by_item(db, item_id) else 0

    def reassign(self, db: Session, from_id: int, to_id: int) -> None:
        source = repo.get_by_item(db, from_id)
        if not source:
            return
        target = repo.get_by_item(db, to_id)
        if target:
            target.level = min(source.level, target.level, key=_RANK.__getitem__)
            repo.delete(db, source)
        else:
            source.item_id = to_id
            db.flush()

    def detach(self, db: Session, item_id: int) -> None:
        if entry := repo.get_by_item(db, item_id):
            repo.delete(db, entry)


items.register_references(_PantryItemRefs())


# ---- operations ----------------------------------------------------------------------------------------


def list_entries(db: Session) -> list[PantryEntry]:
    return repo.list_all(db)


def get(db: Session, entry_id: int) -> PantryEntry:
    entry = repo.get(db, entry_id)
    if not entry:
        raise NotFound(f"No pantry entry {entry_id}")
    return entry


def add(db: Session, name: str) -> tuple[PantryEntry, bool]:
    """P1: add by name (remembered in the central list). Returns (entry, created); an item already in the
    pantry is returned as-is."""
    try:
        item, _ = items.get_or_create(db, name)
    except items.InvalidName as e:
        raise PantryError(str(e)) from e
    if existing := repo.get_by_item(db, item.id):
        return existing, False
    return repo.add(db, item.id, FULL), True


def set_level(db: Session, entry_id: int, level: str) -> PantryEntry:
    """P3: Fully stocked, Only one or Empty. Empty items stay on the list."""
    if level not in LEVELS:
        raise InvalidLevel(f"Stock level must be one of {', '.join(LEVELS)}")
    entry = get(db, entry_id)
    entry.level = level
    db.flush()
    return entry


def remove(db: Session, entry_id: int) -> None:
    """Take an item off the pantry list; it stays in the central list of known items."""
    repo.delete(db, get(db, entry_id))


def levels_by_item(db: Session) -> dict[int, str]:
    """Item id -> stock level, for the Meal Planner (M8)."""
    return repo.levels_by_item(db)
