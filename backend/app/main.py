"""FastAPI entry point: `uvicorn app.main:app` from backend/."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core import migrate
from app.core.local_name import LocalName
from app.core.config import Settings, get_settings
from app.core.db import Database
from app.core.modules import MODULES, mount_routers


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.recipes_dir.mkdir(parents=True, exist_ok=True)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        migrate.upgrade(settings.db_path)
        announcer = LocalName(settings.local_name, settings.local_port) if settings.local_name else None
        if announcer:
            announcer.start()
        try:
            yield
        finally:
            if announcer:
                announcer.stop()
            app.state.db.engine.dispose()

    app = FastAPI(title="Family Mission Control", lifespan=lifespan)
    app.state.settings = settings
    app.state.db = Database(settings.db_path)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "modules": MODULES}

    mount_routers(app)
    _serve_frontend(app, settings)
    return app


def _serve_frontend(app: FastAPI, settings: Settings) -> None:
    """Serve the built React app (frontend/dist) with SPA fallback, if it has been built."""
    dist = settings.frontend_dist
    if not (dist / "index.html").exists():
        return
    if (dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        file = (dist / path).resolve()
        if path and file.is_file() and file.is_relative_to(dist.resolve()):
            return FileResponse(file)
        return FileResponse(dist / "index.html")


app = create_app()
