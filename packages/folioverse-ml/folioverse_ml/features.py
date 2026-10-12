"""Content features: TF-IDF, dense LSA embeddings, theme/genre/mood vectors and a capped quality prior.

TF-IDF is computed here (counts from scikit-learn, sublinear tf, smoothed idf, L2 rows) so the fitted
state is plain arrays: vocabulary, idf and the SVD components. Artifacts never need pickles.
"""

import math
from dataclasses import dataclass

import numpy as np
from scipy import sparse
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import CountVectorizer

from .data import Item

WORD_PATTERN = r"(?u)\b[a-zA-Z][a-zA-Z-]+\b"


def _rownorm(m: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(m, axis=1, keepdims=True)
    n[n == 0] = 1.0
    return m / n


def _counter(vocabulary: list[str] | None = None, min_df: int = 1) -> CountVectorizer:
    return CountVectorizer(
        lowercase=True,
        stop_words="english",
        ngram_range=(1, 2),
        token_pattern=WORD_PATTERN,
        min_df=min_df,
        vocabulary=vocabulary,
        dtype=np.float32,
    )


@dataclass
class ContentFeatures:
    vocabulary: list[str]
    idf: np.ndarray  # (V,)
    components: np.ndarray  # (d, V) LSA basis
    themes: list[str]
    genres: list[str]
    moods: list[str]
    tfidf: sparse.csr_matrix  # (N, V), L2 rows
    embeddings: np.ndarray  # (N, d), L2 rows
    theme_matrix: np.ndarray  # (N, T), L2 rows of theme weights
    genre_matrix: np.ndarray  # (N, G) 0/1
    mood_matrix: np.ndarray  # (N, M) 0/1
    prior: np.ndarray  # (N,) in [0, 1]

    @classmethod
    def fit(cls, items: list[Item], lsa_dims: int = 64, seed: int = 0) -> "ContentFeatures":
        cv = _counter(min_df=2)
        counts = cv.fit_transform([it.text for it in items]).tocsr()
        vocab = [t for t, _ in sorted(cv.vocabulary_.items(), key=lambda kv: kv[1])]
        df = np.asarray((counts > 0).sum(axis=0)).ravel()
        n = counts.shape[0]
        idf = (np.log((1 + n) / (1 + df)) + 1.0).astype(np.float32)
        tfidf = _weight(counts, idf)
        dims = max(2, min(lsa_dims, min(tfidf.shape) - 1))
        svd = TruncatedSVD(n_components=dims, random_state=seed, n_iter=7)
        svd.fit(tfidf)
        components = svd.components_.astype(np.float32)
        return cls.from_state(items, vocab, idf, components)

    @classmethod
    def from_state(
        cls, items: list[Item], vocabulary: list[str], idf: np.ndarray, components: np.ndarray
    ) -> "ContentFeatures":
        themes = sorted({t for it in items for t in it.themes})
        genres = sorted({g for it in items for g in it.genres})
        moods = sorted({m for it in items for m in it.moods})
        tidx = {t: i for i, t in enumerate(themes)}
        gidx = {g: i for i, g in enumerate(genres)}
        midx = {m: i for i, m in enumerate(moods)}
        theme_m = np.zeros((len(items), len(themes)), dtype=np.float32)
        genre_m = np.zeros((len(items), len(genres)), dtype=np.float32)
        mood_m = np.zeros((len(items), len(moods)), dtype=np.float32)
        for r, it in enumerate(items):
            for t, w in it.themes.items():
                theme_m[r, tidx[t]] = w
            for g in it.genres:
                genre_m[r, gidx[g]] = 1.0
            for m in it.moods:
                mood_m[r, midx[m]] = 1.0
        f = cls(
            vocabulary=list(vocabulary),
            idf=np.asarray(idf, dtype=np.float32),
            components=np.asarray(components, dtype=np.float32),
            themes=themes,
            genres=genres,
            moods=moods,
            tfidf=sparse.csr_matrix((len(items), len(vocabulary)), dtype=np.float32),
            embeddings=np.zeros((len(items), components.shape[0]), dtype=np.float32),
            theme_matrix=_rownorm(theme_m),
            genre_matrix=genre_m,
            mood_matrix=mood_m,
            prior=_prior(items),
        )
        f.tfidf = f.transform([it.text for it in items])
        f.embeddings = f.embed(f.tfidf)
        return f

    def transform(self, texts: list[str]) -> sparse.csr_matrix:
        counts = _counter(self.vocabulary).transform(texts).tocsr()
        return _weight(counts, self.idf)

    def embed(self, tfidf: sparse.csr_matrix) -> np.ndarray:
        return _rownorm(np.asarray(tfidf @ self.components.T, dtype=np.float32))

    def theme_index(self) -> dict[str, int]:
        return {t: i for i, t in enumerate(self.themes)}


def _weight(counts: sparse.csr_matrix, idf: np.ndarray) -> sparse.csr_matrix:
    m = counts.astype(np.float32).tocsr(copy=True)
    m.data = 1.0 + np.log(m.data)
    m = m @ sparse.diags(idf)
    norms = np.sqrt(np.asarray(m.multiply(m).sum(axis=1)).ravel())
    norms[norms == 0] = 1.0
    return sparse.diags(1.0 / norms) @ m


def _prior(items: list[Item]) -> np.ndarray:
    """0.6 × normalised rating + 0.4 × normalised log popularity, in [0, 1]. Its weight is capped by the scorer."""
    q = np.array([it.quality for it in items], dtype=np.float32)
    p = np.array([math.log1p(max(0, it.popularity)) for it in items], dtype=np.float32)

    def norm(x: np.ndarray) -> np.ndarray:
        span = float(x.max() - x.min()) if len(x) else 0.0
        return (x - x.min()) / span if span > 0 else np.zeros_like(x)

    return (0.6 * norm(q) + 0.4 * norm(p)).astype(np.float32)
