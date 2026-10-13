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
# # 2 · Embedding comparison
#
# Which representation finds the right passages when the query's words are not the document's words?
#
# Documents are catalog descriptions **without** their genre/theme labels; queries are built from the labels
# ("mystery stories about detectives"), so lexical overlap is limited ("an amateur sleuth…"). A document is
# relevant to a query when its labels contain the genre and the theme; the gain is the theme weight.
#
# Representations:
#
# | name | what | used in |
# |---|---|---|
# | `hash-dense` | feature-hashed unigrams + bigrams, 384-d | tests/CI embedder |
# | `hash-sparse` | hashed term frequencies scored with IDF (BM25-like) | tests/CI sparse vector |
# | `tfidf` | scikit-learn TF-IDF (1–2 grams, sublinear) | baseline |
# | `lsa-64` | folioverse-ml TF-IDF → 64-d LSA, fitted on unlabelled descriptions | recommender semantic space |
# | `bge-small` / `bm25` | fastembed `BAAI/bge-small-en-v1.5` and `Qdrant/bm25` | served embedders (full mode, if the models load) |

# %%
import os
import sys

sys.path.insert(0, os.environ.get("FV_NOTEBOOK_DIR", os.getcwd()))
import fvnb

fvnb.setup()
print("smoke mode" if fvnb.SMOKE else "full mode")

# %%
import math
import time
from collections import Counter

import numpy as np

docs = fvnb.catalog()[: fvnb.sample(530, 80)]
texts = [f"{d['title']}. {d['description']}" for d in docs]

pairs = Counter((g, t["name"]) for d in docs for g in d["genres"] for t in d["themes"])
queries = []
for (genre, theme), n in sorted(pairs.items()):
    if n >= 3:
        gains = {
            i: max(t["weight"] for t in d["themes"] if t["name"] == theme)
            for i, d in enumerate(docs)
            if genre in d["genres"] and any(t["name"] == theme for t in d["themes"])
        }
        queries.append({"text": f"{genre.lower()} stories about {theme}", "gains": gains})
queries = queries[: fvnb.sample(120, 15)]
print(
    f"{len(docs)} documents, {len(queries)} queries, mean {fvnb.mean(len(q['gains']) for q in queries):.1f} relevant each"
)

# %% [markdown]
# ## Representations

# %%
from folioverse_ai.retrieval.embedder import HashEmbedder, Sparse
from folioverse_ml.data import Item
from folioverse_ml.features import ContentFeatures
from sklearn.feature_extraction.text import TfidfVectorizer


def unit(m: np.ndarray) -> np.ndarray:
    return m / np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-9)


def sparse_scorer(doc_vecs: list[Sparse]):
    """IDF-weighted dot product over sparse term vectors (what Qdrant's IDF modifier computes)."""
    df = Counter(i for v in doc_vecs for i in v.indices)
    n = len(doc_vecs)
    idf = {i: math.log(1 + (n - c + 0.5) / (c + 0.5)) for i, c in df.items()}
    rows = [dict(zip(v.indices, v.values, strict=True)) for v in doc_vecs]

    def score(q: Sparse) -> np.ndarray:
        return np.array(
            [
                sum(idf.get(i, 0.0) * qv * r.get(i, 0.0) for i, qv in zip(q.indices, q.values, strict=True))
                for r in rows
            ]
        )

    return score


systems = {}
h = HashEmbedder()
t0 = time.perf_counter()
hd = unit(np.array(h.embed_documents(texts)))
systems["hash-dense"] = {
    "dims": h.dims,
    "index_s": time.perf_counter() - t0,
    "score": lambda q: hd @ unit(np.array([h.embed_query(q)]))[0],
}

t0 = time.perf_counter()
hs = sparse_scorer(h.sparse_documents(texts))
systems["hash-sparse"] = {
    "dims": "sparse",
    "index_s": time.perf_counter() - t0,
    "score": lambda q: hs(h.sparse_query(q)),
}

t0 = time.perf_counter()
tv = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, stop_words="english", min_df=1)
tm = tv.fit_transform(texts)
systems["tfidf"] = {
    "dims": tm.shape[1],
    "index_s": time.perf_counter() - t0,
    "score": lambda q: (tm @ tv.transform([q]).T).toarray().ravel(),
}

t0 = time.perf_counter()
plain_items = [Item.from_json({**d, "themes": [], "genres": [], "moods": []}) for d in docs]
cf = ContentFeatures.fit(plain_items, lsa_dims=64, seed=0)
systems["lsa-64"] = {
    "dims": cf.components.shape[0],
    "index_s": time.perf_counter() - t0,
    "score": lambda q: cf.embeddings @ cf.embed(cf.transform([q]))[0],
}

fast_status = "skipped in smoke mode"
if not fvnb.SMOKE:
    try:
        from folioverse_ai.retrieval.embedder import FastEmbedder

        fe = FastEmbedder("BAAI/bge-small-en-v1.5", "Qdrant/bm25")
        t0 = time.perf_counter()
        fd = unit(np.array(fe.embed_documents(texts)))
        systems["bge-small"] = {
            "dims": fe.dims,
            "index_s": time.perf_counter() - t0,
            "score": lambda q: fd @ unit(np.array([fe.embed_query(q)]))[0],
        }
        t0 = time.perf_counter()
        fs = sparse_scorer(fe.sparse_documents(texts))
        systems["bm25"] = {
            "dims": "sparse",
            "index_s": time.perf_counter() - t0,
            "score": lambda q: fs(fe.sparse_query(q)),
        }
        fast_status = "loaded"
    except Exception as e:  # offline without a cached model
        fast_status = f"unavailable ({e.__class__.__name__})"
print("fastembed:", fast_status)

# %% [markdown]
# ## Ranking quality

# %%
K = 10
rows = []
for name, s in systems.items():
    nd, rc, rr, lat = [], [], [], []
    for q in queries:
        t0 = time.perf_counter()
        scores = s["score"](q["text"])
        lat.append((time.perf_counter() - t0) * 1000)
        ranked = [int(i) for i in np.argsort(-scores, kind="stable")]
        rel = set(q["gains"])
        nd.append(fvnb.ndcg(ranked, q["gains"], K))
        rc.append(fvnb.recall(ranked, rel, K))
        rr.append(fvnb.mrr(ranked, rel))
    rows.append(
        {
            "system": name,
            "dims": s["dims"],
            f"ndcg@{K}": fvnb.mean(nd),
            f"recall@{K}": fvnb.mean(rc),
            "mrr": fvnb.mean(rr),
            "index_docs_per_s": len(texts) / max(s["index_s"], 1e-9),
            "query_ms_p50": fvnb.percentile(lat, 0.5),
        }
    )
rows.sort(key=lambda r: -r[f"ndcg@{K}"])
fvnb.table(rows)

# %%
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(6, 2.8))
ax.barh([r["system"] for r in rows][::-1], [r[f"ndcg@{K}"] for r in rows][::-1])
ax.set_xlabel(f"nDCG@{K}")
fig.tight_layout()

# %% [markdown]
# ## Where lexical matching fails
# Share of queries whose theme word never appears in any relevant description — the vocabulary gap the dense
# models have to bridge.

# %%
gap = fvnb.mean(
    all(q["text"].split(" about ")[1].split()[-1].rstrip("s") not in texts[i].lower() for i in q["gains"])
    for q in queries
)
print(f"queries with no literal theme word in any relevant document: {gap:.0%}")

# %% [markdown]
# ## Findings

# %%
best = rows[0]
by = {r["system"]: r for r in rows}
fvnb.finding(f"Best: {best['system']} (nDCG@{K} {best[f'ndcg@{K}']:.3f}).")
fvnb.finding(
    f"hash-dense vs tfidf: {by['hash-dense'][f'ndcg@{K}']:.3f} vs {by['tfidf'][f'ndcg@{K}']:.3f}; the hash embedder is a lexical stand-in for CI, not a semantic model."
)
if "bge-small" in by:
    fvnb.finding(
        f"bge-small vs hash-dense: {by['bge-small'][f'ndcg@{K}']:.3f} vs {by['hash-dense'][f'ndcg@{K}']:.3f}."
    )
else:
    fvnb.finding(f"Served fastembed models: {fast_status}.")

# %%
fvnb.save(
    "02-embedding-comparison",
    {
        "documents": len(docs),
        "queries": len(queries),
        "k": K,
        "fastembed": fast_status,
        "systems": rows,
        "vocabularyGap": gap,
    },
)
