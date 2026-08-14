"""Create a locally signed Android APK using the JAR (v1) signature scheme."""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import sys
import zipfile
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs7
from cryptography.x509.oid import NameOID


def header(name: str, value: str) -> bytes:
    """Encode and fold a JAR manifest header to the 72-byte line limit."""
    raw = f"{name}: {value}".encode("utf-8")
    lines = []
    first = True
    while raw:
        limit = 70 if first else 69
        cut = min(limit, len(raw))
        while cut and cut < len(raw) and (raw[cut] & 0xC0) == 0x80:
            cut -= 1
        part, raw = raw[:cut], raw[cut:]
        lines.append((b"" if first else b" ") + part + b"\r\n")
        first = False
    return b"".join(lines)


def digest(data: bytes) -> str:
    return base64.b64encode(hashlib.sha256(data).digest()).decode("ascii")


def make_identity(key_path: Path, cert_path: Path):
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "CN"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Qinghe Account"),
        x509.NameAttribute(NameOID.COMMON_NAME, "Qinghe Local Release"),
    ])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder().subject_name(subject).issuer_name(issuer)
        .public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    key_path.parent.mkdir(parents=True, exist_ok=True)
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return key, cert


def sign(source: Path, output: Path, key_path: Path, cert_path: Path):
    key, cert = make_identity(key_path, cert_path)
    entries = []
    with zipfile.ZipFile(source, "r") as zin:
        for info in zin.infolist():
            upper = info.filename.upper()
            if info.is_dir() or (upper.startswith("META-INF/") and upper.endswith((".SF", ".RSA", ".DSA", ".EC"))):
                continue
            entries.append((info, zin.read(info.filename)))

    main = header("Manifest-Version", "1.0") + header("Created-By", "Codex local APK signer") + b"\r\n"
    sections = []
    for info, data in entries:
        section = header("Name", info.filename) + header("SHA-256-Digest", digest(data)) + b"\r\n"
        sections.append((info.filename, section))
    manifest = main + b"".join(section for _, section in sections)

    sf = (
        header("Signature-Version", "1.0")
        + header("Created-By", "Codex local APK signer")
        + header("SHA-256-Digest-Manifest", digest(manifest))
        + b"\r\n"
    )
    for name, section in sections:
        sf += header("Name", name) + header("SHA-256-Digest", digest(section)) + b"\r\n"

    signature = (
        pkcs7.PKCS7SignatureBuilder().set_data(sf)
        .add_signer(cert, key, hashes.SHA256())
        .sign(serialization.Encoding.DER, [pkcs7.PKCS7Options.DetachedSignature, pkcs7.PKCS7Options.Binary])
    )

    with zipfile.ZipFile(output, "w", allowZip64=True) as zout:
        zout.writestr("META-INF/MANIFEST.MF", manifest, compress_type=zipfile.ZIP_DEFLATED)
        zout.writestr("META-INF/QINGHE.SF", sf, compress_type=zipfile.ZIP_DEFLATED)
        zout.writestr("META-INF/QINGHE.RSA", signature, compress_type=zipfile.ZIP_DEFLATED)
        for info, data in entries:
            clone = zipfile.ZipInfo(info.filename, info.date_time)
            clone.compress_type = info.compress_type
            clone.comment = info.comment
            clone.extra = info.extra
            clone.internal_attr = info.internal_attr
            clone.external_attr = info.external_attr
            clone.create_system = info.create_system
            zout.writestr(clone, data)

    with zipfile.ZipFile(output) as check:
        assert check.testzip() is None
        for required in ("META-INF/MANIFEST.MF", "META-INF/QINGHE.SF", "META-INF/QINGHE.RSA", "AndroidManifest.xml", "classes.dex"):
            assert required in check.namelist(), required
    print(output)


if __name__ == "__main__":
    if len(sys.argv) != 5:
        raise SystemExit("usage: sign_apk.py INPUT.apk OUTPUT.apk PRIVATE_KEY.pem CERT.pem")
    sign(*(Path(x) for x in sys.argv[1:]))
