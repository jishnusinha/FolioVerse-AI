"""Reusable graph nodes: retrieval, coverage gathering, citation validation."""

from ..anchors import build_anchor
from ..citations import MARKER, has_uncited_factual_claims, validate_occurrences
from ..metering import meter_local
from ..repo import get_repo
from ..retrieval.retrieve import candidates_json, packed_json, retrieve
from ..text import count_tokens
from .runtime import RetrievalUnavailable, RunContext


async def do_retrieve(ctx: RunContext, query: str, page_max: int | None = None) -> dict:
    options = ctx.options if page_max is None else {**ctx.options, "pageMax": page_max}
    try:
        r = await retrieve(query, ctx.scope, options)
    except ConnectionError as e:
        raise RetrievalUnavailable(str(e)) from e
    await meter_local(
        ctx.workspace_id,
        r.compute_seconds,
        r.params.get("embedder", "embedder"),
        "retrieval",
        ctx.run_id,
        ctx.user_id,
    )
    packed = r.packed
    await get_repo().insert_retrieval_event(
        {
            "workspace_id": ctx.workspace_id,
            "run_id": ctx.run_id,
            "query": query[:2000],
            "params": {"mode": "query"} | r.params,
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


async def _quote_page(
    repo, svid: str, first: int | None, loc: dict, quote: str
) -> tuple[int | None, str | None]:
    """Chunks can span pages; anchors use the covered page whose text contains the quote."""
    pages = sorted({b["page"] for b in loc.get("boxes", []) if b.get("page")} | ({first} if first else set()))
    texts: dict[int, str | None] = {}
    for p in pages:
        texts[p] = await repo.page_text(svid, p)
        if quote and texts[p] and quote in texts[p]:
            return p, texts[p]
    return first, texts.get(first) if first else None


async def validate_and_emit(ctx: RunContext, answer: str, packed: list[dict]) -> dict:
    """Validates each cited claim occurrence individually and emits citation.validated with anchors."""
    context = {p["marker"]: p for p in packed}
    occurrences = validate_occurrences(answer, context)
    repo = get_repo()
    out = []
    for occ in occurrences:
        anchor = None
        if occ.item:
            item = occ.item
            loc = item.get("locator") or {}
            page, page_text = await _quote_page(
                repo, item["sourceVersionId"], item.get("page"), loc, occ.quote
            )
            chunk = {"id": item["chunkId"], "page_start": page, "locator": loc}
            anchor = build_anchor(item["sourceVersionId"], chunk, occ.quote, page_text)
        data = {
            "marker": occ.marker,
            "state": occ.state,
            "score": occ.score,
            "quote": occ.quote[:600],
            "claim": occ.claim[:600],
        }
        if anchor:
            data["anchor"] = anchor
        await ctx.emit("citation.validated", data)
        out.append(data)
    has_markers = bool(MARKER.search(answer))
    states = [c["state"] for c in out]
    if not has_markers:
        outcome = "PARTIAL"
    elif "UNRESOLVED" in states or (states and any(s == "WEAK" for s in states)):
        outcome = "PARTIAL"
    elif has_uncited_factual_claims(answer):
        outcome = "PARTIAL"
    else:
        outcome = "ANSWERED"
    return {"citations": out, "outcome": outcome}
