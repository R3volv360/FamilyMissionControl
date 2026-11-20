"""Back up the app's data (database + recipe folders) to one dated zip. Safe while the app is running.

    cd backend
    .venv\\Scripts\\python scripts\\backup.py                      # to MC_BACKUP_DIR (default: ..\\backups)
    .venv\\Scripts\\python scripts\\backup.py --to E:\\Backups --keep 30
    .venv\\Scripts\\python scripts\\backup.py --list
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import backup  # noqa: E402
from app.core.config import get_settings  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Back up Mission Control's data")
    ap.add_argument("--to", type=Path, help="folder for the backup zips (default: MC_BACKUP_DIR)")
    ap.add_argument("--keep", type=int, default=14, help="how many backups to keep (default 14; 0 keeps all)")
    ap.add_argument("--list", action="store_true", help="list existing backups and stop")
    args = ap.parse_args()
    settings = get_settings()

    if args.list:
        for p in backup.list_backups(settings, args.to):
            print(f"{p}  ({p.stat().st_size / 1_000_000:.1f} MB)")
        return

    if not settings.db_path.exists():
        sys.exit(f"No database at {settings.db_path}. Is MC_DATA_DIR set correctly?")
    result = backup.create(settings, args.to, args.keep)
    size = result.path.stat().st_size / 1_000_000
    print(f"Backed up the database and {result.recipes} recipes ({result.files} files) to {result.path} ({size:.1f} MB)")
    for old in result.removed:
        print(f"Removed old backup {old.name}")


if __name__ == "__main__":
    main()
