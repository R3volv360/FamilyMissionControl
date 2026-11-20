"""App settings. Override any of these with environment variables prefixed MC_ or a backend/.env file."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MC_", env_file=".env", extra="ignore")

    data_dir: Path = REPO_ROOT / "data"
    frontend_dist: Path = REPO_ROOT / "frontend" / "dist"
    # Where scripts/backup.py writes its zips. Best on another drive or a synced folder (OneDrive, NAS).
    backup_dir: Path = REPO_ROOT / "backups"

    # The recipe bucket. No default: set MC_S3_BUCKET in backend/.env. Until it's set, S3 actions say so.
    s3_bucket: str = ""
    s3_prefix: str = "recipes/"
    aws_profile: str | None = None
    aws_region: str | None = None  # None: the AWS profile's region
    # The server's Roles Anywhere certificate, for the expiry warning (A7). Optional: by default it's read
    # from the AWS profile's credential_process --certificate argument.
    aws_cert_path: Path | None = None

    # Announce the server as http://<local_name>.local:<local_port> on the home network (mDNS). serve.py sets
    # these; unset (as in development and tests), nothing is announced.
    local_name: str | None = None
    local_port: int = 5683

    @property
    def db_path(self) -> Path:
        return self.data_dir / "mission-control.db"

    @property
    def recipes_dir(self) -> Path:
        return self.data_dir / "recipes"


@lru_cache
def get_settings() -> Settings:
    return Settings()
