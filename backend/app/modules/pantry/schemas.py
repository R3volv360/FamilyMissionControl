from datetime import datetime
from typing import Literal

from pydantic import BaseModel

Level = Literal["full", "one", "empty"]


class PantryEntryOut(BaseModel):
    id: int
    item_id: int
    name: str
    level: Level
    updated_at: datetime


class PantryAdd(BaseModel):
    name: str


class PantryAdded(BaseModel):
    entry: PantryEntryOut
    created: bool


class PantryLevel(BaseModel):
    level: Level
