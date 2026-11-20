from datetime import datetime

from pydantic import BaseModel, Field


class PackOut(BaseModel):
    weight_g: int
    count: int
    label: str  # "400 g"


class FreezerEntryOut(BaseModel):
    id: int
    item_id: int
    name: str
    total_g: int
    total_label: str  # "1 kg"
    breakdown: str  # "2 × 400 g, 1 × 200 g"
    packs: list[PackOut]
    updated_at: datetime


class PackIn(BaseModel):
    weight_g: int
    count: int = Field(1)


class FreezerAdd(BaseModel):
    name: str
    packs: list[PackIn]
    total_g: int | None = None  # optional check: must equal the packs' total


class FreezerAdded(BaseModel):
    entry: FreezerEntryOut
    created: bool


class PackRemoved(BaseModel):
    entry: FreezerEntryOut | None  # None when the last pack went and the item left the freezer
