"""Service-to-service authentication.

The API signs short-lived ES256 tokens. Internal routes require a bearer token with
aud=folioverse-ai, and retrieval filters come only from a separately signed scope token.
"""

from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request, status

from .settings import Settings, get_settings

ISSUER = "folioverse-api"
AUDIENCE = "folioverse-ai"


@dataclass(frozen=True)
class Scope:
    run_id: str
    workspace_id: str
    source_version_ids: tuple[str, ...]


def _decode(token: str, settings: Settings) -> dict:
    if not settings.internal_public_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Internal auth key not configured")
    try:
        return jwt.decode(
            token,
            settings.public_key_pem,
            algorithms=["ES256"],
            audience=AUDIENCE,
            issuer=ISSUER,
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid internal token") from e


def require_internal(request: Request, settings: Settings = Depends(get_settings)) -> dict:
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing internal token")
    claims = _decode(header[7:], settings)
    if claims.get("typ") != "internal":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    return claims


def verify_scope(token: str, run_id: str, workspace_id: str, settings: Settings | None = None) -> Scope:
    settings = settings or get_settings()
    claims = _decode(token, settings)
    if claims.get("typ") != "scope" or claims.get("sub") != run_id or claims.get("wid") != workspace_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Scope token does not match this run")
    svids = claims.get("svids") or []
    if not isinstance(svids, list) or not all(isinstance(s, str) for s in svids):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Malformed scope token")
    return Scope(run_id=run_id, workspace_id=workspace_id, source_version_ids=tuple(svids))
