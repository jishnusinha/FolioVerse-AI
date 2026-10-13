"""Hybrid retrieval: dense + BM25 sparse -> reciprocal rank fusion -> optional rerank -> budget packing.

All vector filters come from the verified scope (workspace + allowed source versions).
Per-candidate ranks are kept so Studio's RAG X-Ray can show why each passage was chosen.
"""

import asyncio
import time
from dataclasses import dataclass, field

from ..auth import Scope
from ..repo import get_repo
from ..settings import get_settings
from ..text import containment, count_tokens
from .embedder import get_embedder, get_reranker
from .store import VectorStore, get_store

RRF_K = 60


@dataclass
class Candidate:
    chunk_id: str
    parent_id: str | None
    source_version_id: str
    title: str | None
    page: int | None
    dense_rank: int | None = None
    sparse_rank: int | None = None
    dense_score: float = 0.0
    sparse_score: float = 0.0
    fused: float = 0.0
    rerank: float | None = None
    lexical: float = 0.0
    fused_rank: int | None = None
    note: str = "below-top-k"


@dataclass
class Retrieval:
    query: str
    candidates: list[Candidate]
    packed: list[dict]
    abstain: bool
    top_dense: float
    context_tokens: int
    latency_ms: float
    params: dict = field(default_factory=dict)

    def context(self) -> dict[str, dict]:
        return {p["marker"]: p for p in self.packed}


def rrf(dense: list, sparse: list, k: int = RRF_K) -> dict[str, Candidate]:
    out: dict[str, Candidate] = {}
    for kind, hits in (("dense", dense), ("sparse", sparse)):
        for rank, h in enumerate(hits, start=1):
            p = h.payload or {}
            cid = p.get("chunk_id") or str(h.id)
            c = out.get(cid) or Candidate(
                cid, p.get("parent_id"), p["source_version_id"], p.get("title"), p.get("page")
            )
            if kind == "dense":
                c.dense_rank, c.dense_score = rank, float(h.score)
            else:
                c.sparse_rank, c.sparse_score = rank, float(h.score)
            c.fused += 1.0 / (k + rank)
            out[cid] = c
    return out


async def retrieve(query: str, scope: Scope, options: dict | None = None) -> Retrieval:
    options = options or {}
    s = get_settings()
    started = time.perf_counter()
    if options.get("inject") == "retrieval_down":
        raise ConnectionError("Vector store unavailable (injected failure)")
    if options.get("frozenContext"):
        return await frozen_retrieval(query, scope, options, started)
    embedder = get_embedder()
    store: VectorStore = get_store()
    page_max = options.get("pageMax")
    flt = VectorStore.scope_filter(scope.workspace_id, scope.source_version_ids, page_max)
    fusion = options.get("fusion", "rrf")
    top_k = int(options.get("topK", s.top_k))
    pool = max(top_k * 4, 20)

    qd = await asyncio.to_thread(embedder.embed_query, query)
    qs = await asyncio.to_thread(embedder.sparse_query, query)
    dense_hits = (
        await asyncio.to_thread(store.search_dense, qd, flt, pool) if fusion in ("rrf", "dense") else []
    )
    sparse_hits = (
        await asyncio.to_thread(store.search_sparse, qs, flt, pool) if fusion in ("rrf", "sparse") else []
    )
    fused = rrf(dense_hits, sparse_hits)
    ranked = sorted(fused.values(), key=lambda c: c.fused, reverse=True)[:pool]
    for i, c in enumerate(ranked, start=1):
        c.fused_rank = i

    repo = get_repo()
    child_rows = await repo.get_chunks([c.chunk_id for c in ranked])
    if page_max is not None:
        # Chunks that start before the limit but run past it would leak later pages.
        ranked = [c for c in ranked if ((child_rows.get(c.chunk_id) or {}).get("page_end") or 0) <= page_max]
    for c in ranked:
        row = child_rows.get(c.chunk_id)
        c.lexical = round(containment(query, row["text"]), 4) if row else 0.0

    reranker = get_reranker() if options.get("rerank", s.rerank) else None
    if reranker and ranked:
        scores = await asyncio.to_thread(
            reranker.score,
            query,
            [child_rows[c.chunk_id]["text"] for c in ranked if c.chunk_id in child_rows],
        )
        for c, sc in zip([c for c in ranked if c.chunk_id in child_rows], scores, strict=False):
            c.rerank = sc
        ranked.sort(key=lambda c: c.rerank if c.rerank is not None else -1e9, reverse=True)

    top = ranked[:top_k]
    top_dense = max((c.dense_score for c in ranked), default=0.0)
    best_lexical = max((c.lexical for c in ranked), default=0.0)
    abstain = not ranked or (top_dense < embedder.abstain_threshold and best_lexical < 0.25)

    packed, used = [], 0
    budget = int(options.get("contextBudget", s.context_budget_tokens))
    child_only = options.get("chunkLevel") == "child"
    parents = {} if child_only else await repo.get_chunks([c.parent_id for c in top if c.parent_id])
    seen_parents: set[str] = set()
    full = False
    for c in top:
        child = child_rows.get(c.chunk_id)
        if not child:
            c.note = "missing-text"
            continue
        if full:
            c.note = "over-budget"
            continue
        parent = parents.get(c.parent_id) if c.parent_id else None
        text, level = child["text"], "CHILD"
        if parent and c.parent_id not in seen_parents and used + parent["token_count"] <= budget:
            text, level = parent["text"], "PARENT"
            seen_parents.add(c.parent_id)
        elif c.parent_id in seen_parents:
            c.note = "parent-already-packed"
            continue
        t = count_tokens(text)
        if used + t > budget:
            if used == 0:
                text = text[: budget * 4]
                t = count_tokens(text)
            else:
                c.note = "over-budget"
                full = True
                continue
        c.note = "packed-parent" if level == "PARENT" else "packed-child"
        used += t
        span = parent if level == "PARENT" else child
        packed.append(
            {
                "marker": f"S{len(packed) + 1}",
                "chunkId": c.chunk_id,
                "parentId": c.parent_id,
                "sourceVersionId": c.source_version_id,
                "title": c.title,
                "page": child.get("page_start"),
                "pageFrom": span.get("page_start"),
                "pageTo": span.get("page_end") or span.get("page_start"),
                "level": level,
                "text": text,
                "childText": child["text"],
                "locator": child.get("locator"),
                "score": round(c.rerank if c.rerank is not None else c.fused, 6),
            }
        )

    latency = (time.perf_counter() - started) * 1000
    params = {
        "topK": top_k,
        "fusion": fusion,
        "rrfK": RRF_K,
        "rerank": bool(reranker),
        "budget": budget,
        "embedder": embedder.name,
        "pool": pool,
        "chunkLevel": "child" if child_only else "auto",
    }
    if page_max is not None:
        params["pageMax"] = page_max
    return Retrieval(query, ranked, packed, abstain, round(top_dense, 4), used, round(latency, 2), params)


async def frozen_retrieval(query: str, scope: Scope, options: dict, started: float) -> Retrieval:
    """Re-packs a recorded context (Model Battle) instead of searching. Only chunks inside the signed
    scope are used; anything else in the request is dropped."""
    s = get_settings()
    items = [i for i in options["frozenContext"] if isinstance(i, dict) and i.get("chunkId")][:20]
    repo = get_repo()
    rows = await repo.get_chunks([str(i["chunkId"]) for i in items])
    allowed = set(scope.source_version_ids)

    def in_scope(row: dict | None) -> bool:
        return bool(row) and row["workspace_id"] == scope.workspace_id and row["source_version_id"] in allowed

    parents = await repo.get_chunks(
        [r["parent_id"] for r in rows.values() if r.get("parent_id") and in_scope(r)]
    )
    budget = int(options.get("contextBudget", s.context_budget_tokens))
    packed, candidates, used = [], [], 0
    for i in items:
        child = rows.get(str(i["chunkId"]))
        if not in_scope(child):
            continue
        parent = parents.get(child.get("parent_id") or "")
        use_parent = i.get("level") == "PARENT" and in_scope(parent)
        text = parent["text"] if use_parent else child["text"]
        t = count_tokens(text)
        if used + t > budget and packed:
            break
        used += t
        c = Candidate(
            child["id"], child.get("parent_id"), child["source_version_id"], None, child.get("page_start")
        )
        c.note = "packed-parent" if use_parent else "packed-child"
        candidates.append(c)
        span = parent if use_parent else child
        packed.append(
            {
                "marker": f"S{len(packed) + 1}",
                "chunkId": child["id"],
                "parentId": child.get("parent_id"),
                "sourceVersionId": child["source_version_id"],
                "title": None,
                "page": child.get("page_start"),
                "pageFrom": span.get("page_start"),
                "pageTo": span.get("page_end") or span.get("page_start"),
                "level": "PARENT" if use_parent else "CHILD",
                "text": text,
                "childText": child["text"],
                "locator": child.get("locator"),
                "score": 1.0,
            }
        )
    latency = (time.perf_counter() - started) * 1000
    params = {
        "mode": "frozen",
        "frozenFrom": options.get("frozenFrom"),
        "requested": len(items),
        "budget": budget,
    }
    return Retrieval(
        query, candidates, packed, not packed, 1.0 if packed else 0.0, used, round(latency, 2), params
    )


def candidates_json(r: Retrieval) -> list[dict]:
    return [
        {
            "chunkId": c.chunk_id,
            "sourceVersionId": c.source_version_id,
            "title": c.title,
            "page": c.page,
            "denseRank": c.dense_rank,
            "sparseRank": c.sparse_rank,
            "fusedRank": c.fused_rank,
            "finalRank": i,
            "denseScore": round(c.dense_score, 4),
            "sparseScore": round(c.sparse_score, 4),
            "fused": round(c.fused, 6),
            "rerank": c.rerank,
            "lexical": c.lexical,
            "packed": c.note.startswith("packed"),
            "note": c.note,
        }
        for i, c in enumerate(r.candidates, start=1)
    ]


def packed_json(r: Retrieval) -> list[dict]:
    return [
        {k: v for k, v in p.items() if k not in ("text", "childText")} | {"tokens": count_tokens(p["text"])}
        for p in r.packed
    ]
