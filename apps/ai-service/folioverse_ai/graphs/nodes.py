"""Reusable graph nodes: retrieval, coverage gathering, citation validation."""

from ..anchors import build_anchor
from ..citations import MARKER, validate
from ..repo import get_repo
from ..retrieval.retrieve import candidates_json, packed_json, retrieve
from ..text import count_tokens
from .runtime import RetrievalUnavailable, RunContext


async def do_retrieve(ctx: RunContext, query: str, page_max: int | None = None) -> dict:
    try:
        r = await retrieve(query, ctx.scope, ctx.options)
    except ConnectionError as e:
        raise RetrievalUnavailable(str(e)) from e
    packed = r.packed
    if page_max is not None:
        packed = [p for p in packed if not p.get("page") or p["page"] <= page_max]
        for i, p in enumerate(packed, start=1):
            p["marker"] = f"S{i}"
    await get_repo().insert_retrieval_event(
        {
            "workspace_id": ctx.workspace_id,
            "run_id": ctx.run_id,
            "query": query[:2000],
            "params": r.params | {"mode": "query", "pageMax": page_max},
            "candidates": candidates_json(r),
            "packed": packed_json(r),
            "latency_ms": r.latency_ms,
        }
    )
    await ctx.emit(
        "retrieval.completed",
        {
            "candidates": len(r.candidates),
            "packed": len(packed),
            "topScore": r.top_dense,
            "contextTokens": r.context_tokens,
            "abstain": r.abstain or not packed,
            "sources": [
                {
                    "marker": p["marker"],
                    "chunkId": p["chunkId"],
                    "sourceVersionId": p["sourceVersionId"],
                    "title": p.get("title"),
                    "page": p.get("page"),
                    "score": p["score"],
                }
                for p in packed
            ],
        },
    )
    return {"packed": packed, "abstain": r.abstain or not packed, "topScore": r.top_dense}


async def gather_coverage(ctx: RunContext, budget: int = 6000, per_version_cap: int | None = None) -> dict:
    """Whole-document context (parent chunks in reading order) across the scoped versions."""
    repo = get_repo()
    svids = list(ctx.scope.source_version_ids)
    if not svids:
        return {"packed": [], "abstain": True, "topScore": 0.0}
    share = per_version_cap or max(800, budget // len(svids))
    packed: list[dict] = []
    used = 0
    for svid in svids:
        taken = 0
        rows = await repo.version_chunks(svid, "PARENT", 200)
        for row in rows:
            t = row["token_count"]
            if taken + t > share or used + t > budget:
                break
            taken += t
            used += t
            packed.append(
                {
                    "marker": f"S{len(packed) + 1}",
                    "chunkId": row["id"],
                    "parentId": None,
                    "sourceVersionId": svid,
                    "title": None,
                    "page": row.get("page_start"),
                    "level": "PARENT",
                    "text": row["text"],
                    "childText": row["text"],
                    "locator": row.get("locator"),
                    "score": 1.0,
                }
            )
    await repo.insert_retrieval_event(
        {
            "workspace_id": ctx.workspace_id,
            "run_id": ctx.run_id,
            "query": f"<coverage:{ctx.graph}>",
            "params": {"mode": "coverage", "budget": budget, "versions": len(svids)},
            "candidates": [],
            "packed": [
                {k: v for k, v in p.items() if k not in ("text", "childText")}
                | {"tokens": count_tokens(p["text"])}
                for p in packed
            ],
            "latency_ms": 0.0,
        }
    )
    await ctx.emit(
        "retrieval.completed",
        {
            "candidates": len(packed),
            "packed": len(packed),
            "contextTokens": used,
            "mode": "coverage",
            "sources": [
                {
                    "marker": p["marker"],
                    "chunkId": p["chunkId"],
                    "sourceVersionId": p["sourceVersionId"],
                    "page": p.get("page"),
                }
                for p in packed
            ],
        },
    )
    return {"packed": packed, "abstain": not packed, "topScore": 1.0}


async def validate_and_emit(ctx: RunContext, answer: str, packed: list[dict]) -> dict:
    """Validates [S#] markers deterministically and emits citation.validated with anchors."""
    context = {p["marker"]: p for p in packed}
    results = validate(answer, context)
    repo = get_repo()
    out = []
    for marker, res in results.items():
        anchor = None
        if res.item:
            item = res.item
            chunk = {
                "id": item["chunkId"],
                "page_start": item.get("page"),
                "locator": item.get("locator") or {},
            }
            page_text = (
                await repo.page_text(item["sourceVersionId"], item["page"]) if item.get("page") else None
            )
            anchor = build_anchor(item["sourceVersionId"], chunk, res.quote, page_text)
        data = {"marker": marker, "state": res.state, "score": res.score, "quote": res.quote[:600]}
        if anchor:
            data["anchor"] = anchor
        await ctx.emit("citation.validated", data)
        out.append(data)
    has_markers = bool(MARKER.search(answer))
    states = [c["state"] for c in out]
    if not has_markers:
        outcome = "PARTIAL"
    elif "UNRESOLVED" in states or (states and all(s == "WEAK" for s in states)):
        outcome = "PARTIAL"
    else:
        outcome = "ANSWERED"
    return {"citations": out, "outcome": outcome}
