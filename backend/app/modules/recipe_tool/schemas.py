"""The Recipe Tool's view of a recipe: plain text, one row per ingredient and step (spec T1–T7).

`recipe.json` stays the stored format (owned by the recipe-card skill); the service converts both ways.
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

PhotoAction = Literal["keep", "new", "none"]


class EditorIngredient(BaseModel):
    qty: str = Field("", max_length=40)  # as written: "200 g", "½ tsp", "2", "128 g*" or blank
    name: str = Field(max_length=200)
    cupboard: bool = False  # T4: stored in recipe.json's "pantry" list
    allergens: str = Field("", max_length=200)  # not shown in the tool; carried through so it isn't lost


class EditorStep(BaseModel):
    title: str = Field("", max_length=200)
    text: str = Field("", max_length=5000)  # one line per bullet
    # In what the server sends: "keep" when the step has a photo. In a save: keep `photo_from`'s photo,
    # use the uploaded step-<n>.jpg ("new"), or no photo.
    photo: PhotoAction = "none"
    photo_from: int | None = Field(None, ge=1)  # the step number whose photo this was when loaded


class EditorRecipe(BaseModel):
    slug: str | None = None  # None for a new recipe; fixed once created (T2)
    title: str = Field(max_length=200)
    subtitle: str = Field("", max_length=300)
    serves: int | None = Field(4, ge=1, le=99)
    hero: PhotoAction = "none"
    ingredients: list[EditorIngredient] = Field(default_factory=list, max_length=200)
    steps: list[EditorStep] = Field(default_factory=list, max_length=100)
    updated_at: datetime | None = None  # sent when loading (photo cache key, draft check); ignored on save
