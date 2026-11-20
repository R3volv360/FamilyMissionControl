from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class RecipeSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    title: str
    subtitle: str
    serves: int | None
    s3_state: str | None
    s3_error: str | None
    updated_at: datetime


class IngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    section: str
    qty: str
    name: str
    allergens: str
    item_id: int | None


class RecipeDetail(RecipeSummary):
    data: dict[str, Any]  # recipe.json as uploaded
    ingredients: list[IngredientOut]
    files: list[str]


class StoreOut(BaseModel):
    recipe: RecipeSummary
    replaced: bool
    warnings: list[str]
    ignored: list[str]


class SyncRowOut(BaseModel):
    slug: str
    title: str
    state: str  # both | app | s3


class CertOut(BaseModel):
    subject: str
    expires: datetime
    days_left: int


class AwsStatusOut(BaseModel):
    ok: bool
    message: str
    profile: str | None
    identity: str | None
    cert: CertOut | None
    cert_warning: str | None
