# ---
# jupyter:
#   jupytext:
#     formats: ipynb,py:percent
#     text_representation:
#       extension: .py
#       format_name: percent
#   kernelspec:
#     display_name: Python 3
#     language: python
#     name: python3
# ---

# %% [markdown]
# # 3 · Hybrid retrieval & reciprocal rank fusion
#
# FolioVerse retrieves with a dense and a BM25-style sparse search over the same chunks and fuses the two
# ranked lists with reciprocal rank fusion, `score = Σ 1 / (k + rank)` with `k = 60`
# (`folioverse_ai.retrieval.retrieve`). This notebook runs the real ingestion pipeline and `retrieve()` to
# answer three questions:
#
# 1. Does fusion beat either list alone, on the label-query task from notebook 2 and on `qa-small`?
# 2. How sensitive is RRF to `k`?
# 3. How does RRF compare with weighted score fusion (min-max normalised scores, `α·dense + (1-α)·sparse`)?
#
# Full mode uses the served fastembed models when they load; otherwise (and in smoke mode) the hash embedder.

# %%
import os
import sys

sys.path.insert(0, os.environ.get("FV_NOTEBOOK_DIR", os.getcwd()))
import fvnb

embedder = "hash"
if not fvnb.SMOKE:
    try:
        fvnb.setup(embedder="fastembed")
        from folioverse_ai.retrieval.embedder import get_embedder

        get_embedder()
        embedder = "fastembed"
    except Exception as e:
        print("fastembed unavailable:", e.__class__.__name__)
fvnb.setup(embedder=embedder)
print("smoke mode" if fvnb.SMOKE else "full mode", "- embedder:", embedder)

# %% [markdown]
# ## Index: catalog descriptions (one document each) and the Atlas brief

# %%
from collections import Counter

docs = fvnb.catalog()[: fvnb.sample(400, 60)]


async def build():
    svids = []
    for d in docs:
        svids.append(await fvnb.ingest(f"# {d['title']}\n\n{d['description']}", d["title"]))
    pdf = await fvnb.ingest(
        (fvnb.DATA / "synthetic/docs/atlas-brief.pdf").read_bytes(), "atlas-brief.pdf", "application/pdf"
    )
    return svids, pdf


with fvnb.Timer() as t:
    svids, atlas = fvnb.arun(build())
doc_of = {s: i for i, s in enumerate(svids)}
print(f"indexed {len(svids)} documents + brief in {t.seconds:.1f}s")

pairs = Counter((g, th["name"]) for d in docs for g in d["genres"] for th in d["themes"])
queries = []
for (genre, theme), n in sorted(pairs.items()):
    if n >= 3:
        gains = {
            i: max(th["weight"] for th in d["themes"] if th["name"] == theme)
            for i, d in enumerate(docs)
            if genre in d["genres"] and any(th["name"] == theme for th in d["themes"])
        }
        queries.append({"text": f"{genre.lower()} stories about {theme}", "gains": gains})
queries = queries[: fvnb.sample(100, 12)]
print(len(queries), "label queries")

# %% [markdown]
# ## Fusion modes through `retrieve()`

# %%
from folioverse_ai.retrieval.retrieve import retrieve

K = 10
catalog_scope = fvnb.scope(svids)


async def eval_mode(fusion: str) -> dict:
    nd, rc, rr, lat = [], [], [], []
    for q in queries:
        r = await retrieve(q["text"], catalog_scope, {"fusion": fusion, "topK": K})
        ranked = [doc_of[c.source_version_id] for c in r.candidates]
        nd.append(fvnb.ndcg(ranked, q["gains"], K))
        rc.append(fvnb.recall(ranked, set(q["gains"]), K))
        rr.append(fvnb.mrr(ranked, set(q["gains"])))
        lat.append(r.latency_ms)
    return {
        "fusion": fusion,
        f"ndcg@{K}": fvnb.mean(nd),
        f"recall@{K}": fvnb.mean(rc),
        "mrr": fvnb.mean(rr),
        "latency_ms_p50": fvnb.percentile(lat, 0.5),
    }


async def eval_qa(fusion: str, k: int = 5) -> dict:
    qa = fvnb.qa_small()
    hits, abstain_ok, answerable, unanswerable = 0, 0, 0, 0
    for q in qa:
        r = await retrieve(q["question"], fvnb.scope([atlas]), {"fusion": fusion, "topK": k})
        if q["answerable"]:
            answerable += 1
            hits += any(
                q["evidence"].lower() in (p["childText"] + " " + p["text"]).lower() for p in r.packed[:k]
            )
        else:
            unanswerable += 1
            abstain_ok += r.abstain
    return {
        "fusion": fusion,
        f"qa_recall@{k}": hits / answerable,
        "abstain_accuracy": abstain_ok / unanswerable,
    }


modes = ["dense", "sparse", "rrf"]
label_rows = [fvnb.arun(eval_mode(m)) for m in modes]
qa_rows = [fvnb.arun(eval_qa(m)) for m in modes]
fvnb.table(label_rows)
fvnb.table(qa_rows)

# %% [markdown]
# ## RRF `k` sweep and weighted score fusion
# Same candidate lists (pool of 40 from each side), re-fused offline with `retrieve.rrf(k=…)` and with
# min-max weighted fusion.

# %%
import numpy as np
from folioverse_ai.retrieval.embedder import get_embedder
from folioverse_ai.retrieval.retrieve import rrf
from folioverse_ai.retrieval.store import VectorStore, get_store

POOL = 40
emb, store = get_embedder(), get_store()
flt = VectorStore.scope_filter(fvnb.WS, svids)
hits = []
for q in queries:
    hits.append(
        (
            store.search_dense(emb.embed_query(q["text"]), flt, POOL),
            store.search_sparse(emb.sparse_query(q["text"]), flt, POOL),
        )
    )


def rank_rrf(dense, sparse, k):
    fused = rrf(dense, sparse, k=k)
    return [doc_of[c.source_version_id] for c in sorted(fused.values(), key=lambda c: c.fused, reverse=True)]


def rank_weighted(dense, sparse, alpha):
    def norm(hs):
        if not hs:
            return {}
        s = np.array([h.score for h in hs], dtype=float)
        s = (s - s.min()) / (s.max() - s.min() or 1.0)
        return {h.payload["source_version_id"]: v for h, v in zip(hs, s, strict=True)}

    d, sp = norm(dense), norm(sparse)
    # Sparse scores tie often on short documents; ties fall back to rank in the heavier-weighted list, then
    # the other, so a=0 and a=1 reproduce the single lists exactly.
    first, second = (list(d), list(sp)) if alpha >= 0.5 else (list(sp), list(d))
    keys = list(dict.fromkeys([*first, *second]))
    pos = lambda xs, k: xs.index(k) if k in xs else len(xs)  # noqa: E731
    score = {k: alpha * d.get(k, 0.0) + (1 - alpha) * sp.get(k, 0.0) for k in keys}
    return [doc_of[k] for k in sorted(keys, key=lambda k: (-score[k], pos(first, k), pos(second, k)))]


def score_rankings(fn) -> float:
    return fvnb.mean(fvnb.ndcg(fn(d, s), q["gains"], K) for q, (d, s) in zip(queries, hits, strict=True))


sweep = [
    {"method": f"rrf k={k}", f"ndcg@{K}": score_rankings(lambda d, s, k=k: rank_rrf(d, s, k))}
    for k in (1, 10, 30, 60, 120, 500)
]
sweep += [
    {"method": f"weighted a={a}", f"ndcg@{K}": score_rankings(lambda d, s, a=a: rank_weighted(d, s, a))}
    for a in (0.0, 0.3, 0.5, 0.7, 1.0)
]
fvnb.table(sweep)

# %%
import matplotlib.pyplot as plt

rrf_rows = [r for r in sweep if r["method"].startswith("rrf")]
fig, ax = plt.subplots(figsize=(6, 2.8))
ax.plot([int(r["method"].split("=")[1]) for r in rrf_rows], [r[f"ndcg@{K}"] for r in rrf_rows], marker="o")
ax.set_xscale("log")
ax.set_xlabel("RRF k")
ax.set_ylabel(f"nDCG@{K}")
fig.tight_layout()

# %% [markdown]
# ## Findings

# %%
by = {r["fusion"]: r for r in label_rows}
best_single = max(by["dense"][f"ndcg@{K}"], by["sparse"][f"ndcg@{K}"])
fvnb.finding(
    f"RRF nDCG@{K} {by['rrf'][f'ndcg@{K}']:.3f} vs best single list {best_single:.3f} ({embedder} embedder)."
)
k60 = next(r for r in sweep if r["method"] == "rrf k=60")[f"ndcg@{K}"]
spread = max(r[f"ndcg@{K}"] for r in rrf_rows) - min(r[f"ndcg@{K}"] for r in rrf_rows)
fvnb.finding(
    f"RRF k=60 scores {k60:.3f}; the whole k range moves nDCG by {spread:.3f}, so the constant is not critical."
)
best_w = max((r for r in sweep if r["method"].startswith("weighted")), key=lambda r: r[f"ndcg@{K}"])
fvnb.finding(
    f"Best weighted fusion: {best_w['method']} at {best_w[f'ndcg@{K}']:.3f} vs RRF k=60 {k60:.3f}. Weighted fusion's best "
    "alpha depends on each embedder's score scale; RRF uses ranks only, so it needs no per-embedder tuning."
)

# %%
fvnb.save(
    "03-hybrid-retrieval-rrf",
    {
        "embedder": embedder,
        "documents": len(docs),
        "queries": len(queries),
        "k": K,
        "fusionModes": label_rows,
        "qaSmall": qa_rows,
        "fusionSweep": sweep,
    },
)
