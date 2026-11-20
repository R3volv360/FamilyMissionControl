"""Shared FastAPI dependencies for module routers."""
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import Settings


def get_db(request: Request) -> Iterator[Session]:
    yield from request.app.state.db.session()


def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings


DbSession = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_app_settings)]
