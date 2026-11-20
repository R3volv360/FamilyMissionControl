"""Module registry. Adding a module = create app/modules/<name>/ with a `router.py` exposing `router`
(and `models.py` if it has tables), then add its name here. It's mounted at /api/<name>."""
import importlib

from fastapi import FastAPI

MODULES: list[str] = ["items", "recipes", "pantry", "freezer", "planner", "recipe_tool"]


def import_models() -> None:
    """Import every module's models so their tables register on Base.metadata (used by Alembic)."""
    for name in MODULES:
        try:
            importlib.import_module(f"app.modules.{name}.models")
        except ModuleNotFoundError as e:
            if e.name != f"app.modules.{name}.models":
                raise


def mount_routers(app: FastAPI) -> None:
    for name in MODULES:
        router = importlib.import_module(f"app.modules.{name}.router").router
        app.include_router(router, prefix=f"/api/{name}", tags=[name])
