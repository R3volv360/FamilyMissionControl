"""Each test gets a fresh app on a temp data dir (migrated SQLite + empty recipes folder) and a fake S3."""
import os

import boto3
import pytest
from fastapi.testclient import TestClient
from moto import mock_aws

from app.core.config import Settings
from app.main import create_app

REGION = "us-east-2"

# Never let a test reach real AWS.
os.environ.update(AWS_ACCESS_KEY_ID="testing", AWS_SECRET_ACCESS_KEY="testing", AWS_SESSION_TOKEN="testing",
                  AWS_DEFAULT_REGION=REGION)
os.environ.pop("AWS_PROFILE", None)

BUCKET = "test-recipes"


@pytest.fixture(autouse=True)
def s3():
    """Fake S3 with the recipe bucket, active for every test (background uploads included)."""
    with mock_aws():
        client = boto3.client("s3", region_name=REGION)
        client.create_bucket(Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": REGION})
        yield client


@pytest.fixture
def settings(tmp_path) -> Settings:
    # _env_file=None: tests never read the real backend/.env
    return Settings(_env_file=None, data_dir=tmp_path / "data", frontend_dist=tmp_path / "no-dist", aws_profile=None,
                    s3_bucket=BUCKET, aws_region=REGION)


@pytest.fixture
def client(settings) -> TestClient:
    with TestClient(create_app(settings)) as c:  # `with` runs lifespan, so migrations apply
        yield c
