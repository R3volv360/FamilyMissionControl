from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.modules.items.models import Item

# Stock levels (spec: "Stock levels"). Only FULL counts as "already in the pantry" on the Meal Planner's list.
FULL, ONE, EMPTY = "full", "one", "empty"
LEVELS = (FULL, ONE, EMPTY)


class PantryEntry(Base):
    """An item kept in the pantry, with its stock level (P1–P3). Names only; no quantities."""

    __tablename__ = "pantry_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), unique=True)
    level: Mapped[str] = mapped_column(String(10), default=FULL)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    item: Mapped[Item] = relationship(lazy="joined")
