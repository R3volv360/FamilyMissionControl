from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.modules.items.models import Item


class FreezerEntry(Base):
    """An item in the freezer (F1–F3). Its total weight is always worked out from its packs, never stored."""

    __tablename__ = "freezer_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), unique=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    item: Mapped[Item] = relationship(lazy="joined")
    packs: Mapped[list["FreezerPack"]] = relationship(
        back_populates="entry", cascade="all, delete-orphan", lazy="selectin",
        order_by="FreezerPack.weight_g.desc()",
    )

    @property
    def total_g(self) -> int:
        return sum(p.weight_g * p.count for p in self.packs)


class FreezerPack(Base):
    """`count` packs of `weight_g` grams each, e.g. 2 × 400 g."""

    __tablename__ = "freezer_packs"
    __table_args__ = (
        UniqueConstraint("entry_id", "weight_g"),
        CheckConstraint("weight_g > 0", name="weight_positive"),
        CheckConstraint("count > 0", name="count_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("freezer_entries.id", ondelete="CASCADE"), index=True)
    weight_g: Mapped[int] = mapped_column(Integer)
    count: Mapped[int] = mapped_column(Integer)

    entry: Mapped[FreezerEntry] = relationship(back_populates="packs")
