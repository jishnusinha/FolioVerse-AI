"""Internal HTTP routes. Every /internal route requires the API's ES256 service token."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .auth import require_internal
from .events import Emitter, ndjson_stream
from .graphs.checkpoints import list_checkpoints
from .graphs.registry import GRAPHS, describe
from .graphs.runner import run_unit
from .ingestion.pipeline import run_ingestion
from .providers import available_providers
from .repo import get_repo
from .retrieval.store import get_store

NDJSON = "application/x-ndjson"

run_router = APIRouter(prefix="/internal", dependencies=[Depends(require_internal)])
ingest_router = APIRouter(prefix="/internal", dependencies=[Depends(require_internal)])


class RunUnit(BaseModel):
    runId: str
    workspaceId: str
    graph: str
    input: dict = Field(default_factory=dict)
    history: list[dict] = Field(default_factory=list)
    modelPlan: dict
    scopeToken: str
    options: dict = Field(default_factory=dict)
    resumeFromCheckpoint: str | None = None
    parentRunId: str | None = None
    userId: str | None = None


class IngestUnit(BaseModel):
    jobId: str
    workspaceId: str
    projectId: str | None = None
    sourceId: str
    sourceVersionId: str
    title: str | None = None
    mimeType: str
    objectUrl: str
    sha256: str | None = None


class PurgeRequest(BaseModel):
    workspaceId: str
    sourceVersionIds: list[str]


@run_router.post("/runs/units")
async def run_units(unit: RunUnit):
    emitter = Emitter(unit.runId, unit.workspaceId)
    return StreamingResponse(
        ndjson_stream(emitter, lambda: run_unit(unit.model_dump(), emitter)), media_type=NDJSON
    )


@run_router.get("/providers")
async def providers():
    return {"available": available_providers()}


@run_router.get("/graphs/{name}")
async def graph(name: str):
    if name not in GRAPHS:
        raise HTTPException(404, "Unknown graph")
    return describe(name)


@run_router.get("/runs/{run_id}/checkpoints")
async def checkpoints(run_id: str):
    return {"runId": run_id, "checkpoints": await list_checkpoints(run_id)}


@ingest_router.post("/ingest/units")
async def ingest_units(unit: IngestUnit):
    emitter = Emitter(None, unit.workspaceId)

    async def work():
        await run_ingestion(unit.model_dump(), emitter)

    return StreamingResponse(ndjson_stream(emitter, work), media_type=NDJSON)


@ingest_router.post("/index/purge")
async def purge(req: PurgeRequest):
    store = get_store()
    store.delete_versions(req.workspaceId, req.sourceVersionIds)
    await get_repo().delete_versions(req.sourceVersionIds)
    return {"purged": len(req.sourceVersionIds)}
