"""Dense + sparse embedders behind one protocol.

`hash` is a deterministic feature-hashing embedder used in tests/CI (no downloads).
`fastembed` runs BAAI/bge-small-en-v1.5 (dense, 384-d) and Qdrant/bm25 (sparse) on ONNX Runtime.
"""

import hashlib
import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

from ..settings import get_settings
from ..text import content_words


@dataclass
class Sparse:
    indices: list[int]
    values: list[float]


class Embedder(Protocol):
    name: str
    dims: int
    abstain_threshold: float

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...
    def embed_query(self, text: str) -> list[float]: ...
    def sparse_documents(self, texts: list[str]) -> list[Sparse]: ...
    def sparse_query(self, text: str) -> Sparse: ...


def _h(token: str, mod: int) -> int:
    return int.from_bytes(hashlib.blake2b(token.encode(), digest_size=8).digest(), "big") % mod


class HashEmbedder:
    name = "hash-384"
    dims = 384
    abstain_threshold = 0.12

    def _dense(self, text: str) -> list[float]:
        v = [0.0] * self.dims
        words = content_words(text)
        grams = words + [f"{a}_{b}" for a, b in zip(words, words[1:], strict=False)]
        for g in grams:
            idx = _h(g, self.dims)
            sign = 1.0 if _h("s" + g, 2) else -1.0
            v[idx] += sign
        n = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / n for x in v]

    def _sparse(self, text: str) -> Sparse:
        tf: dict[int, float] = {}
        for w in content_words(text):
            i = _h(w, 2**31 - 1)
            tf[i] = tf.get(i, 0.0) + 1.0
        items = sorted(tf.items())
        return Sparse([i for i, _ in items], [1.0 + math.log(v) for _, v in items])

    def embed_documents(self, texts):
        return [self._dense(t) for t in texts]

    def embed_query(self, text):
        return self._dense(text)

    def sparse_documents(self, texts):
        return [self._sparse(t) for t in texts]

    def sparse_query(self, text):
        return self._sparse(text)


class FastEmbedder:
    abstain_threshold = 0.55

    def __init__(self, dense_model: str, sparse_model: str):
        from fastembed import SparseTextEmbedding, TextEmbedding

        self._dense = TextEmbedding(dense_model)
        self._sparse = SparseTextEmbedding(sparse_model)
        self.name = f"fastembed:{dense_model}+{sparse_model}"
        self.dims = len(next(iter(self._dense.embed(["dimension probe"]))))

    def embed_documents(self, texts):
        return [list(map(float, v)) for v in self._dense.embed(texts)]

    def embed_query(self, text):
        return list(map(float, next(iter(self._dense.query_embed(text)))))

    def sparse_documents(self, texts):
        return [Sparse(e.indices.tolist(), e.values.tolist()) for e in self._sparse.embed(texts)]

    def sparse_query(self, text):
        e = next(iter(self._sparse.query_embed(text)))
        return Sparse(e.indices.tolist(), e.values.tolist())


@lru_cache
def get_embedder() -> Embedder:
    s = get_settings()
    if s.embedder == "fastembed":
        return FastEmbedder(s.dense_model, s.sparse_model)
    return HashEmbedder()


class Reranker:
    """Optional local cross-encoder (FV_RERANK=1)."""

    def __init__(self, model: str):
        from fastembed.rerank.cross_encoder import TextCrossEncoder

        self._m = TextCrossEncoder(model_name=model)
        self.name = model

    def score(self, query: str, docs: list[str]) -> list[float]:
        return [float(x) for x in self._m.rerank(query, docs)]


@lru_cache
def get_reranker() -> Reranker | None:
    s = get_settings()
    if not s.rerank:
        return None
    try:
        return Reranker(s.rerank_model)
    except Exception:  # model unavailable offline: reranking silently disabled and reported in X-Ray
        return None
