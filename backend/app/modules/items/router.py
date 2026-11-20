from fastapi import APIRouter, HTTPException, Query, Response

from app.core.deps import DbSession
from app.modules.items import service
from app.modules.items.schemas import ItemCreate, ItemCreated, ItemDetail, ItemOut, ItemRename, ItemRenamed

router = APIRouter()


def _http(e: service.ItemError) -> HTTPException:
    if isinstance(e, service.NotFound):
        return HTTPException(404, str(e))
    if isinstance(e, service.InvalidName):
        return HTTPException(422, str(e))
    if isinstance(e, service.NameConflict):
        return HTTPException(409, {"message": str(e), "conflict": {"id": e.existing.id, "name": e.existing.name}})
    if isinstance(e, service.InUse):
        return HTTPException(409, {"message": str(e), "usage": e.usage})
    return HTTPException(400, str(e))


@router.get("", response_model=list[ItemOut])
def list_or_search(db: DbSession, q: str | None = None, limit: int = Query(10, ge=1, le=50)):
    """All items alphabetically, or autocomplete suggestions when `q` is given."""
    return service.search(db, q, limit) if q is not None else service.list_items(db)


@router.get("/{item_id}", response_model=ItemDetail)
def get_item(item_id: int, db: DbSession):
    try:
        item = service.get(db, item_id)
    except service.ItemError as e:
        raise _http(e)
    return ItemDetail(id=item.id, name=item.name, usage=service.usage(db, item_id))


@router.post("", response_model=ItemCreated)
def create(body: ItemCreate, response: Response, db: DbSession):
    try:
        item, created = service.get_or_create(db, body.name)
    except service.ItemError as e:
        raise _http(e)
    db.commit()
    response.status_code = 201 if created else 200
    return ItemCreated(item=ItemOut.model_validate(item), created=created)


@router.patch("/{item_id}", response_model=ItemRenamed)
def rename(item_id: int, body: ItemRename, db: DbSession):
    try:
        result = service.rename(db, item_id, body.name, merge=body.merge)
    except service.ItemError as e:
        raise _http(e)
    db.commit()
    return ItemRenamed(item=ItemOut.model_validate(result.item), merged_from=result.merged_from)


@router.delete("/{item_id}", status_code=204)
def delete(item_id: int, db: DbSession, force: bool = False):
    try:
        service.delete(db, item_id, force=force)
    except service.ItemError as e:
        raise _http(e)
    db.commit()
