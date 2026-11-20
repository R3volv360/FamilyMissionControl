from fastapi import APIRouter, HTTPException, Response

from app.core.deps import DbSession
from app.modules.pantry import service
from app.modules.pantry.models import PantryEntry
from app.modules.pantry.schemas import PantryAdd, PantryAdded, PantryEntryOut, PantryLevel

router = APIRouter()


def _out(e: PantryEntry) -> PantryEntryOut:
    return PantryEntryOut(id=e.id, item_id=e.item_id, name=e.item.name, level=e.level, updated_at=e.updated_at)


def _http(e: service.PantryError) -> HTTPException:
    if isinstance(e, service.NotFound):
        return HTTPException(404, str(e))
    return HTTPException(422, str(e))


@router.get("", response_model=list[PantryEntryOut])
def list_pantry(db: DbSession):
    return [_out(e) for e in service.list_entries(db)]


@router.post("", response_model=PantryAdded)
def add(body: PantryAdd, response: Response, db: DbSession):
    try:
        entry, created = service.add(db, body.name)
    except service.PantryError as e:
        raise _http(e)
    db.commit()
    db.refresh(entry)
    response.status_code = 201 if created else 200
    return PantryAdded(entry=_out(entry), created=created)


@router.patch("/{entry_id}", response_model=PantryEntryOut)
def set_level(entry_id: int, body: PantryLevel, db: DbSession):
    try:
        entry = service.set_level(db, entry_id, body.level)
    except service.PantryError as e:
        raise _http(e)
    db.commit()
    db.refresh(entry)
    return _out(entry)


@router.delete("/{entry_id}", status_code=204)
def remove(entry_id: int, db: DbSession):
    try:
        service.remove(db, entry_id)
    except service.PantryError as e:
        raise _http(e)
    db.commit()
