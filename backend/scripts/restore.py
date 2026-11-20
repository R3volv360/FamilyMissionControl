"""Restore the app's data from a backup zip made by scripts/backup.py. STOP THE APP FIRST.

    cd backend
    .venv\\Scripts\\python scripts\\restore.py ..\\backups\\mission-control-20261120-030000.zip

The current data folder isn't deleted: it's moved aside to data.before-restore-<date-time>.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import backup  # noqa: E402
from app.core.config import get_settings  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Restore Mission Control's data from a backup. Stop the app first.")
    ap.add_argument("archive", type=Path)
    ap.add_argument("--yes", action="store_true", help="don't ask for confirmation")
    args = ap.parse_args()
    settings = get_settings()

    if not args.archive.exists():
        sys.exit(f"No such file: {args.archive}")
    if not args.yes:
        answer = input(f"Replace the data in {settings.data_dir} with {args.archive.name}? "
                       "The app must be stopped. [y/N] ")
        if answer.strip().lower() not in ("y", "yes"):
            sys.exit("Nothing changed.")
    try:
        moved = backup.restore(settings, args.archive)
    except backup.RestoreError as e:
        sys.exit(f"Not restored: {e}")
    except PermissionError:
        sys.exit("Not restored: the data folder is in use. Stop the app and try again.")
    print(f"Restored {args.archive.name} into {settings.data_dir}.")
    if moved:
        print(f"The previous data is in {moved}; delete it once you're happy.")


if __name__ == "__main__":
    main()
