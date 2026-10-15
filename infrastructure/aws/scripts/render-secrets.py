#!/usr/bin/env python3
"""Render the FolioVerse Secrets Manager JSON (read from stdin) into root-only Docker Compose env files.

    aws secretsmanager get-secret-value ... --query SecretString --output text \
      | python3 render-secrets.py --out-dir /etc/folioverse/secrets [--mail-enabled true]

Writes app.env (application containers), postgres.env and redis.env, each mode 0600, atomically.
Only key names are ever printed. Values are written single-quoted, which Compose reads literally
(no ${...} interpolation, so "$" is safe); PEM newlines become the two characters "\\n", which the
API and the AI service turn back into newlines. Values that cannot be represented that way are rejected.
"""

import argparse
import json
import os
import re
import sys
import tempfile
from urllib.parse import quote

REQUIRED = [
    "POSTGRES_PASSWORD",
    "REDIS_PASSWORD",
    "FV_JWT_SECRET",
    "FV_INTERNAL_JWT_PRIVATE_KEY",
    "FV_INTERNAL_JWT_PUBLIC_KEY",
]
OPTIONAL = [
    "OPENAI_API_KEY",
    "FV_OPENAI_MODEL",
    "FV_OPENAI_FALLBACK_MODEL",
    "OPENAI_ADMIN_KEY",
    "SMTP_URL",
    "GOOGLE_BOOKS_API_KEY",
]
PASSWORD_RE = re.compile(r"^[A-Za-z0-9._~-]{24,}$")
KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")


class SecretError(Exception):
    pass


def encode(key: str, value: str) -> str:
    """One `KEY='value'` line, or SecretError naming the key (never the value)."""
    v = value.replace("\r\n", "\n").strip("\n").replace("\n", "\\n") if "-----BEGIN " in value else value
    if "'" in v:
        raise SecretError(f"{key} contains a single quote, which cannot be passed safely; URL-encode it or choose another value")
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in v):
        raise SecretError(f"{key} contains a control character or a newline outside a PEM block")
    return f"{key}='{v}'"


def render(raw: str, mail_enabled: bool) -> dict[str, list[str]]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise SecretError(f"secret is not valid JSON (line {e.lineno}, column {e.colno})") from None
    if not isinstance(data, dict):
        raise SecretError("secret must be a JSON object of KEY: string pairs")
    data = {k: v for k, v in data.items() if not k.startswith("_")}

    unknown = sorted(k for k in data if k not in REQUIRED and k not in OPTIONAL)
    if unknown:
        raise SecretError(f"unknown key(s): {', '.join(unknown)} (allowed: {', '.join(REQUIRED + OPTIONAL)})")
    bad_type = sorted(k for k, v in data.items() if not isinstance(v, str))
    if bad_type:
        raise SecretError(f"value must be a string: {', '.join(bad_type)}")
    present = {k: v for k, v in data.items() if v.strip()}
    missing = [k for k in REQUIRED if k not in present]
    if missing:
        raise SecretError(f"missing required key(s): {', '.join(missing)} (run scripts/init-secrets.sh)")

    for k in ("POSTGRES_PASSWORD", "REDIS_PASSWORD"):
        if not PASSWORD_RE.match(present[k]):
            raise SecretError(f"{k} must be at least 24 characters of A-Z a-z 0-9 . _ ~ -")
    if len(present["FV_JWT_SECRET"]) < 32:
        raise SecretError("FV_JWT_SECRET must be at least 32 characters")
    pem_private = present["FV_INTERNAL_JWT_PRIVATE_KEY"].replace("\\n", "\n")
    pem_public = present["FV_INTERNAL_JWT_PUBLIC_KEY"].replace("\\n", "\n")
    if "-----BEGIN PRIVATE KEY-----" not in pem_private:
        raise SecretError("FV_INTERNAL_JWT_PRIVATE_KEY must be a PKCS#8 PEM (BEGIN PRIVATE KEY)")
    if "-----BEGIN PUBLIC KEY-----" not in pem_public:
        raise SecretError("FV_INTERNAL_JWT_PUBLIC_KEY must be an SPKI PEM (BEGIN PUBLIC KEY)")
    if "OPENAI_API_KEY" in present and "FV_OPENAI_MODEL" not in present:
        raise SecretError("OPENAI_API_KEY is set but FV_OPENAI_MODEL is not (no model id is assumed)")
    if mail_enabled and "SMTP_URL" not in present:
        raise SecretError("FV_MAIL_ENABLED=true requires SMTP_URL in the secret")

    pg = quote(present["POSTGRES_PASSWORD"], safe="")
    rd = quote(present["REDIS_PASSWORD"], safe="")
    app = {
        "DATABASE_URL": f"postgresql://folioverse:{pg}@postgres:5432/folioverse?schema=app",
        "REDIS_URL": f"redis://:{rd}@redis:6379",
        "FV_JWT_SECRET": present["FV_JWT_SECRET"],
        "FV_INTERNAL_JWT_PRIVATE_KEY": pem_private,
        "FV_INTERNAL_JWT_PUBLIC_KEY": pem_public,
    }
    for k in OPTIONAL:
        if k in present:
            app[k] = present[k]
    return {
        "app.env": [encode(k, v) for k, v in app.items()],
        "postgres.env": [encode("POSTGRES_PASSWORD", present["POSTGRES_PASSWORD"])],
        "redis.env": [encode("REDIS_PASSWORD", present["REDIS_PASSWORD"])],
    }


def write_atomic(path: str, lines: list[str]) -> None:
    directory = os.path.dirname(path)
    # mkstemp creates the file with mode 0600.
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".tmp-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write("# Rendered from AWS Secrets Manager by load-secrets.sh. Do not edit; do not copy.\n")
            f.write("\n".join(lines) + "\n")
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--out-dir", required=True)
    p.add_argument("--mail-enabled", default="false")
    args = p.parse_args()
    try:
        files = render(sys.stdin.read(), args.mail_enabled.lower() in ("1", "true"))
    except SecretError as e:
        print(f"render-secrets: {e}", file=sys.stderr)
        return 1
    os.makedirs(args.out_dir, mode=0o700, exist_ok=True)
    for name, lines in files.items():
        write_atomic(os.path.join(args.out_dir, name), lines)
    keys = [line.split("=", 1)[0] for line in files["app.env"]]
    print(f"render-secrets: wrote app.env ({', '.join(keys)}), postgres.env, redis.env")
    return 0


if __name__ == "__main__":
    sys.exit(main())
