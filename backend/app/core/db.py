"""SQLite engine, session factory and the declarative Base every module's models.py builds on."""
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import Engine, MetaData, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

# Stable constraint names so Alembic migrations (batch mode on SQLite) can find them later.
NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


def make_engine(db_path: Path) -> Engine:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{db_path.as_posix()}", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    return engine


class Database:
    """Holds the engine and session factory for one database file (the app's, or a test's temp file)."""

    def __init__(self, db_path: Path):
        self.path = db_path
        self.engine = make_engine(db_path)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    def session(self) -> Iterator[Session]:
        with self.sessions() as s:
            yield s
