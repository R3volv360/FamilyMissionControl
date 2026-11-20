from pydantic import BaseModel, ConfigDict


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class ItemDetail(ItemOut):
    usage: dict[str, int]  # e.g. {"pantry": 1, "recipes": 3}


class ItemCreate(BaseModel):
    name: str


class ItemCreated(BaseModel):
    item: ItemOut
    created: bool


class ItemRename(BaseModel):
    name: str
    merge: bool = False


class ItemRenamed(BaseModel):
    item: ItemOut
    merged_from: int | None = None
