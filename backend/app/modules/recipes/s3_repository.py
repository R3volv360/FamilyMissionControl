"""The S3 recipe store: s3://<bucket>/recipes/<slug>/… plus recipes/index.json (read by the Alexa skill).

The app only touches S3 when the user uploads a recipe or presses Sync; nothing syncs automatically.
"""
import json
import mimetypes

from botocore.exceptions import ClientError

from app.core import aws
from app.core.config import Settings

INDEX = "index.json"


class S3Store:
    def __init__(self, settings: Settings):
        self.s3 = aws.session(settings).client("s3")
        self.bucket = settings.s3_bucket
        self.prefix = settings.s3_prefix  # "recipes/"

    def _key(self, slug: str, name: str = "") -> str:
        return f"{self.prefix}{slug}/{name}"

    def list_slugs(self) -> set[str]:
        slugs: set[str] = set()
        for page in self.s3.get_paginator("list_objects_v2").paginate(
            Bucket=self.bucket, Prefix=self.prefix, Delimiter="/"
        ):
            for cp in page.get("CommonPrefixes", []):
                slugs.add(cp["Prefix"][len(self.prefix):].rstrip("/"))
        return slugs

    def list_files(self, slug: str) -> list[str]:
        names = []
        for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=self._key(slug)):
            names += [o["Key"][len(self._key(slug)):] for o in page.get("Contents", [])]
        return [n for n in names if n and "/" not in n]

    def download(self, slug: str) -> dict[str, bytes]:
        return {
            name: self.s3.get_object(Bucket=self.bucket, Key=self._key(slug, name))["Body"].read()
            for name in self.list_files(slug)
        }

    def upload(self, slug: str, files: dict[str, bytes]) -> None:
        """Make the S3 folder match `files` exactly (stale step photos etc. are removed)."""
        for name, content in files.items():
            ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
            self.s3.put_object(Bucket=self.bucket, Key=self._key(slug, name), Body=content, ContentType=ctype)
        stale = [n for n in self.list_files(slug) if n not in files]
        self._delete_keys([self._key(slug, n) for n in stale])

    def delete(self, slug: str) -> None:
        self._delete_keys([self._key(slug, n) for n in self.list_files(slug)])

    def _delete_keys(self, keys: list[str]) -> None:
        for i in range(0, len(keys), 1000):
            batch = keys[i:i + 1000]
            self.s3.delete_objects(Bucket=self.bucket, Delete={"Objects": [{"Key": k} for k in batch]})

    # ---- index.json (the Alexa skill's recipe list) ----

    def read_index(self) -> list[dict]:
        try:
            body = self.s3.get_object(Bucket=self.bucket, Key=f"{self.prefix}{INDEX}")["Body"].read()
        except ClientError as e:
            if e.response["Error"]["Code"] in ("NoSuchKey", "404", "AccessDenied"):
                return []
            raise
        return json.loads(body)

    def write_index(self, index: list[dict]) -> None:
        index.sort(key=lambda r: r["title"].lower())
        self.s3.put_object(Bucket=self.bucket, Key=f"{self.prefix}{INDEX}",
                           Body=json.dumps(index, indent=2).encode(), ContentType="application/json")
