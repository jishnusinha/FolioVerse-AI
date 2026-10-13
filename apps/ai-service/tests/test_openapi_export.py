"""The committed AI service OpenAPI document (docs API reference source) matches the routes."""

from conftest import CONTRACTS

from folioverse_ai.openapi_export import render


def test_committed_openapi_is_current():
    committed = (CONTRACTS / "openapi" / "ai.json").read_text(encoding="utf-8")
    assert committed == render(), (
        "packages/contracts/openapi/ai.json is stale; run "
        "python -m uv run --directory apps/ai-service python -m folioverse_ai.openapi_export"
    )
