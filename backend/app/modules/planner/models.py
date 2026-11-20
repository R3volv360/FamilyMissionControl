from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.modules.recipes.models import Recipe


class PlannedMeal(Base):
    """One meal on one day (M1). A day can hold several, ordered by `position`.

    Every week is kept as history (M7). The recipe's slug and title are copied in, so a meal still reads
    sensibly if its recipe is later deleted from the app; it re-links if a recipe with that slug comes back.
    """

    __tablename__ = "planned_meals"

    id: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    position: Mapped[int] = mapped_column(Integer)
    recipe_id: Mapped[int | None] = mapped_column(ForeignKey("recipes.id", ondelete="SET NULL"), index=True)
    recipe_slug: Mapped[str] = mapped_column(String(120))
    recipe_title: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    recipe: Mapped[Recipe | None] = relationship(lazy="joined")
