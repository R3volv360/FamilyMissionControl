"""Central list of known items (R1, P1/P4/P5, F1/F4/F5).

Names are matched on a normalised key so "Carrots", "carrot" and " CARROT " are one item. The display name
keeps the first spelling typed (tidied), and rename changes it.

Other modules point at items (pantry entries, freezer entries, recipe ingredients). The items module doesn't
import them; instead each registers an `ItemReferences` provider, so usage checks, merges and deletes reach
every module without this one knowing about them.
"""
import html
import re
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy.orm import Session

from app.modules.items import repository as repo
from app.modules.items.models import Item

MAX_NAME = 120


class ItemError(Exception):
    pass


class InvalidName(ItemError):
    pass


class NotFound(ItemError):
    pass


class NameConflict(ItemError):
    """Renaming onto a name another item already has; retry with merge=True to merge them."""

    def __init__(self, existing: Item):
        super().__init__(f'"{existing.name}" already exists')
        self.existing = existing


class InUse(ItemError):
    def __init__(self, usage: dict[str, int]):
        super().__init__("Item is in use")
        self.usage = usage


# ---- references from other modules ---------------------------------------------------------------------

class ItemReferences(Protocol):
    label: str  # e.g. "pantry", shown to the user

    def usage(self, db: Session, item_id: int) -> int: ...

    def reassign(self, db: Session, from_id: int, to_id: int) -> None:
        """Point references at `to_id` instead (merge). Must cope with both items already being referenced."""

    def detach(self, db: Session, item_id: int) -> None:
        """Remove or unlink references before the item is deleted."""


_providers: dict[str, ItemReferences] = {}


def register_references(provider: ItemReferences) -> None:
    _providers[provider.label] = provider


def usage(db: Session, item_id: int) -> dict[str, int]:
    return {label: n for label, p in _providers.items() if (n := p.usage(db, item_id))}


# ---- names ---------------------------------------------------------------------------------------------

def tidy_name(name: str) -> str:
    """Display form: markup and entities removed, whitespace collapsed, first letter capitalised."""
    name = html.unescape(re.sub(r"<[^>]+>", "", name or ""))
    name = re.sub(r"\s+", " ", name).strip()
    return name[:1].upper() + name[1:]


def _singular(word: str) -> str:
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"  # berries -> berry
    if re.search(r"(ches|shes|xes|sses|oes)$", word):
        return word[:-2]  # tomatoes -> tomato, peaches -> peach
    if word.endswith("s") and not re.search(r"(ss|us|is)$", word) and len(word) > 3:
        return word[:-1]  # carrots -> carrot (but not glass, hummus, ...)
    return word


def normalise_key(name: str) -> str:
    """Matching key: lower case, punctuation folded to spaces, last word made singular."""
    words = re.sub(r"[^\w]+", " ", tidy_name(name).lower()).split()
    if words:
        words[-1] = _singular(words[-1])
    return " ".join(words)


def _validate(name: str) -> tuple[str, str]:
    display = tidy_name(name)
    key = normalise_key(display)
    if not key:
        raise InvalidName("Name can't be empty")
    if len(display) > MAX_NAME:
        raise InvalidName(f"Name is longer than {MAX_NAME} characters")
    return display, key


# ---- operations ----------------------------------------------------------------------------------------

def get(db: Session, item_id: int) -> Item:
    item = repo.get(db, item_id)
    if not item:
        raise NotFound(f"No item {item_id}")
    return item


def list_items(db: Session) -> list[Item]:
    return repo.list_all(db)


def find(db: Session, name: str) -> Item | None:
    key = normalise_key(name)
    return repo.get_by_key(db, key) if key else None


def get_or_create(db: Session, name: str) -> tuple[Item, bool]:
    """Returns (item, created). Doesn't commit; callers own the transaction."""
    display, key = _validate(name)
    if existing := repo.get_by_key(db, key):
        return existing, False
    return repo.add(db, display, key), True


def search(db: Session, query: str, limit: int = 10) -> list[Item]:
    """Autocomplete (P4/F4): names starting with the query first, then names with a word starting with it."""
    q = re.sub(r"\s+", " ", query or "").strip()
    if not q:
        return []
    ql = q.lower()
    hits = repo.search_prefix(db, q)
    hits.sort(key=lambda i: (not i.name.lower().startswith(ql), i.name.lower()))
    return hits[:limit]


@dataclass
class RenameResult:
    item: Item
    merged_from: int | None = None  # id of the item that was merged away


def rename(db: Session, item_id: int, new_name: str, merge: bool = False) -> RenameResult:
    item = get(db, item_id)
    display, key = _validate(new_name)
    existing = repo.get_by_key(db, key)
    if existing is None or existing.id == item.id:
        item.name, item.key = display, key
        db.flush()
        return RenameResult(item)
    if not merge:
        raise NameConflict(existing)
    # Merge: everything that pointed at `item` now points at `existing`, then `item` goes.
    for p in _providers.values():
        p.reassign(db, item.id, existing.id)
    repo.delete(db, item)
    return RenameResult(existing, merged_from=item_id)


def delete(db: Session, item_id: int, force: bool = False) -> None:
    item = get(db, item_id)
    if (used := usage(db, item_id)) and not force:
        raise InUse(used)
    for p in _providers.values():
        p.detach(db, item_id)
    repo.delete(db, item)
