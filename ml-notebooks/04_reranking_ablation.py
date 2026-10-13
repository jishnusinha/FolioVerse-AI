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
# # 4 · Reranking ablation
#
# After fusion, `retrieve()` can rerank its candidate pool with a cross-encoder (`FV_RERANK=true`,
# fastembed `TextCrossEncoder`). It also computes a cheap lexical containment score for every candidate,
# which drives abstention. This notebook asks whether reranking pays for its latency:
#
# * **none**: RRF order, as served by default;
# * **lexical**: candidates re-sorted by query containment (share of the query's content words in the chunk);
# * **rrf+lexical**: reciprocal rank fusion of the RRF order and the lexical order;
# * **cross-encoder**: the served reranker model (full mode only, when the model loads).
#
# Two tasks: the catalog label queries (document-level, graded) and `qa-small` over the Atlas brief mixed
# into catalog distractors (a chunk is relevant when it contains the evidence span). The rerank depth `N`
# (how many fused candidates are re-scored) is swept as well.

# %%
import os
import sys

sys.path.insert(0, os.environ.get("FV_NOTEBOOK_DIR", os.getcwd()))
import fvnb

fvnb.setup()
print("smoke mode" if fvnb.SMOKE else "full mode")

# %% [markdown]
# ## Index and candidate pools

# %%
from collections import Counter

from folioverse_ai.retrieval.retrieve import retrieve

docs = fvnb.catalog()[: fvnb.sample(400, 60)]


async def build():
    svids = [await fvnb.ingest(f"# {d['title']}\n\n{d['description']}", d["title"]) for d in docs]
    pdf = await fvnb.ingest(
        (fvnb.DATA / "synthetic/docs/atlas-brief.pdf").read_bytes(), "atlas-brief.pdf", "application/pdf"
    )
    return svids, pdf


svids, atlas = fvnb.arun(build())
doc_of = {s: i for i, s in enumerate(svids)}

pairs = Counter((g, th["name"]) for d in docs for g in d["genres"] for th in d["themes"])
label_queries = []
for (genre, theme), n in sorted(pairs.items()):
    if n >= 3:
        gains = {
            i: max(th["weight"] for th in d["themes"] if th["name"] == theme)
            for i, d in enumerate(docs)
            if genre in d["genres"] and any(th["name"] == theme for th in d["themes"])
        }
        label_queries.append({"text": f"{genre.lower()} stories about {theme}", "gains": gains})
label_queries = label_queries[: fvnb.sample(100, 12)]
qa = [q for q in fvnb.qa_small() if q["answerable"]]

POOL_TOPK = 10  # retrieve() pool = max(4 * topK, 20) = 40 candidates


async def pools(texts: list[str], scope):
    out = []
    for t in texts:
        r = await retrieve(t, scope, {"topK": POOL_TOPK, "rerank": False})
        rows = await fvnb.repo().get_chunks([c.chunk_id for c in r.candidates])
        out.append([(c, rows[c.chunk_id]["text"]) for c in r.candidates if c.chunk_id in rows])
    return out


label_pools = fvnb.arun(pools([q["text"] for q in label_queries], fvnb.scope(svids)))
qa_pools = fvnb.arun(pools([q["question"] for q in qa], fvnb.scope([*svids, atlas])))
print(
    f"{len(label_queries)} label queries, {len(qa)} answerable qa-small questions, pool {len(label_pools[0])}"
)

# %% [markdown]
# ## Rerankers

# %%
import time

from folioverse_ai.text import containment


def by_lexical(query, pool):
    return sorted(pool, key=lambda ct: -containment(query, ct[1]))  # stable: ties keep RRF order


def by_rrf_lexical(query, pool, k=60):
    lex = {id(ct): r for r, ct in enumerate(by_lexical(query, pool))}
    return sorted(pool, key=lambda ct: -(1 / (k + pool.index(ct)) + 1 / (k + lex[id(ct)])))


rerankers = {"none": lambda q, pool: list(pool), "lexical": by_lexical, "rrf+lexical": by_rrf_lexical}
cross_model = None
if not fvnb.SMOKE:
    try:
        from folioverse_ai.retrieval.embedder import Reranker
        from folioverse_ai.settings import get_settings

        cross_model = get_settings().rerank_model
        ce = Reranker(cross_model)

        def by_cross(query, pool):
            scores = ce.score(query, [t for _, t in pool])
            order = sorted(range(len(pool)), key=lambda i: -scores[i])
            return [pool[i] for i in order]

        rerankers["cross-encoder"] = by_cross
    except Exception as e:
        cross_model = None
        print("cross-encoder unavailable:", e.__class__.__name__)
print("rerankers:", ", ".join(rerankers))

# %% [markdown]
# ## Ablation at full depth

# %%


def rerank_depth(fn, query, pool, depth):
    head = fn(query, pool[:depth]) if depth else []
    return head + pool[depth:]


def evaluate(name, depth):
    lat, nd, r5, mrr_l = [], [], [], []
    for q, pool in zip(label_queries, label_pools, strict=True):
        t0 = time.perf_counter()
        ranked = rerank_depth(rerankers[name], q["text"], pool, depth)
        lat.append((time.perf_counter() - t0) * 1000)
        ids = [doc_of.get(c.source_version_id) for c, _ in ranked]
        nd.append(fvnb.ndcg(ids, q["gains"], 10))
        r5.append(fvnb.recall(ids, set(q["gains"]), 5))
        mrr_l.append(fvnb.mrr(ids, set(q["gains"])))
    hit1, hit3, hit5, mrr_q = [], [], [], []
    for q, pool in zip(qa, qa_pools, strict=True):
        t0 = time.perf_counter()
        ranked = rerank_depth(rerankers[name], q["question"], pool, depth)
        lat.append((time.perf_counter() - t0) * 1000)
        rel = [q["evidence"].lower() in t.lower() for _, t in ranked]
        hit1.append(float(rel[0]) if rel else 0.0)
        hit3.append(float(any(rel[:3])))
        hit5.append(float(any(rel[:5])))
        mrr_q.append(next((1 / (i + 1) for i, x in enumerate(rel) if x), 0.0))
    return {
        "reranker": name,
        "depth": depth,
        "label_ndcg@10": fvnb.mean(nd),
        "label_recall@5": fvnb.mean(r5),
        "label_mrr": fvnb.mean(mrr_l),
        "qa_hit@1": fvnb.mean(hit1),
        "qa_hit@3": fvnb.mean(hit3),
        "qa_hit@5": fvnb.mean(hit5),
        "qa_mrr": fvnb.mean(mrr_q),
        "rerank_ms_p50": fvnb.percentile(lat, 0.5),
    }


FULL = len(label_pools[0])
ablation = [evaluate(name, FULL) for name in rerankers]
fvnb.table(ablation)

# %% [markdown]
# ## Rerank depth
# Only the top `N` fused candidates are re-scored; the rest keep their RRF order.

# %%
depths = [5, 10, 20, FULL]
depth_rows = [evaluate(name, n) for name in rerankers if name != "none" for n in depths]
fvnb.table(depth_rows, ["reranker", "depth", "label_ndcg@10", "qa_hit@1", "qa_mrr", "rerank_ms_p50"])

# %%
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(6, 2.8))
for name in [n for n in rerankers if n != "none"]:
    rows = [r for r in depth_rows if r["reranker"] == name]
    ax.plot([r["depth"] for r in rows], [r["qa_mrr"] for r in rows], marker="o", label=name)
ax.axhline(ablation[0]["qa_mrr"], color="grey", linestyle="--", label="none")
ax.set_xlabel("rerank depth N")
ax.set_ylabel("qa-small MRR")
ax.legend(fontsize=8)
fig.tight_layout()

# %% [markdown]
# ## Findings

# %%
base = ablation[0]
for r in ablation[1:]:
    fvnb.finding(
        f"{r['reranker']}: label nDCG@10 {r['label_ndcg@10'] - base['label_ndcg@10']:+.3f}, "
        f"qa hit@1 {r['qa_hit@1'] - base['qa_hit@1']:+.3f}, qa MRR {r['qa_mrr'] - base['qa_mrr']:+.3f} vs RRF only, "
        f"at {r['rerank_ms_p50']:.2f} ms p50 per query."
    )
if base["qa_hit@3"] == 1.0:
    fvnb.finding(
        "qa-small is saturated at hit@3 for RRF alone; its questions share vocabulary with the evidence."
    )
if cross_model is None:
    fvnb.finding("Cross-encoder not evaluated in this run (smoke mode or model unavailable offline).")

# %%
fvnb.save(
    "04-reranking-ablation",
    {
        "documents": len(docs),
        "labelQueries": len(label_queries),
        "qaQuestions": len(qa),
        "pool": FULL,
        "crossEncoder": cross_model,
        "ablation": ablation,
        "depthSweep": depth_rows,
    },
)
