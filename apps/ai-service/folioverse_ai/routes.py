"""Internal HTTP routes. Every /internal route requires the API's ES256 service token."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import recommend
from .auth import require_internal, verify_scope
from .events import Emitter, ndjson_stream
from .graphs.checkpoints import list_checkpoints
from .graphs.registry import GRAPHS, describe
from .graphs.runner import run_unit
from .ingestion.pipeline import run_ingestion
from .metering import meter_local
from .providers import available_providers
from .repo import get_repo
from .retrieval.retrieve import retrieve
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


class SearchRequest(BaseModel):
    searchId: str
    workspaceId: str
    query: str = Field(min_length=1, max_length=500)
    scopeToken: str
    topK: int = Field(default=8, ge=1, le=20)


@run_router.post("/search")
async def search(req: SearchRequest):
    """Semantic passage search for the workspace search page. No model call; only local compute is metered."""
    scope = verify_scope(req.scopeToken, req.searchId, req.workspaceId)
    if not scope.source_version_ids:
        return {"items": [], "abstain": True}
    r = await retrieve(req.query, scope, {"topK": req.topK, "contextBudget": 4000})
    await meter_local(req.workspaceId, r.compute_seconds, r.params.get("embedder", "embedder"), "search")
    items = [
        {
            "chunkId": p["chunkId"],
            "sourceVersionId": p["sourceVersionId"],
            "page": p.get("page"),
            "headingPath": (p.get("locator") or {}).get("headingPath") or [],
            "snippet": p["childText"][:320],
            "score": p["score"],
        }
        for p in r.packed
    ]
    return {"items": items, "abstain": r.abstain, "latencyMs": r.latency_ms}


class RecommendRequest(BaseModel):
    requestId: str
    workspaceId: str
    profile: dict = Field(default_factory=dict)
    request: dict = Field(default_factory=dict)


class SimilarRequest(BaseModel):
    itemId: str
    k: int = Field(default=6, ge=1, le=20)
    otherKind: bool = False


class EvaluateRequest(BaseModel):
    k: int = Field(default=10, ge=1, le=50)
    maxUsers: int | None = Field(default=None, ge=1)


def _rec_unavailable(e: Exception) -> HTTPException:
    return HTTPException(503, f"Recommendation model unavailable: {e}")


@run_router.post("/recommendations")
async def recommendations(req: RecommendRequest):
    """Ranks the catalog for one profile. Pure scoring (no language model), so nothing is billed."""
    try:
        return await recommend.recommend(req.profile, req.request)
    except FileNotFoundError as e:
        raise _rec_unavailable(e) from e


@run_router.post("/recommendations/similar")
async def recommendations_similar(req: SimilarRequest):
    try:
        return {"items": await recommend.similar(req.itemId, req.k, req.otherKind)}
    except FileNotFoundError as e:
        raise _rec_unavailable(e) from e


@run_router.get("/recommendations/model")
async def recommendations_model():
    try:
        return recommend.manifest()
    except FileNotFoundError as e:
        raise _rec_unavailable(e) from e


@run_router.post("/recommendations/evaluate")
async def recommendations_evaluate(req: EvaluateRequest):
    try:
        return await recommend.offline_evaluation(req.k, req.maxUsers)
    except FileNotFoundError as e:
        raise _rec_unavailable(e) from e


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
