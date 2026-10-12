"""Implicit collaborative filtering: NMF item factors with NNLS fold-in, and an item-kNN baseline.

Users of the product are not in the training matrix. A request folds the user's positive items into
the factor space (non-negative least squares against the item factors), so no retraining is needed.
"""

from dataclasses import dataclass

import numpy as np
from scipy import sparse
from scipy.optimize import nnls
from sklearn.decomposition import NMF

from .data import Interaction


def interaction_matrix(
    interactions: list[Interaction], item_index: dict[str, int], n_items: int
) -> tuple[sparse.csr_matrix, list[str]]:
    users = sorted({i.user for i in interactions})
    uidx = {u: k for k, u in enumerate(users)}
    rows, cols, vals = [], [], []
    for i in interactions:
        col = item_index.get(i.item)
        if col is None:
            continue
        rows.append(uidx[i.user])
        cols.append(col)
        vals.append(i.weight)
    m = sparse.csr_matrix((vals, (rows, cols)), shape=(len(users), n_items), dtype=np.float32)
    m.sum_duplicates()
    m.data = np.minimum(m.data, 1.0)
    return m, users


@dataclass
class ImplicitCF:
    item_factors: np.ndarray  # (k, N)
    item_similarity: np.ndarray | None = None  # (N, N) cosine over user columns, for the kNN baseline
    reconstruction_err: float = 0.0

    @classmethod
    def fit(cls, matrix: sparse.csr_matrix, k: int = 24, seed: int = 0, knn: bool = True) -> "ImplicitCF":
        k = max(1, min(k, min(matrix.shape) - 1))
        model = NMF(n_components=k, init="nndsvda", max_iter=500, random_state=seed, alpha_W=0.0, alpha_H=0.0)
        model.fit(matrix)
        sim = None
        if knn:
            cols = matrix.T.tocsr().astype(np.float32)
            norms = np.sqrt(np.asarray(cols.multiply(cols).sum(axis=1)).ravel())
            norms[norms == 0] = 1.0
            unit = sparse.diags(1.0 / norms) @ cols
            sim = np.asarray((unit @ unit.T).todense(), dtype=np.float32)
            np.fill_diagonal(sim, 0.0)
        return cls(model.components_.astype(np.float32), sim, float(model.reconstruction_err_))

    @property
    def n_items(self) -> int:
        return self.item_factors.shape[1]

    def fold_in(self, positives: dict[int, float]) -> np.ndarray | None:
        if not positives:
            return None
        x = np.zeros(self.n_items, dtype=np.float64)
        for i, w in positives.items():
            x[i] = w
        u, _ = nnls(self.item_factors.T.astype(np.float64), x)
        return u if u.any() else None

    def scores(self, positives: dict[int, float]) -> np.ndarray:
        """NMF scores in [0, 1] (divided by the maximum); zeros when the user has no positives."""
        u = self.fold_in(positives)
        if u is None:
            return np.zeros(self.n_items, dtype=np.float32)
        s = (u @ self.item_factors).astype(np.float32)
        top = float(s.max())
        return s / top if top > 0 else s

    def knn_scores(self, positives: dict[int, float]) -> np.ndarray:
        if self.item_similarity is None or not positives:
            return np.zeros(self.n_items, dtype=np.float32)
        idx = np.fromiter(positives.keys(), dtype=np.int64)
        w = np.fromiter(positives.values(), dtype=np.float32)
        s = (w @ self.item_similarity[idx]).astype(np.float32)
        top = float(s.max())
        return s / top if top > 0 else s
