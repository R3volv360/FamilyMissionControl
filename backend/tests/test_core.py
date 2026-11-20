from sqlalchemy import text


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_migrations_create_db_in_wal_mode(client, settings):
    assert settings.db_path.exists()
    with client.app.state.db.engine.connect() as conn:
        assert conn.execute(text("PRAGMA journal_mode")).scalar() == "wal"
        assert conn.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_unknown_api_route_is_404(client):
    assert client.get("/api/nope").status_code == 404


def test_serves_built_frontend_with_spa_fallback(tmp_path):
    from fastapi.testclient import TestClient

    from app.core.config import Settings
    from app.main import create_app

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>shell</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    with TestClient(create_app(Settings(data_dir=tmp_path / "data", frontend_dist=dist))) as c:
        assert c.get("/").text == "<html>shell</html>"
        assert c.get("/pantry").text == "<html>shell</html>"  # client-side route
        assert "console.log" in c.get("/assets/app.js").text
        assert c.get("/api/nope").status_code == 404
