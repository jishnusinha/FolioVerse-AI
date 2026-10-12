"""Offline evaluation on the rec-holdout split.

Each synthetic user's training interactions are the profile; the held-out (most recent) items are the
relevant set. Variants share the same model so differences come from scoring, not data.
"""

import math
import time
from collections import Counter, defaultdict
from datetime import UTC, datetime

import numpy as np

from .data import Holdout
from .recsys import Profile, RecModel, Request

VARIANTS: dict[str, dict] = {
    "popularity": {"label": "Most popular (baseline)"},
    "item_knn": {"label": "Item-kNN collaborative filtering"},
    "nmf": {"label": "NMF collaborative filtering"},
    "content": {
        "label": "Content only (semantic + TF-IDF + themes)",
        "weights": {"semantic": 0.45, "tfidf": 0.25, "theme": 0.30, "preference": 0.0, "prior": 0.0},
        "mmr": False,
    },
    "hybrid": {"label": "Hybrid, no diversification", "mmr": False},
    "hybrid_mmr": {"label": "Hybrid + MMR (served)", "mmr": True},
}


def _ndcg(ranked: list[int], relevant: set[int], k: int) -> float:
    dcg = sum(1.0 / math.log2(r + 2) for r, i in enumerate(ranked[:k]) if i in relevant)
    ideal = sum(1.0 / math.log2(r + 2) for r in range(min(k, len(relevant))))
    return dcg / ideal if ideal else 0.0


def _top(scores: np.ndarray, blocked: np.ndarray, k: int) -> list[int]:
    s = np.where(blocked, -np.inf, scores)
    return [int(i) for i in np.argsort(-s, kind="stable")[:k]]


def evaluate(
    model: RecModel,
    holdout: Holdout,
    k: int = 10,
    variants: list[str] | None = None,
    max_users: int | None = None,
) -> dict:
    t0 = time.perf_counter()
    n = len(model.items)
    train: dict[str, dict[int, float]] = defaultdict(dict)
    test: dict[str, set[int]] = defaultdict(set)
    for it in holdout.train:
        if (i := model.index.get(it.item)) is not None:
            train[it.user][i] = max(train[it.user].get(i, 0.0), it.weight)
    for it in holdout.test:
        if (i := model.index.get(it.item)) is not None:
            test[it.user].add(i)
    users = sorted(u for u in test if train.get(u))
    if max_users:
        users = users[:max_users]

    counts = Counter(i for u in train.values() for i in u)
    pop = np.array([counts.get(i, 0) for i in range(n)], dtype=np.float32)
    percentile = np.argsort(np.argsort(pop, kind="stable"), kind="stable") / max(1, n - 1)
    self_info = -np.log2((pop + 1) / (len(train) + 1))
    emb = model.features.embeddings

    out = []
    for name in variants or list(VARIANTS):
        spec = VARIANTS[name]
        lists: list[list[int]] = []
        for u in users:
            pos = train[u]
            blocked = np.zeros(n, dtype=bool)
            blocked[list(pos)] = True
            if name == "popularity":
                ranked = _top(pop, blocked, k)
            elif name == "item_knn":
                ranked = _top(model.cf.knn_scores(pos), blocked, k)
            elif name == "nmf":
                ranked = _top(model.cf.scores(pos), blocked, k)
            else:
                profile = Profile(positives={model.items[i].id: w for i, w in pos.items()})
                mmr = spec.get("mmr", True)
                req = Request(
                    k=k,
                    weights=spec.get("weights"),
                    mmr_lambda=0.7 if mmr else 1.0,
                    per_creator=2 if mmr else k,
                    per_franchise=2 if mmr else k,
                    balance_media=mmr,
                )
                ranked = [model.index[r["id"]] for r in model.recommend(profile, req)["items"]]
            lists.append(ranked)

        hits = [len(set(r[:k]) & test[u]) for r, u in zip(lists, users, strict=True)]
        ild = []
        for r in lists:
            if len(r) > 1:
                e = emb[r]
                sim = e @ e.T
                m = len(r)
                ild.append(float((m * m - sim.sum()) / (m * (m - 1))))
        recommended = [i for r in lists for i in r]
        out.append(
            {
                "name": name,
                "label": spec["label"],
                "precision": round(float(np.mean([h / k for h in hits])), 4),
                "recall": round(
                    float(np.mean([h / len(test[u]) for h, u in zip(hits, users, strict=True)])), 4
                ),
                "ndcg": round(
                    float(np.mean([_ndcg(r, test[u], k) for r, u in zip(lists, users, strict=True)])), 4
                ),
                "hitRate": round(float(np.mean([h > 0 for h in hits])), 4),
                "coverage": round(len(set(recommended)) / n, 4),
                "diversity": round(float(np.mean(ild)) if ild else 0.0, 4),
                "novelty": round(float(np.mean(self_info[recommended])) if recommended else 0.0, 3),
                "popularityPercentile": round(
                    float(np.mean(percentile[recommended])) if recommended else 0.0, 4
                ),
            }
        )
    return {
        "name": "rec-offline-eval",
        "modelVersion": model.version_label,
        "k": k,
        "users": len(users),
        "catalogItems": n,
        "isDemo": True,
        "note": "Synthetic catalog and synthetic users (DEMO). Metrics show relative behaviour of the variants, not real-world quality.",
        "metrics": {
            "precision": "Precision@K",
            "recall": "Recall@K",
            "ndcg": "nDCG@K",
            "hitRate": "Hit rate@K",
            "coverage": "Catalog coverage",
            "diversity": "Intra-list diversity (1 − cosine)",
            "novelty": "Novelty (mean self-information, bits)",
            "popularityPercentile": "Popularity bias (mean popularity percentile; 0.5 = none)",
        },
        "variants": out,
        "durationMs": round((time.perf_counter() - t0) * 1000),
        "createdAt": datetime.now(UTC).isoformat(timespec="seconds"),
    }
