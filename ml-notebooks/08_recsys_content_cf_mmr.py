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
# # 8 · Recommender: content, collaborative filtering and MMR
#
# Discover serves a hybrid recommender (`folioverse_ml.recsys.RecModel`): candidates from semantic (LSA),
# TF-IDF, theme and collaborative (NMF) retrieval, a linear score whose per-factor contributions are the
# explanation, then maximal marginal relevance (MMR) with creator / franchise / media caps.
#
# Offline protocol (`folioverse_ml.evaluate`): each synthetic user's earlier interactions are the profile and
# their most recent ones are held out. This notebook reproduces the served evaluation and adds:
#
# * a leave-one-factor-out ablation of the hybrid score;
# * an MMR λ sweep (accuracy vs intra-list diversity);
# * a cold-start breakdown by profile size.
#
# All users and interactions are synthetic (DEMO).

# %%
import os
import sys

sys.path.insert(0, os.environ.get("FV_NOTEBOOK_DIR", os.getcwd()))
import fvnb

print("smoke mode" if fvnb.SMOKE else "full mode")

# %%
from collections import defaultdict

import numpy as np
from folioverse_ml.data import load_catalog, load_holdout
from folioverse_ml.evaluate import evaluate
from folioverse_ml.recsys import DEFAULT_WEIGHTS, FACTORS, Profile, RecModel, Request

items = load_catalog(fvnb.DATA / "synthetic/catalog/catalog.jsonl")
holdout = load_holdout(fvnb.DATA / "evaluation/rec-holdout")
with fvnb.Timer() as t:
    model = RecModel.train(items, holdout.train, seed=0)
print(
    f"{len(items)} items, {len(holdout.train)} train / {len(holdout.test)} test interactions, trained in {t.seconds:.1f}s"
)
print(model.manifest["training"])

K = 10
MAX_USERS = fvnb.sample(None, 40)

# %% [markdown]
# ## Served offline evaluation

# %%
report = evaluate(model, holdout, k=K, max_users=MAX_USERS)
cols = [
    "name",
    "precision",
    "recall",
    "ndcg",
    "hitRate",
    "coverage",
    "diversity",
    "novelty",
    "popularityPercentile",
]
fvnb.table(report["variants"], cols)
print(f"{report['users']} users, {report['durationMs']} ms")

# %% [markdown]
# ## Notebook harness for ablations
# Same split and scoring as `evaluate()`, with the request varied per experiment.

# %%
train: dict[str, dict[int, float]] = defaultdict(dict)
test: dict[str, set[int]] = defaultdict(set)
for it in holdout.train:
    if (i := model.index.get(it.item)) is not None:
        train[it.user][i] = max(train[it.user].get(i, 0.0), it.weight)
for it in holdout.test:
    if (i := model.index.get(it.item)) is not None:
        test[it.user].add(i)
users = sorted(u for u in test if train.get(u))[:MAX_USERS]
emb = model.features.embeddings


def run(req: Request, subset: list[str] | None = None) -> dict:
    nd, hit, ild = [], [], []
    for u in subset or users:
        profile = Profile(positives={model.items[i].id: w for i, w in train[u].items()})
        ranked = [model.index[r["id"]] for r in model.recommend(profile, req)["items"]]
        nd.append(fvnb.ndcg(ranked, dict.fromkeys(test[u], 1.0), K))
        hit.append(float(bool(set(ranked[:K]) & test[u])))
        if len(ranked) > 1:
            e = emb[ranked]
            m = len(ranked)
            ild.append(float((m * m - (e @ e.T).sum()) / (m * (m - 1))))
    return {"ndcg": fvnb.mean(nd), "hitRate": fvnb.mean(hit), "diversity": fvnb.mean(ild)}


def plain(weights=None, lam=1.0) -> Request:
    mmr = lam < 1.0
    return Request(
        k=K,
        weights=weights,
        mmr_lambda=lam,
        per_creator=2 if mmr else K,
        per_franchise=2 if mmr else K,
        balance_media=mmr,
    )


# %% [markdown]
# ## Leave-one-factor-out

# %%
full = run(plain())
ablation = [{"variant": "all factors", **full}]
for f in FACTORS:
    w = {**DEFAULT_WEIGHTS, f: 0.0}
    r = run(plain(w))
    ablation.append({"variant": f"without {f}", **r, "delta_ndcg": r["ndcg"] - full["ndcg"]})
fvnb.table(ablation)

# %% [markdown]
# ## MMR λ sweep

# %%
lambdas = [1.0, 0.9, 0.7, 0.5, 0.3] if not fvnb.SMOKE else [1.0, 0.7, 0.3]
mmr_rows = [{"lambda": lam, **run(plain(lam=lam))} for lam in lambdas]
fvnb.table(mmr_rows)

# %%
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(6, 2.8))
ax.plot([r["diversity"] for r in mmr_rows], [r["ndcg"] for r in mmr_rows], marker="o")
for r in mmr_rows:
    ax.annotate(
        f"λ={r['lambda']}", (r["diversity"], r["ndcg"]), fontsize=8, xytext=(4, 4), textcoords="offset points"
    )
ax.set_xlabel("intra-list diversity")
ax.set_ylabel(f"nDCG@{K}")
fig.tight_layout()

# %% [markdown]
# ## Cold start: profile size

# %%
sizes = np.array([len(train[u]) for u in users])
cuts = np.quantile(sizes, [1 / 3, 2 / 3])
buckets = {
    f"small (<={int(cuts[0])})": [u for u in users if len(train[u]) <= cuts[0]],
    "medium": [u for u in users if cuts[0] < len(train[u]) <= cuts[1]],
    f"large (>{int(cuts[1])})": [u for u in users if len(train[u]) > cuts[1]],
}
cold = []
for name, us in buckets.items():
    if us:
        cold.append(
            {
                "profile": name,
                "users": len(us),
                **{f"hybrid_{k}": v for k, v in run(plain(lam=0.7), us).items() if k != "diversity"},
            }
        )
fvnb.table(cold)

# %% [markdown]
# ## Findings

# %%
by = {v["name"]: v for v in report["variants"]}
fvnb.finding(
    f"Served hybrid+MMR nDCG@{K} {by['hybrid_mmr']['ndcg']:.3f} vs popularity {by['popularity']['ndcg']:.3f}, NMF {by['nmf']['ndcg']:.3f}."
)
fvnb.finding(
    f"MMR (λ=0.7) changes nDCG by {by['hybrid_mmr']['ndcg'] - by['hybrid']['ndcg']:+.3f} and diversity by "
    f"{by['hybrid_mmr']['diversity'] - by['hybrid']['diversity']:+.3f}; coverage {by['hybrid']['coverage']:.2f} -> {by['hybrid_mmr']['coverage']:.2f}."
)
worst = min(ablation[1:], key=lambda r: r["delta_ndcg"])
fvnb.finding(
    f"Most important factor: {worst['variant'].removeprefix('without ')} (removing it changes nDCG by {worst['delta_ndcg']:+.3f})."
)
fvnb.finding(
    f"Popularity bias (0.5 = none): popularity {by['popularity']['popularityPercentile']:.2f}, served {by['hybrid_mmr']['popularityPercentile']:.2f}."
)

# %%
fvnb.save(
    "08-recsys",
    {
        "k": K,
        "users": len(users),
        "modelTraining": model.manifest["training"],
        "variants": report["variants"],
        "factorAblation": ablation,
        "mmrSweep": mmr_rows,
        "coldStart": cold,
    },
)
