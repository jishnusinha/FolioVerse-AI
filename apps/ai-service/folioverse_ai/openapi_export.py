"""Exports the AI service OpenAPI document to packages/contracts/openapi/ai.json.

Run with ``python -m uv run --directory apps/ai-service python -m folioverse_ai.openapi_export``.
Builds the app with ROLE=all so both routers appear; no database, Qdrant or provider is contacted.
"""

import json
import os
from pathlib import Path

OUT = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "openapi" / "ai.json"


def document() -> dict:
    from .settings import get_settings

    os.environ["ROLE"] = "all"
    os.environ.pop("OTEL_EXPORTER_OTLP_ENDPOINT", None)
    get_settings.cache_clear()
    from .main import create_app

    return create_app().openapi()


def render() -> str:
    return json.dumps(document(), indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = render()
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(OUT.parents[3]).as_posix()} ({len(json.loads(text)['paths'])} paths)")


if __name__ == "__main__":
    main()
