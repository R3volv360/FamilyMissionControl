"""Run Alembic migrations programmatically (on app start-up and in tests)."""
from pathlib import Path

from alembic import command
from alembic.config import Config

BACKEND_DIR = Path(__file__).resolve().parents[2]


def upgrade(db_path: Path) -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path.as_posix()}")
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")
