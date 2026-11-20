"""Autogenerate an Alembic migration from model changes, against a throwaway DB at head.

    cd backend && .venv/Scripts/python scripts/new_migration.py "add pantry entries"

Review the generated file in migrations/versions/ before committing.
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

from app.core.migrate import BACKEND_DIR, upgrade  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "scratch.db"
        upgrade(db)
        cfg = Config(str(BACKEND_DIR / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
        cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db.as_posix()}")
        command.revision(cfg, message=sys.argv[1], autogenerate=True)


if __name__ == "__main__":
    main()
