import json
import sqlite3
import zipfile

import pytest

from app.core import backup
from tests.test_recipes import SLUG, upload


def test_backup_and_restore_round_trip(client, settings, tmp_path):
    upload(client)
    client.post("/api/pantry", json={"name": "Basil"})
    client.post("/api/freezer", json={"name": "Mince", "packs": [{"weight_g": 400, "count": 2}]})

    result = backup.create(settings, tmp_path / "bk")  # while the app is running
    assert result.path.name.startswith("mission-control-") and result.recipes == 1 and result.files == 7
    with zipfile.ZipFile(result.path) as z:
        names = set(z.namelist())
        assert {"backup.json", "mission-control.db", f"recipes/{SLUG}/recipe.json", f"recipes/{SLUG}/hero.jpg"} <= names
        assert json.loads(z.read("backup.json"))["recipes"] == 1

    # Lose some data, then restore
    client.delete(f"/api/recipes/{SLUG}", params={"where": "app"})
    client.app.state.db.engine.dispose()  # "stop the app" so the data folder can move
    moved = backup.restore(settings, result.path)
    assert moved and moved.exists() and moved.name.startswith("data.before-restore-")

    db = sqlite3.connect(settings.db_path)
    assert db.execute("select slug from recipes").fetchall() == [(SLUG,)]
    assert db.execute("select count(*) from pantry_entries").fetchone() == (1,)
    assert db.execute("select weight_g, count from freezer_packs").fetchall() == [(400, 2)]
    db.close()
    assert (settings.recipes_dir / SLUG / "hero.jpg").exists()


def test_keeps_newest_backups_only(settings, tmp_path, client):
    dest = tmp_path / "bk"
    dest.mkdir()
    for stamp in ["20260101-000000", "20260102-000000", "20260103-000000"]:
        (dest / f"mission-control-{stamp}.zip").write_bytes(b"old")
    (dest / "notes.txt").write_text("not a backup")
    result = backup.create(settings, dest, keep=2)
    kept = sorted(p.name for p in dest.iterdir())
    assert kept == sorted([result.path.name, "mission-control-20260103-000000.zip", "notes.txt"])
    assert [p.name for p in result.removed] == ["mission-control-20260102-000000.zip", "mission-control-20260101-000000.zip"]


def test_restore_rejects_other_zips(settings, tmp_path):
    bad = tmp_path / "x.zip"
    with zipfile.ZipFile(bad, "w") as z:
        z.writestr("hello.txt", "hi")
    with pytest.raises(backup.RestoreError, match="isn't a Mission Control backup"):
        backup.restore(settings, bad)
    (tmp_path / "y.zip").write_text("not a zip")
    with pytest.raises(backup.RestoreError, match="isn't a zip"):
        backup.restore(settings, tmp_path / "y.zip")


def test_restore_refuses_paths_outside_data_folder(settings, tmp_path):
    evil = tmp_path / "evil.zip"
    with zipfile.ZipFile(evil, "w") as z:
        z.writestr("backup.json", "{}")
        z.writestr("../../outside.txt", "gotcha")
    with pytest.raises(backup.RestoreError, match="outside the data folder"):
        backup.restore(settings, evil)
    assert not (tmp_path / "outside.txt").exists()
