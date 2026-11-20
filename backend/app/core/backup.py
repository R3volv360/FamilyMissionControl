"""Backups of everything the app keeps: the SQLite database and the recipe folders, as one dated zip.

The database is copied with SQLite's online backup, so it's consistent even while the app is running.
Restoring moves the current data folder aside (nothing is deleted) and unpacks the backup in its place;
stop the app first.
"""
import json
import shutil
import sqlite3
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from app.core.config import Settings

DB_NAME = "mission-control.db"
MANIFEST = "backup.json"
PREFIX = "mission-control-"


@dataclass
class BackupResult:
    path: Path
    recipes: int
    files: int
    removed: list[Path]


def create(settings: Settings, dest: Path | None = None, keep: int = 14) -> BackupResult:
    """Write mission-control-YYYYMMDD-HHMMSS.zip into `dest` (default: the configured backup folder) and keep
    only the newest `keep` backups there."""
    dest = dest or settings.backup_dir
    dest.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = dest / f"{PREFIX}{stamp}.zip"
    partial = target.with_suffix(".zip.partial")

    with tempfile.TemporaryDirectory() as tmp:
        db_copy = Path(tmp) / DB_NAME
        if settings.db_path.exists():
            src = sqlite3.connect(settings.db_path)
            dst = sqlite3.connect(db_copy)
            try:
                src.backup(dst)
            finally:
                dst.close()
                src.close()

        recipe_files = sorted(p for p in settings.recipes_dir.rglob("*")
                              if p.is_file() and not p.relative_to(settings.recipes_dir).parts[0].startswith("."))
        recipes = {p.relative_to(settings.recipes_dir).parts[0] for p in recipe_files}
        manifest = {"created": datetime.now().isoformat(timespec="seconds"), "recipes": len(recipes),
                    "files": len(recipe_files), "database": db_copy.exists()}

        with zipfile.ZipFile(partial, "w", compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr(MANIFEST, json.dumps(manifest, indent=2))
            if db_copy.exists():
                z.write(db_copy, DB_NAME)
            for p in recipe_files:
                z.write(p, f"recipes/{p.relative_to(settings.recipes_dir).as_posix()}")
    partial.replace(target)

    backups = sorted(dest.glob(f"{PREFIX}*.zip"), key=lambda p: p.name, reverse=True)
    removed = backups[keep:] if keep > 0 else []
    for old in removed:
        old.unlink()
    return BackupResult(target, len(recipes), len(recipe_files), removed)


def list_backups(settings: Settings, dest: Path | None = None) -> list[Path]:
    dest = dest or settings.backup_dir
    return sorted(dest.glob(f"{PREFIX}*.zip"), key=lambda p: p.name, reverse=True) if dest.exists() else []


class RestoreError(Exception):
    pass


def restore(settings: Settings, archive: Path) -> Path | None:
    """Replace the data folder with a backup. The current data folder is moved aside to
    `<data>.before-restore-<stamp>` and its path returned (None if there was no data folder)."""
    if not zipfile.is_zipfile(archive):
        raise RestoreError(f"{archive} isn't a zip file")
    data = settings.data_dir
    with zipfile.ZipFile(archive) as z:
        names = z.namelist()
        if MANIFEST not in names:
            raise RestoreError(f"{archive.name} isn't a Mission Control backup (no {MANIFEST})")
        staging = data.parent / f".{data.name}.restoring"
        shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir(parents=True)
        root = staging.resolve()
        for name in names:
            if name == MANIFEST or name.endswith("/"):
                continue
            out = (staging / name).resolve()
            if not out.is_relative_to(root):  # a hand-made zip trying to write outside the data folder
                shutil.rmtree(staging, ignore_errors=True)
                raise RestoreError(f"Refusing to restore {name!r}: it points outside the data folder")
            out.parent.mkdir(parents=True, exist_ok=True)
            with z.open(name) as src, open(out, "wb") as dst:
                shutil.copyfileobj(src, dst)
    (staging / "recipes").mkdir(exist_ok=True)

    moved = None
    try:
        if data.exists():
            moved = data.parent / f"{data.name}.before-restore-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
            data.rename(moved)  # fails on Windows while the app has the database open
        staging.rename(data)
    except OSError:
        if moved is not None and moved.exists() and not data.exists():
            moved.rename(data)  # put the original back
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return moved
