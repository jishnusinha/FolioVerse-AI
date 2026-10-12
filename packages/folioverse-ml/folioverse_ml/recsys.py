"""Hybrid recommender: candidate retrieval → linear hybrid score → MMR diversification → explanations.

    s(i) = w_sem·semantic + w_tfidf·tfidf + w_theme·theme + w_pref·preference + w_prior·prior − dislike penalty

Every factor value and weight is returned per item, so an explanation is the exact decomposition of
the score, not a post-hoc story. Profiles come from the caller (positives, negatives, declared tastes,
a free-text query and context documents such as books on the user's shelf).
"""

import math
import time
from dataclasses import dataclass, field

import numpy as np

from .cf import ImplicitCF, interaction_matrix
from .data import Interaction, Item
from .features import ContentFeatures

FACTORS = ("semantic", "tfidf", "theme", "preference", "prior")
LABELS = {
    "semantic": "Semantic affinity",
    "tfidf": "TF-IDF similarity",
    "theme": "Theme overlap",
    "preference": "Preference match",
    "prior": "Quality prior (capped)",
}
DEFAULT_WEIGHTS = {"semantic": 0.35, "tfidf": 0.20, "theme": 0.20, "preference": 0.20, "prior": 0.05}
PRIOR_CAP = 0.10
DISLIKE_PENALTY = 0.15
CANDIDATES = {"semantic": 120, "tfidf": 80, "theme": 64, "collaborative": 40}
COLD_START_POOL = 120
MMR_POOL = 200
PRF_ITEMS = 10
# Relative weight of each profile part when they are blended into one taste vector.
PART_WEIGHTS = {"history": 1.0, "query": 1.5, "declared": 0.6, "context": 0.8}


@dataclass
class ContextDoc:
    title: str
    text: str
    weight: float = 1.0


@dataclass
class Profile:
    positives: dict[str, float] = field(default_factory=dict)
    negatives: list[str] = field(default_factory=list)
    exclude: list[str] = field(default_factory=list)
    genres: list[str] = field(default_factory=list)
    moods: list[str] = field(default_factory=list)
    themes: list[str] = field(default_factory=list)
    query: str = ""
    context: list[ContextDoc] = field(default_factory=list)

    @classmethod
    def from_json(cls, d: dict | None) -> "Profile":
        d = d or {}
        pos = d.get("positives") or {}
        if isinstance(pos, list):
            pos = {p["id"]: float(p.get("weight", 1.0)) for p in pos}
        return cls(
            positives={str(k): float(v) for k, v in pos.items()},
            negatives=[str(x) for x in d.get("negatives") or []],
            exclude=[str(x) for x in d.get("exclude") or []],
            genres=list(d.get("genres") or []),
            moods=list(d.get("moods") or []),
            themes=list(d.get("themes") or []),
            query=str(d.get("query") or "")[:500],
            context=[
                ContextDoc(c.get("title", ""), c.get("text", ""), float(c.get("weight", 1.0)))
                for c in d.get("context") or []
            ],
        )


@dataclass
class Request:
    k: int = 12
    kind: str | None = None
    genres: list[str] = field(default_factory=list)
    moods: list[str] = field(default_factory=list)
    weights: dict[str, float] | None = None
    mmr_lambda: float = 0.7
    per_creator: int = 2
    per_franchise: int = 2
    balance_media: bool = True

    @classmethod
    def from_json(cls, d: dict | None) -> "Request":
        d = d or {}
        return cls(
            k=max(1, min(50, int(d.get("k") or 12))),
            kind=d.get("kind") if d.get("kind") in ("BOOK", "FILM") else None,
            genres=list(d.get("genres") or []),
            moods=list(d.get("moods") or []),
            weights=d.get("weights"),
            mmr_lambda=float(min(1.0, max(0.0, d.get("lambda", 0.7)))),
            per_creator=max(1, int(d.get("perCreator") or 2)),
            per_franchise=max(1, int(d.get("perFranchise") or 2)),
            balance_media=bool(d.get("balanceMedia", True)),
        )


def effective_weights(raw: dict[str, float] | None) -> dict[str, float]:
    """Clip to [0, 1], normalise to sum 1, then cap the quality prior so popularity never dominates."""
    w = {k: float(min(1.0, max(0.0, (raw or {}).get(k, DEFAULT_WEIGHTS[k])))) for k in FACTORS}
    total = sum(w.values())
    if total <= 0:
        w = dict(DEFAULT_WEIGHTS)
        total = 1.0
    w = {k: v / total for k, v in w.items()}
    w["prior"] = min(w["prior"], PRIOR_CAP)
    return {k: round(v, 4) for k, v in w.items()}


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else v


def _join(words: list[str]) -> str:
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]


def _stem(w: str) -> str:
    w = w.lower()
    return w[:-1] if len(w) > 4 and w.endswith("s") else w


class RecModel:
    def __init__(
        self, items: list[Item], features: ContentFeatures, cf: ImplicitCF, manifest: dict | None = None
    ):
        self.items = items
        self.features = features
        self.cf = cf
        self.manifest = manifest or {}
        self.index: dict[str, int] = {}
        for i, it in enumerate(items):
            self.index[it.id] = i
            self.index[it.slug] = i
        self.kinds = np.array([it.kind for it in items])
        self._theme_words = {t: {_stem(w) for w in t.split() if len(w) > 3} for t in features.themes}

    # ── training ──────────────────────────────────────────────────────────
    @classmethod
    def train(
        cls,
        items: list[Item],
        interactions: list[Interaction],
        *,
        lsa_dims: int = 64,
        cf_factors: int = 24,
        seed: int = 0,
    ) -> "RecModel":
        features = ContentFeatures.fit(items, lsa_dims=lsa_dims, seed=seed)
        index = {it.slug: i for i, it in enumerate(items)} | {it.id: i for i, it in enumerate(items)}
        matrix, users = interaction_matrix(interactions, index, len(items))
        cf = ImplicitCF.fit(matrix, k=cf_factors, seed=seed)
        manifest = {
            "params": {
                "lsaDims": features.components.shape[0],
                "cfFactors": cf.item_factors.shape[0],
                "seed": seed,
            },
            "training": {
                "items": len(items),
                "users": len(users),
                "interactions": int(matrix.nnz),
                "cfReconstructionErr": round(cf.reconstruction_err, 4),
            },
            "vocabulary": len(features.vocabulary),
        }
        return cls(items, features, cf, manifest)

    @property
    def version_label(self) -> str:
        v = self.manifest.get("version")
        return f"recsys-hybrid v{v}" if v else "recsys-hybrid (unsaved)"

    def _idx(self, key: str) -> int | None:
        return self.index.get(key)

    # ── profile → factor arrays ───────────────────────────────────────────
    def factors(self, profile: Profile) -> tuple[dict[str, np.ndarray], dict]:
        f = self.features
        n = len(self.items)
        pos = {i: w for k, w in profile.positives.items() if (i := self._idx(k)) is not None and w > 0}
        neg = [i for k in profile.negatives if (i := self._idx(k)) is not None]

        sem_parts: list[tuple[float, np.ndarray]] = []
        tf_parts: list[tuple[float, np.ndarray]] = []
        if pos:
            idx = np.fromiter(pos.keys(), dtype=np.int64)
            w = np.fromiter(pos.values(), dtype=np.float32)
            sem_parts.append((PART_WEIGHTS["history"], _unit(w @ f.embeddings[idx])))
            tf_parts.append((PART_WEIGHTS["history"], _unit(np.asarray(f.tfidf[idx].T @ w).ravel())))
        query = profile.query.strip()
        declared = " ".join([*profile.genres, *profile.moods, *profile.themes]).strip()
        texts = [(PART_WEIGHTS["query"], query), (PART_WEIGHTS["declared"], declared)]
        # Free text has no theme labels: borrow them from the closest catalog items (pseudo-relevance feedback).
        text_themes: list[tuple[float, np.ndarray]] = []
        for weight, text in texts:
            if text:
                x = f.transform([text])
                if x.nnz:
                    e = f.embed(x)[0]
                    sem_parts.append((weight, e))
                    tf_parts.append((weight, np.asarray(x.todense()).ravel()))
                    text_themes.append((weight, e))
        ctx_vecs: list[np.ndarray] = []
        if profile.context:
            cx = f.transform([c.text for c in profile.context])
            ce = f.embed(cx)
            cw = np.array([max(0.0, c.weight) for c in profile.context], dtype=np.float32)
            ctx_vecs = list(ce)
            if cx.nnz and cw.sum() > 0:
                sem_parts.append((PART_WEIGHTS["context"], _unit(cw @ ce)))
                tf_parts.append((PART_WEIGHTS["context"], _unit(np.asarray(cx.T @ cw).ravel())))
                text_themes.extend(
                    (PART_WEIGHTS["context"] * w, e) for w, e in zip(cw, ce, strict=True) if e.any()
                )

        def blend(parts: list[tuple[float, np.ndarray]]) -> np.ndarray | None:
            if not parts:
                return None
            v = _unit(sum(w * _unit(p) for w, p in parts))
            return v if np.any(v) else None

        sem_u = blend(sem_parts)
        tf_u = blend(tf_parts)
        semantic = np.clip(f.embeddings @ sem_u, 0, 1) if sem_u is not None else np.zeros(n, np.float32)
        tfidf = (
            np.clip(np.asarray(f.tfidf @ tf_u).ravel(), 0, 1) if tf_u is not None else np.zeros(n, np.float32)
        )

        tidx = f.theme_index()
        theme_u = np.zeros(len(f.themes), dtype=np.float32)
        if pos:
            for i, w in pos.items():
                theme_u += w * f.theme_matrix[i]
        for t in profile.themes:
            if t in tidx:
                theme_u[tidx[t]] += 1.0
        for text, weight in [(query, 1.0), *[(c.text, 0.5) for c in profile.context]]:
            words = {_stem(w) for w in text.replace("-", " ").split()}
            for t, tw in self._theme_words.items():
                if tw and tw <= words:
                    theme_u[tidx[t]] += weight
        for weight, e in text_themes:
            sims = f.embeddings @ e
            near = np.argsort(-sims)[:PRF_ITEMS]
            near = near[sims[near] > 0]
            if len(near):
                theme_u += weight * _unit(sims[near] @ f.theme_matrix[near])
        theme_u = _unit(theme_u)
        theme = np.clip(f.theme_matrix @ theme_u, 0, 1) if theme_u.any() else np.zeros(n, np.float32)

        pref_parts = []
        cf_scores = self.cf.scores(pos) if pos else None
        if cf_scores is not None:
            pref_parts.append(cf_scores)
        q = (
            " "
            + query.lower().replace("science fiction", "sci-fi").replace("science-fiction", "sci-fi")
            + " "
        )
        genres = set(profile.genres) | {g for g in f.genres if f" {g.lower()}" in q}
        moods = set(profile.moods) | {m for m in f.moods if f" {m.lower()}" in q}
        gsel = [f.genres.index(g) for g in sorted(genres) if g in f.genres]
        msel = [f.moods.index(m) for m in sorted(moods) if m in f.moods]
        if gsel:
            pref_parts.append(f.genre_matrix[:, gsel].max(axis=1))
        if msel:
            pref_parts.append(f.mood_matrix[:, msel].max(axis=1))
        preference = np.mean(pref_parts, axis=0).astype(np.float32) if pref_parts else np.zeros(n, np.float32)

        penalty = np.zeros(n, np.float32)
        if neg:
            penalty = DISLIKE_PENALTY * np.clip(f.embeddings @ f.embeddings[neg].T, 0, 1).max(axis=1)

        arrays = {
            "semantic": semantic.astype(np.float32),
            "tfidf": tfidf.astype(np.float32),
            "theme": theme.astype(np.float32),
            "preference": preference,
            "prior": f.prior,
            "collaborative": cf_scores if cf_scores is not None else np.zeros(n, np.float32),
            "penalty": penalty.astype(np.float32),
        }
        info = {
            "pos": pos,
            "neg": neg,
            "theme_u": theme_u,
            "ctx": ctx_vecs,
            "has": {
                "semantic": sem_u is not None,
                "tfidf": tf_u is not None,
                "theme": bool(theme_u.any()),
                "collaborative": cf_scores is not None,
            },
        }
        return arrays, info

    # ── recommend ─────────────────────────────────────────────────────────
    def recommend(self, profile: Profile, req: Request) -> dict:
        t0 = time.perf_counter()
        n = len(self.items)
        w = effective_weights(req.weights)
        arrays, info = self.factors(profile)

        blocked = np.zeros(n, dtype=bool)
        for key in [*profile.exclude, *profile.negatives, *profile.positives]:
            if (i := self._idx(key)) is not None:
                blocked[i] = True
        passes = np.ones(n, dtype=bool)
        if req.kind:
            passes &= self.kinds == req.kind
        f = self.features
        gsel = [f.genres.index(g) for g in req.genres if g in f.genres]
        msel = [f.moods.index(m) for m in req.moods if m in f.moods]
        if req.genres:
            passes &= f.genre_matrix[:, gsel].max(axis=1) > 0 if gsel else False
        if req.moods:
            passes &= f.mood_matrix[:, msel].max(axis=1) > 0 if msel else False
        eligible = passes & ~blocked

        sources: dict[str, int] = {}
        cand = np.zeros(n, dtype=bool)
        for key, size in CANDIDATES.items():
            if not info["has"][key]:
                continue
            vals = np.where(eligible & (arrays[key] > 0), arrays[key], -1.0)
            top = np.argsort(-vals, kind="stable")[:size]
            top = top[vals[top] > 0]
            sources[key] = int(len(top))
            cand[top] = True
        cold = not cand.any()
        if cold:
            vals = np.where(eligible, arrays["prior"], -1.0)
            top = np.argsort(-vals, kind="stable")[:COLD_START_POOL]
            top = top[vals[top] >= 0]
            sources["prior"] = int(len(top))
            cand[top] = True

        score = sum(w[k] * arrays[k] for k in FACTORS) - arrays["penalty"]
        cidx = np.flatnonzero(cand)
        order = cidx[np.argsort(-score[cidx], kind="stable")]
        base_rank = {int(i): r + 1 for r, i in enumerate(order)}

        picked, adjust, skipped, media_cap = self._mmr(order[:MMR_POOL], score, req)
        items = [
            self._explain(
                int(i), r + 1, base_rank[int(i)], score, arrays, w, adjust[int(i)], info, profile, cold
            )
            for r, i in enumerate(picked)
        ]
        return {
            "modelVersion": self.version_label,
            "weights": w,
            "lambda": req.mmr_lambda,
            "coldStart": cold,
            "items": items,
            "stages": {
                "candidates": {**sources, "unique": int(cand.sum())},
                "eligible": int(eligible.sum()),
                "excluded": int((passes & blocked).sum()),
                "filteredOut": int((~passes).sum()),
                "scored": int(len(order)),
                "diversity": {
                    "lambda": req.mmr_lambda,
                    "perCreator": req.per_creator,
                    "perFranchise": req.per_franchise,
                    "mediaCap": media_cap,
                    "skippedByCaps": skipped,
                },
                "final": len(items),
            },
            "profile": {
                "positives": len(info["pos"]),
                "negatives": len(info["neg"]),
                "query": bool(profile.query.strip()),
                "context": len(profile.context),
                "topThemes": [
                    f.themes[i] for i in np.argsort(-info["theme_u"])[:5] if info["theme_u"][i] > 0
                ],
            },
            "latencyMs": round((time.perf_counter() - t0) * 1000, 2),
        }

    def _mmr(
        self, pool: np.ndarray, score: np.ndarray, req: Request
    ) -> tuple[list[int], dict[int, float], int, int | None]:
        if len(pool) == 0:
            return [], {}, 0, None
        lam = req.mmr_lambda
        s = score[pool]
        span = float(s.max() - s.min())
        s_norm = (s - s.min()) / span if span > 0 else np.ones_like(s)
        emb = self.features.embeddings[pool]
        kinds = self.kinds[pool]
        media_cap = None
        if req.balance_media and req.kind is None and len(set(kinds.tolist())) > 1:
            media_cap = math.ceil(0.6 * req.k)
        taken = np.zeros(len(pool), dtype=bool)
        maxsim = np.zeros(len(pool), dtype=np.float32)
        creators: dict[str, int] = {}
        franchises: dict[str, int] = {}
        kind_count: dict[str, int] = {}
        picked: list[int] = []
        adjust: dict[int, float] = {}
        skipped: set[int] = set()
        while len(picked) < req.k:
            allowed = ~taken
            for j in np.flatnonzero(allowed):
                it = self.items[int(pool[j])]
                if (
                    any(creators.get(c, 0) >= req.per_creator for c in it.creators)
                    or (it.franchise and franchises.get(it.franchise, 0) >= req.per_franchise)
                    or (media_cap is not None and kind_count.get(it.kind, 0) >= media_cap)
                ):
                    allowed[j] = False
                    skipped.add(j)
            if not allowed.any():
                if media_cap is not None:
                    media_cap = None
                    continue
                break
            val = np.where(allowed, lam * s_norm - (1 - lam) * maxsim, -np.inf)
            j = int(np.argmax(val))
            i = int(pool[j])
            it = self.items[i]
            picked.append(i)
            adjust[i] = -(1 - lam) * float(maxsim[j])
            taken[j] = True
            skipped.discard(j)
            for c in it.creators:
                creators[c] = creators.get(c, 0) + 1
            if it.franchise:
                franchises[it.franchise] = franchises.get(it.franchise, 0) + 1
            kind_count[it.kind] = kind_count.get(it.kind, 0) + 1
            maxsim = np.maximum(maxsim, emb @ emb[j])
        return picked, adjust, len(skipped), media_cap

    def _explain(self, i, rank, base_rank, score, arrays, w, diversity, info, profile, cold) -> dict:
        it = self.items[i]
        f = self.features
        factors = [
            {
                "key": k,
                "label": LABELS[k],
                "value": round(float(arrays[k][i]), 4),
                "weight": w[k],
                "contribution": round(float(w[k] * arrays[k][i]), 4),
            }
            for k in FACTORS
        ]
        adjustments = []
        if arrays["penalty"][i] > 0:
            adjustments.append(
                {
                    "key": "dislike",
                    "label": "Similar to something you passed on",
                    "contribution": round(-float(arrays["penalty"][i]), 4),
                }
            )
        if diversity < 0:
            adjustments.append(
                {"key": "diversity", "label": "Diversity adjustment", "contribution": round(diversity, 4)}
            )
        tidx = f.theme_index()
        theme_u = info["theme_u"]
        shared = sorted((t for t in it.themes if theme_u[tidx[t]] > 0), key=lambda t: -theme_u[tidx[t]])[:3]

        because = None
        best = 0.3
        for j in info["pos"]:
            sim = float(f.embeddings[i] @ f.embeddings[j])
            if sim > best:
                best, because = sim, {"kind": "item", "id": self.items[j].id, "title": self.items[j].title}
        for c, vec in zip(profile.context, info["ctx"], strict=False):
            sim = float(f.embeddings[i] @ vec)
            if sim > best:
                best, because = sim, {"kind": "library", "title": c.title}

        top = max(factors, key=lambda x: x["contribution"])["key"]
        kind = "book" if it.kind == "BOOK" else "film"
        if cold:
            rationale = (
                f"A well-rated {it.genres[0].lower() if it.genres else ''} {kind} to start with.".replace(
                    "  ", " "
                )
            )
        elif because and shared:
            rationale = f"Shares the {_join(shared[:2])} themes of {because['title']}."
        elif because:
            rationale = f"Close in subject and tone to {because['title']}."
        elif shared:
            rationale = f"Matches your interest in {_join(shared[:2])}."
        elif top in ("semantic", "tfidf") and profile.query.strip():
            rationale = "Close to what you described."
        elif top == "preference" and (profile.genres or profile.moods):
            picks = [g for g in it.genres if g in profile.genres] + [
                m for m in it.moods if m in profile.moods
            ]
            rationale = (
                f"Fits your taste for {_join([p.lower() for p in picks[:2]])}."
                if picks
                else "Fits the tastes you chose."
            )
        else:
            rationale = f"Rated well by readers with similar taste{'s' if kind == 'book' else ''}."
        return {
            "id": it.id,
            "slug": it.slug,
            "kind": it.kind,
            "title": it.title,
            "rank": rank,
            "baseRank": base_rank,
            "score": round(float(score[i]), 4),
            "factors": factors,
            "adjustments": adjustments,
            "sharedThemes": shared,
            "becauseOf": because,
            "rationale": rationale,
        }

    def similar(self, key: str, k: int = 6, other_kind: bool = False) -> list[dict]:
        i = self._idx(key)
        if i is None:
            return []
        it = self.items[i]
        sims = self.features.embeddings @ self.features.embeddings[i]
        sims[i] = -1.0
        if other_kind:
            sims = np.where(self.kinds != it.kind, sims, -1.0)
        out = []
        for j in np.argsort(-sims)[:k]:
            if sims[j] <= 0:
                break
            o = self.items[int(j)]
            out.append(
                {
                    "id": o.id,
                    "slug": o.slug,
                    "kind": o.kind,
                    "title": o.title,
                    "similarity": round(float(sims[j]), 4),
                    "sharedThemes": [t for t in o.themes if t in it.themes],
                }
            )
        return out
