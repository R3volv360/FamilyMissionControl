from fastapi import APIRouter, HTTPException, Response

from app.core.deps import DbSession
from app.modules.freezer import service
from app.modules.freezer.models import FreezerEntry
from app.modules.freezer.schemas import FreezerAdd, FreezerAdded, FreezerEntryOut, PackIn, PackOut, PackRemoved

router = APIRouter()


def _out(e: FreezerEntry) -> FreezerEntryOut:
    return FreezerEntryOut(
        id=e.id,
        item_id=e.item_id,
        name=e.item.name,
        total_g=e.total_g,
        total_label=service.format_grams(e.total_g),
        breakdown=service.breakdown(e),
        packs=[PackOut(weight_g=p.weight_g, count=p.count, label=service.format_grams(p.weight_g)) for p in e.packs],
        updated_at=e.updated_at,
    )


def _http(e: service.FreezerError) -> HTTPException:
    if isinstance(e, service.NotFound):
        return HTTPException(404, str(e))
    return HTTPException(422, str(e))


def _reload(db, entry: FreezerEntry) -> FreezerEntryOut:
    db.commit()
    db.refresh(entry)
    return _out(entry)


@router.get("", response_model=list[FreezerEntryOut])
def list_freezer(db: DbSession):
    return [_out(e) for e in service.list_entries(db)]


@router.post("", response_model=FreezerAdded)
def add(body: FreezerAdd, response: Response, db: DbSession):
    packs = [service.PackIn(p.weight_g, p.count) for p in body.packs]
    try:
        entry, created = service.add(db, body.name, packs, body.total_g)
    except service.FreezerError as e:
        raise _http(e)
    response.status_code = 201 if created else 200
    return FreezerAdded(entry=_reload(db, entry), created=created)


@router.post("/{entry_id}/packs", response_model=FreezerEntryOut)
def add_pack(entry_id: int, body: PackIn, db: DbSession):
    try:
        entry = service.add_pack(db, entry_id, body.weight_g, body.count)
    except service.FreezerError as e:
        raise _http(e)
    return _reload(db, entry)


@router.delete("/{entry_id}/packs/{weight_g}", response_model=PackRemoved)
def remove_pack(entry_id: int, weight_g: int, db: DbSession):
    """Remove one pack of this size. Removing the last pack takes the item off the freezer list."""
    try:
        entry = service.remove_pack(db, entry_id, weight_g)
    except service.FreezerError as e:
        raise _http(e)
    if entry is None:
        db.commit()
        return PackRemoved(entry=None)
    return PackRemoved(entry=_reload(db, entry))


@router.delete("/{entry_id}", status_code=204)
def remove(entry_id: int, db: DbSession):
    try:
        service.remove(db, entry_id)
    except service.FreezerError as e:
        raise _http(e)
    db.commit()
