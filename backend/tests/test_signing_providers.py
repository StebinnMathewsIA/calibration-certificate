import base64
import tempfile
from pathlib import Path

import pytest

from app.config import Settings
from app.signing.keys import EnvPemKeyProvider, LocalPemKeyProvider, provider_from_settings
from scripts.generate_dev_signing_cert import generate


def _keypair_b64() -> tuple[str, str]:
    d = Path(tempfile.mkdtemp(prefix="kp-"))
    generate(d)
    return (
        base64.b64encode((d / "signing-key.pem").read_bytes()).decode(),
        base64.b64encode((d / "signing-cert.pem").read_bytes()).decode(),
    )


def test_env_pem_provider_loads_signer():
    key_b64, cert_b64 = _keypair_b64()
    signer = EnvPemKeyProvider(key_b64, cert_b64).get_signer()
    assert signer.signing_cert is not None


def test_env_pem_provider_rejects_bad_base64():
    with pytest.raises(ValueError):
        EnvPemKeyProvider("not-base64!!", "also-not")


def test_env_material_takes_precedence_in_settings():
    key_b64, cert_b64 = _keypair_b64()
    settings = Settings(
        signing_key_pem_b64=key_b64,
        signing_cert_pem_b64=cert_b64,
        signing_key_provider="local",
        signing_key_dir="/nonexistent",
    )
    assert isinstance(provider_from_settings(settings), EnvPemKeyProvider)


def test_local_provider_autogenerates_when_enabled():
    d = Path(tempfile.mkdtemp(prefix="auto-")) / "keys"
    provider = LocalPemKeyProvider(str(d), auto_generate=True)
    signer = provider.get_signer()
    assert signer.signing_cert is not None
    assert (d / "signing-key.pem").exists()


def test_local_provider_fails_closed_without_autogenerate():
    with pytest.raises(FileNotFoundError):
        LocalPemKeyProvider("/nonexistent-keys").get_signer()
