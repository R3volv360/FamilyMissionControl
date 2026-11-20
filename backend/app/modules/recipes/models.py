from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Recipe(Base):
    """A recipe stored in the app. Its files (recipe.json, hero.jpg, s1.jpg…) live in data/recipes/<slug>/."""

    __tablename__ = "recipes"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    subtitle: Mapped[str] = mapped_column(String(300), default="")
    serves: Mapped[int | None] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSON)  # recipe.json as uploaded (shape owned by the recipe-card skill)
    # Background S3 upload after a local upload (R2): None | pending | uploading | done | failed
    s3_state: Mapped[str | None] = mapped_column(String(20))
    s3_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        back_populates="recipe", cascade="all, delete-orphan", order_by="RecipeIngredient.position"
    )


class RecipeIngredient(Base):
    """One ingredient or recipe-pantry line, linked to the central list of known items (R1)."""

    __tablename__ = "recipe_ingredients"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipe_id: Mapped[int] = mapped_column(ForeignKey("recipes.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    section: Mapped[str] = mapped_column(String(20))  # "ingredients" | "pantry"
    qty: Mapped[str] = mapped_column(String(60), default="")  # exactly as written, e.g. "128 g*", "½ tsp"
    name: Mapped[str] = mapped_column(String(200))
    allergens: Mapped[str] = mapped_column(String(200), default="")
    item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id", ondelete="SET NULL"), index=True)

    recipe: Mapped[Recipe] = relationship(back_populates="ingredients")
