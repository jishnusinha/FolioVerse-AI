import os
import sys
import time
from pathlib import Path

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

_key = ec.generate_private_key(ec.SECP256R1())
PRIVATE_PEM = _key.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
).decode()
PUBLIC_PEM = (
    _key.public_key()
    .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    .decode()
)

# Hermetic test environment: in-memory Qdrant/repo/checkpointer, hash embedder, mock provider only.
os.environ.update(
    {
        "FV_INTERNAL_JWT_PUBLIC_KEY": PUBLIC_PEM,
        "QDRANT_URL": ":memory:",
        "FV_EMBEDDER": "hash",
        "FV_CHECKPOINTER": "memory",
        "FV_MOCK_TOKEN_DELAY_MS": "0",
        "ROLE": "all",
    }
)
for var in ("DATABASE_URL", "OPENAI_API_KEY", "FV_OLLAMA_URL", "OTEL_EXPORTER_OTLP_ENDPOINT"):
    os.environ.pop(var, None)

ROOT = Path(__file__).resolve().parents[3]
CONTRACTS = ROOT / "packages" / "contracts"
sys.path.insert(0, str(Path(__file__).parent))

from folioverse_ai.graphs.checkpoints import reset_checkpointer  # noqa: E402
from folioverse_ai.repo import MemoryRepo, set_repo  # noqa: E402
from folioverse_ai.retrieval.embedder import get_embedder, get_reranker  # noqa: E402
from folioverse_ai.retrieval.store import get_store  # noqa: E402
from folioverse_ai.settings import get_settings  # noqa: E402


def sign(claims: dict, ttl: int = 120) -> str:
    now = int(time.time())
    return jwt.encode(
        {"iss": "folioverse-api", "aud": "folioverse-ai", "iat": now, "exp": now + ttl, **claims},
        PRIVATE_PEM,
        algorithm="ES256",
    )


def internal_token() -> str:
    return sign({"sub": "api-worker", "typ": "internal"})


def scope_token(run_id: str, workspace_id: str, svids: list[str]) -> str:
    return sign({"sub": run_id, "typ": "scope", "wid": workspace_id, "svids": svids})


MOCK_PLAN = {
    "primary": {"modelConfigId": "mock-grounded", "provider": "mock", "model": "folioverse-mock-1"},
    "fallbacks": [],
    "maxOutputTokens": 800,
    "temperature": 0.2,
    "isDemo": True,
}


@pytest.fixture(autouse=True)
def fresh_state():
    get_settings.cache_clear()
    get_store.cache_clear()
    get_embedder.cache_clear()
    get_reranker.cache_clear()
    reset_checkpointer()
    repo = MemoryRepo()
    set_repo(repo)
    yield repo
    set_repo(None)


@pytest.fixture
def repo(fresh_state) -> MemoryRepo:
    return fresh_state
