"""FastAPI entrypoint. ROLE=api serves runs, ROLE=ingest serves ingestion, ROLE=all serves both (dev)."""

import asyncio
import logging

import structlog
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .repo import get_repo
from .retrieval.store import get_store
from .routes import ingest_router, run_router
from .settings import get_settings


def configure_logging(level: str) -> None:
    logging.basicConfig(level=level.upper(), format="%(message)s")
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level.upper())),
    )


def create_app() -> FastAPI:
    s = get_settings()
    configure_logging(s.log_level)
    app = FastAPI(
        title="FolioVerse AI service",
        version="0.1.0",
        docs_url=None if s.env == "production" else "/docs",
        redoc_url=None,
    )
    if s.role in ("api", "all"):
        app.include_router(run_router)
    if s.role in ("ingest", "all"):
        app.include_router(ingest_router)

    @app.get("/healthz")
    async def healthz():
        return {"status": "ok", "role": s.role}

    async def probe(fn, timeout: float = 3.0) -> bool:
        try:
            return bool(await asyncio.wait_for(fn(), timeout))
        except Exception:
            return False

    @app.get("/readyz")
    async def readyz():
        checks = {
            "postgres": await probe(get_repo().ping),
            "qdrant": await probe(lambda: asyncio.to_thread(get_store().ping)),
            "internalKey": bool(s.internal_public_key),
        }
        ok = all(checks.values())
        return JSONResponse(
            {"status": "ready" if ok else "degraded", "checks": checks}, status_code=200 if ok else 503
        )

    if s.otel_endpoint:
        from .telemetry import instrument

        instrument(app, s)
    return app


app = create_app()
