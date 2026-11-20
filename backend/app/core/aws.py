"""The app's AWS identity (AWS Access Spec A1–A7): one place that builds the boto3 session, and a plain-English
connection check (A6) with a certificate-expiry warning (A7).

On a server the session uses the profile named by MC_AWS_PROFILE, whose credential_process swaps
the server's certificate for 1-hour credentials via IAM Roles Anywhere. The certificate is found from
MC_AWS_CERT_PATH, or else from the profile's `--certificate` argument.
"""
import functools
import re
import shlex
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import boto3
from botocore.exceptions import (
    BotoCoreError, ClientError, CredentialRetrievalError, EndpointConnectionError, NoCredentialsError,
    ProfileNotFound,
)
from cryptography import x509

from app.core.config import Settings

CERT_WARN_DAYS = 30


def session(settings: Settings) -> boto3.Session:
    s = boto3.Session(profile_name=settings.aws_profile or None, region_name=settings.aws_region)
    _hide_helper_window(s)
    return s


def _hide_helper_window(s: boto3.Session) -> None:
    """The signing helper (credential_process) is a console program. Started from the windowless server
    (pythonw), Windows would flash a console window each time it fetches credentials, so start it hidden."""
    flag = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # Windows only
    if not flag:
        return
    try:
        provider = s._session.get_component("credential_provider").get_provider("custom-process")
        provider._popen = functools.partial(subprocess.Popen, creationflags=flag)
    except Exception:  # botocore internals changed: the window just flashes, credentials still work
        pass


# ---- certificate (A7) ----------------------------------------------------------------------------------


@dataclass
class CertInfo:
    path: str
    subject: str  # e.g. "server1"
    expires: datetime
    days_left: int


def certificate_path(settings: Settings) -> Path | None:
    """MC_AWS_CERT_PATH, or the --certificate argument of the profile's credential_process."""
    if settings.aws_cert_path:
        return settings.aws_cert_path
    try:
        process = session(settings)._session.get_scoped_config().get("credential_process", "")
    except (ProfileNotFound, BotoCoreError):
        return None
    try:
        args = shlex.split(process, posix=False)
    except ValueError:
        args = process.split()
    for i, arg in enumerate(args[:-1]):
        if arg in ("--certificate", "-certificate"):
            return Path(args[i + 1].strip('"\''))
    if m := re.search(r"--certificate[= ](\S+)", process):
        return Path(m[1].strip('"\''))
    return None


def certificate_info(path: Path, now: datetime | None = None) -> CertInfo:
    data = path.read_bytes()
    cert = x509.load_pem_x509_certificate(data) if b"-----BEGIN" in data else x509.load_der_x509_certificate(data)
    expires = cert.not_valid_after_utc
    cn = cert.subject.get_attributes_for_oid(x509.NameOID.COMMON_NAME)
    now = now or datetime.now(UTC)
    return CertInfo(str(path), str(cn[0].value) if cn else cert.subject.rfc4514_string(), expires,
                    (expires - now).days)


def certificate_warning(info: CertInfo) -> str | None:
    date = info.expires.strftime("%d %b %Y").lstrip("0")  # "5 Mar 2027" (no %-d: it fails on Windows)
    if info.days_left < 0:
        return (f"The server's certificate ({info.subject}) expired on {date}. Issue a new one: see the README, "
                "'Moving the server', step 2.")
    if info.days_left <= CERT_WARN_DAYS:
        days = "today" if info.days_left == 0 else f"in {info.days_left} day{'s' if info.days_left != 1 else ''}"
        return (f"The server's certificate ({info.subject}) expires {days}, on {date}. Issue a new one before then: "
                "see the README, 'Moving the server', step 2.")
    return None


# ---- connection check (A6) -----------------------------------------------------------------------------


@dataclass
class AwsStatus:
    ok: bool
    message: str
    profile: str | None
    identity: str | None = None  # e.g. "recipes-role/server1"
    cert: CertInfo | None = None
    cert_warning: str | None = None


def _identity(arn: str) -> str:
    """arn:aws:sts::123:assumed-role/recipes-role/session -> recipes-role/session"""
    return arn.split(":", 5)[-1].removeprefix("assumed-role/").removeprefix("user/")


def _client_error(e: ClientError, doing: str) -> str:
    code = e.response.get("Error", {}).get("Code", "")
    if code in ("AccessDenied", "AccessDeniedException", "403"):
        return f"Signed in to AWS, but not allowed to {doing}. Check the role's policy (AWS Access Spec, A2)."
    if code == "NoSuchBucket":
        return f"The bucket doesn't exist ({doing})."
    if code in ("ExpiredToken", "ExpiredTokenException", "RequestExpired"):
        return "AWS says the credentials have expired. Check the server's clock and certificate."
    if code in ("InvalidClientTokenId", "SignatureDoesNotMatch", "UnrecognizedClientException"):
        return "AWS doesn't recognise these credentials. Check the AWS profile on this server."
    return f"AWS refused to {doing}: {code or e}"


def check(settings: Settings) -> AwsStatus:
    """Can the app reach the recipe bucket? Uses STS GetCallerIdentity plus a one-item list (both free)."""
    profile = settings.aws_profile or None
    status = AwsStatus(ok=False, message="", profile=profile)
    if not settings.s3_bucket:
        status.message = 'No S3 bucket is set. Set MC_S3_BUCKET in backend\\.env (see the README, "Configuration").'
        return status

    try:
        if path := certificate_path(settings):
            status.cert = certificate_info(path)
            status.cert_warning = certificate_warning(status.cert)
    except FileNotFoundError:
        status.cert_warning = f"The certificate file {path} can't be found."
    except (ValueError, OSError) as e:
        status.cert_warning = f"The certificate file {path} can't be read: {e}"

    try:
        sess = session(settings)
        arn = sess.client("sts").get_caller_identity()["Arn"]
        status.identity = _identity(arn)
    except ProfileNotFound:
        status.message = f'The AWS profile "{profile}" isn\'t set up on this server. See the README, "AWS access".'
        return status
    except NoCredentialsError:
        status.message = ("No AWS credentials on this server. Set MC_AWS_PROFILE in backend\\.env "
                          "(see the README, \"AWS access\").")
        return status
    except CredentialRetrievalError as e:
        expired = status.cert is not None and status.cert.days_left < 0
        status.message = ("Couldn't get AWS credentials because the certificate has expired." if expired else
                          f"Couldn't get AWS credentials from the certificate helper: {e}")
        return status
    except EndpointConnectionError:
        status.message = "Couldn't reach AWS. Is the internet connection working?"
        return status
    except ClientError as e:
        status.message = _client_error(e, "check who the app is signed in as")
        return status
    except BotoCoreError as e:
        status.message = f"Couldn't sign in to AWS: {e}"
        return status

    try:
        sess.client("s3").list_objects_v2(Bucket=settings.s3_bucket, Prefix=settings.s3_prefix, MaxKeys=1)
    except ClientError as e:
        status.message = _client_error(e, f"list the {settings.s3_bucket} bucket")
        return status
    except EndpointConnectionError:
        status.message = "Couldn't reach S3. Is the internet connection working?"
        return status
    except BotoCoreError as e:
        status.message = f"Couldn't reach S3: {e}"
        return status

    status.ok = True
    status.message = f"Connected to S3 ({settings.s3_bucket}) as {status.identity}."
    return status
