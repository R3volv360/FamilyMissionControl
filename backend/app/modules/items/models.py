from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Item(Base):
    """One entry in the central list of known items, shared by Recipes (R1), Pantry and Freezer."""

    __tablename__ = "items"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))  # display name, as typed (tidied)
    key: Mapped[str] = mapped_column(String(120), unique=True)  # normalised; see service.normalise_key
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
