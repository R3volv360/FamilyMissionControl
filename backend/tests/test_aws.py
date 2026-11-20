"""AWS Access Spec A6 (connection check) and A7 (certificate expiry warning)."""
from datetime import UTC, datetime, timedelta

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.core import aws
from app.core.config import Settings
from tests.conftest import BUCKET


def make_cert(path, days_valid: int, cn="test-server1"):
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(x509.NameOID.COMMON_NAME, cn)])
    now = datetime.now(UTC)
    cert = (
        x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=400)).not_valid_after(now + timedelta(days=days_valid, hours=1))
        .sign(key, hashes.SHA256())
    )
    path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return path


# ---- A6 ------------------------------------------------------------------------------------------------

def test_connected(client):
    st = client.get("/api/recipes/aws-status").json()
    assert st["ok"] is True
    assert st["message"].startswith(f"Connected to S3 ({BUCKET}) as ")
    assert st["identity"]


def test_missing_bucket(settings):
    settings.s3_bucket = "no-such-bucket"
    st = aws.check(settings)
    assert not st.ok and "doesn't exist" in st.message


def test_bucket_not_set(settings, client):
    settings.s3_bucket = ""
    st = aws.check(settings)
    assert not st.ok and "Set MC_S3_BUCKET" in st.message
    # S3 actions say the same instead of failing obscurely
    r = client.get("/api/recipes/sync")
    assert r.status_code == 502 and "MC_S3_BUCKET" in r.json()["detail"]


def test_unknown_profile(settings):
    settings.aws_profile = "no-such-profile"
    st = aws.check(settings)
    assert not st.ok and 'The AWS profile "no-such-profile" isn\'t set up' in st.message


def test_no_credentials(settings, monkeypatch, tmp_path):
    for var in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "none"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "none"))
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")
    st = aws.check(settings)
    assert not st.ok and "No AWS credentials" in st.message


def test_access_denied_is_explained():
    from botocore.exceptions import ClientError

    e = ClientError({"Error": {"Code": "AccessDenied"}}, "ListObjectsV2")
    assert "not allowed to list the bucket" in aws._client_error(e, "list the bucket")


def test_identity_is_shortened():
    arn = "arn:aws:sts::123456789012:assumed-role/recipes-role/abc123"
    assert aws._identity(arn) == "recipes-role/abc123"


# ---- A7 ------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("days,warns,word", [(200, False, None), (31, False, None), (30, True, "expires in 30 days"),
                                             (1, True, "expires in 1 day,"), (-3, True, "expired on")])
def test_certificate_warning(tmp_path, days, warns, word):
    info = aws.certificate_info(make_cert(tmp_path / "server.crt", days))
    assert info.subject == "test-server1"
    warning = aws.certificate_warning(info)
    assert bool(warning) is warns
    if word:
        assert word in warning


def test_cert_path_setting_wins(tmp_path):
    s = Settings(data_dir=tmp_path, aws_cert_path=tmp_path / "x.crt")
    assert aws.certificate_path(s) == tmp_path / "x.crt"


def test_cert_path_read_from_profile(tmp_path, monkeypatch):
    cert = make_cert(tmp_path / "server1.crt", 10)
    config = tmp_path / "config"
    config.write_text(
        "[profile recipe-sync]\nregion = us-east-2\n"
        f'credential_process = aws_signing_helper credential-process --certificate "{cert}" '
        f"--private-key {tmp_path / 'server.key'} --trust-anchor-arn arn:x --profile-arn arn:y --role-arn arn:z\n"
    )
    monkeypatch.setenv("AWS_CONFIG_FILE", str(config))
    s = Settings(data_dir=tmp_path, aws_profile="recipe-sync")
    assert aws.certificate_path(s) == cert


def test_status_reports_expiring_cert_even_when_connected(settings, tmp_path):
    settings.aws_cert_path = make_cert(tmp_path / "server.crt", 12)
    st = aws.check(settings)
    assert st.ok and st.cert.days_left == 12 and "expires in 12 days" in st.cert_warning


def test_status_reports_missing_cert_file(settings, tmp_path):
    settings.aws_cert_path = tmp_path / "gone.crt"
    st = aws.check(settings)
    assert "can't be found" in st.cert_warning


@pytest.mark.skipif(not hasattr(__import__("subprocess"), "CREATE_NO_WINDOW"), reason="Windows only")
def test_signing_helper_starts_without_a_window(settings):
    """The windowless server (pythonw) must not flash a console each time the signing helper runs."""
    import subprocess

    s = aws.session(settings)
    popen = s._session.get_component("credential_provider").get_provider("custom-process")._popen
    assert popen.keywords["creationflags"] == subprocess.CREATE_NO_WINDOW
