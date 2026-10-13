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
# # 9 · Taste profile clustering
#
# Discover's Taste Lab describes a reader by the themes, genres and moods of what they have read. Are there
# natural "taste segments" in the user base, and are they stable enough to use (for cold-start defaults or
# segment-level evaluation)?
#
# Each synthetic user's taste vector is the weighted mean of the LSA embeddings (`ContentFeatures`) of their
# training interactions. We cluster with k-means, choose `k` by silhouette, describe each cluster by its
# over-represented genres and themes, test stability with bootstrap resampling (adjusted Rand index), and check
# usefulness with a "popular in your segment" recommender. The generator's latent taste clusters are not
# published, so the user's dominant genre serves as an external reference label.

# %%
import os
import sys

sys.path.insert(0, os.environ.get("FV_NOTEBOOK_DIR", os.getcwd()))
import fvnb

print("smoke mode" if fvnb.SMOKE else "full mode")

# %%
from collections import Counter, defaultdict

import numpy as np
from folioverse_ml.data import load_catalog, load_holdout
from folioverse_ml.features import ContentFeatures

items = load_catalog(fvnb.DATA / "synthetic/catalog/catalog.jsonl")
holdout = load_holdout(fvnb.DATA / "evaluation/rec-holdout")
features = ContentFeatures.fit(items, lsa_dims=64, seed=0)
index = {it.slug: i for i, it in enumerate(items)} | {it.id: i for i, it in enumerate(items)}

train: dict[str, dict[int, float]] = defaultdict(dict)
test: dict[str, set[int]] = defaultdict(set)
for it in holdout.train:
    if (i := index.get(it.item)) is not None:
        train[it.user][i] = max(train[it.user].get(i, 0.0), it.weight)
for it in holdout.test:
    if (i := index.get(it.item)) is not None:
        test[it.user].add(i)
users = sorted(train)
E = features.embeddings
X = np.stack([np.average(E[list(train[u])], axis=0, weights=list(train[u].values())) for u in users])
X /= np.linalg.norm(X, axis=1, keepdims=True)
dominant = [Counter(g for i in train[u] for g in items[i].genres).most_common(1)[0][0] for u in users]
print(f"{len(users)} users, taste vectors {X.shape}, dominant genres: {dict(Counter(dominant))}")

# %% [markdown]
# ## Choosing k

# %%
from sklearn.cluster import KMeans
from sklearn.metrics import adjusted_rand_score, silhouette_score

ks = list(range(2, 13)) if not fvnb.SMOKE else [2, 4, 6, 8, 10]
k_rows = []
for k in ks:
    km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(X)
    k_rows.append(
        {
            "k": k,
            "silhouette": float(silhouette_score(X, km.labels_)),
            "inertia": float(km.inertia_),
            "ari_vs_dominant_genre": adjusted_rand_score(dominant, km.labels_),
        }
    )
fvnb.table(k_rows)
best_k = max(k_rows, key=lambda r: r["silhouette"])["k"]
km = KMeans(n_clusters=best_k, n_init=10, random_state=0).fit(X)
labels = km.labels_
print("chosen k =", best_k)

# %% [markdown]
# ## Cluster descriptions
# Lift = share of the cluster's interactions with a genre / theme divided by the share across all users.

# %%


def lift_terms(member_users: list[str], attr: str, top: int = 3) -> list[str]:
    def shares(us):
        c = Counter()
        for u in us:
            for i in train[u]:
                vals = items[i].genres if attr == "genre" else tuple(items[i].themes)
                c.update(vals)
        total = sum(c.values()) or 1
        return {k: v / total for k, v in c.items()}

    inside, overall = shares(member_users), shares(users)
    return [
        f"{t} ×{inside[t] / overall[t]:.1f}"
        for t in sorted(inside, key=lambda t: -inside[t] / overall[t])[:top]
    ]


clusters = []
for c in range(best_k):
    members = [u for u, lab in zip(users, labels, strict=True) if lab == c]
    clusters.append(
        {
            "cluster": c,
            "users": len(members),
            "genres": ", ".join(lift_terms(members, "genre", 2)),
            "themes": ", ".join(lift_terms(members, "theme", 3)),
            "mean_profile_size": fvnb.mean(len(train[u]) for u in members),
        }
    )
fvnb.table(clusters)

# %%
import matplotlib.pyplot as plt
from sklearn.decomposition import PCA

P = PCA(n_components=2, random_state=0).fit_transform(X)
fig, ax = plt.subplots(figsize=(5, 4))
ax.scatter(P[:, 0], P[:, 1], c=labels, cmap="tab10", s=12)
ax.set_title(f"Taste vectors (PCA), k={best_k}")
ax.set_xticks([])
ax.set_yticks([])
fig.tight_layout()

# %% [markdown]
# ## Stability (bootstrap ARI)

# %%
rng = np.random.default_rng(0)
aris = []
for b in range(fvnb.sample(30, 5)):
    idx = rng.choice(len(users), size=int(0.8 * len(users)), replace=False)
    kb = KMeans(n_clusters=best_k, n_init=10, random_state=b + 1).fit(X[idx])
    aris.append(adjusted_rand_score(labels[idx], kb.labels_))
stability = {
    "bootstraps": len(aris),
    "ari_mean": fvnb.mean(aris),
    "ari_min": float(min(aris)),
    "ari_max": float(max(aris)),
}
fvnb.table([stability])

# %% [markdown]
# ## Usefulness: "popular in your segment"

# %%
K = 10
global_pop = Counter(i for u in users for i in train[u])
seg_pop = [
    Counter(i for u, lab in zip(users, labels, strict=True) if lab == c for i in train[u])
    for c in range(best_k)
]


def hit_rate(rank_fn) -> float:
    hits = []
    for u, lab in zip(users, labels, strict=True):
        if test.get(u):
            ranked = [i for i, _ in rank_fn(lab).most_common() if i not in train[u]][:K]
            hits.append(float(bool(set(ranked) & test[u])))
    return fvnb.mean(hits)


usefulness = [
    {"recommender": "global popularity", f"hit@{K}": hit_rate(lambda _lab: global_pop)},
    {"recommender": "segment popularity", f"hit@{K}": hit_rate(lambda lab: seg_pop[lab])},
]
fvnb.table(usefulness)

# %% [markdown]
# ## Findings

# %%
chosen = next(r for r in k_rows if r["k"] == best_k)
fvnb.finding(
    f"Best silhouette at k={best_k} ({chosen['silhouette']:.3f}); ARI with users' dominant genre {chosen['ari_vs_dominant_genre']:.3f}."
)
if chosen["silhouette"] < 0.25:
    spread = max(r["silhouette"] for r in k_rows) - min(r["silhouette"] for r in k_rows)
    fvnb.finding(
        f"All silhouettes are below 0.25 (range {spread:.3f} across k): tastes form a continuum with mixed-genre users, "
        "not well-separated segments; the chosen k is a coarse split."
    )
fvnb.finding(
    f"Bootstrap ARI {stability['ari_mean']:.2f} (min {stability['ari_min']:.2f}): "
    + (
        "stable segments."
        if stability["ari_mean"] >= 0.7
        else "segments shift under resampling; use them as soft hints only."
    )
)
fvnb.finding(
    f"Segment popularity hit@{K} {usefulness[1][f'hit@{K}']:.3f} vs global popularity {usefulness[0][f'hit@{K}']:.3f}."
)

# %%
fvnb.save(
    "09-taste-clustering",
    {
        "users": len(users),
        "kSweep": k_rows,
        "k": best_k,
        "clusters": clusters,
        "stability": stability,
        "usefulness": usefulness,
    },
)
