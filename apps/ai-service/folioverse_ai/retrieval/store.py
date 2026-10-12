"""Qdrant vector store with named dense + sparse (IDF) vectors."""

from functools import lru_cache

from qdrant_client import QdrantClient, models

from ..settings import get_settings
from .embedder import Sparse

DENSE = "dense"
SPARSE = "bm25"


class VectorStore:
    def __init__(self, client: QdrantClient, collection: str):
        self.client = client
        self.collection = collection
        self._ensured: int | None = None

    def ensure(self, dims: int) -> None:
        if self._ensured == dims:
            return
        if not self.client.collection_exists(self.collection):
            self.client.create_collection(
                self.collection,
                vectors_config={DENSE: models.VectorParams(size=dims, distance=models.Distance.COSINE)},
                sparse_vectors_config={SPARSE: models.SparseVectorParams(modifier=models.Modifier.IDF)},
            )
            for field in ("workspace_id", "source_version_id"):
                try:
                    self.client.create_payload_index(self.collection, field, models.PayloadSchemaType.KEYWORD)
                except Exception:  # noqa: S110 - local mode has no payload indexes
                    pass
        self._ensured = dims

    def upsert(
        self, ids: list[str], dense: list[list[float]], sparse: list[Sparse], payloads: list[dict]
    ) -> None:
        points = [
            models.PointStruct(
                id=i,
                vector={DENSE: d, SPARSE: models.SparseVector(indices=s.indices, values=s.values)},
                payload=p,
            )
            for i, d, s, p in zip(ids, dense, sparse, payloads, strict=True)
        ]
        for k in range(0, len(points), 128):
            self.client.upsert(self.collection, points=points[k : k + 128], wait=True)

    @staticmethod
    def scope_filter(
        workspace_id: str, source_version_ids: list[str] | tuple[str, ...], page_max: int | None = None
    ) -> models.Filter:
        must = [
            models.FieldCondition(key="workspace_id", match=models.MatchValue(value=workspace_id)),
            models.FieldCondition(
                key="source_version_id", match=models.MatchAny(any=list(source_version_ids))
            ),
        ]
        if page_max is not None:
            must.append(models.FieldCondition(key="page", range=models.Range(lte=page_max)))
        return models.Filter(must=must)

    def delete_versions(self, workspace_id: str, source_version_ids: list[str]) -> None:
        if not source_version_ids or not self.client.collection_exists(self.collection):
            return
        self.client.delete(
            self.collection,
            points_selector=models.FilterSelector(filter=self.scope_filter(workspace_id, source_version_ids)),
            wait=True,
        )

    def search_dense(self, vector: list[float], flt: models.Filter, limit: int):
        if not self.client.collection_exists(self.collection):
            return []
        return self.client.query_points(
            self.collection, query=vector, using=DENSE, query_filter=flt, limit=limit, with_payload=True
        ).points

    def search_sparse(self, sparse: Sparse, flt: models.Filter, limit: int):
        if not self.client.collection_exists(self.collection) or not sparse.indices:
            return []
        return self.client.query_points(
            self.collection,
            query=models.SparseVector(indices=sparse.indices, values=sparse.values),
            using=SPARSE,
            query_filter=flt,
            limit=limit,
            with_payload=True,
        ).points

    def ping(self) -> bool:
        try:
            self.client.get_collections()
            return True
        except Exception:
            return False


@lru_cache
def get_store() -> VectorStore:
    s = get_settings()
    client = (
        QdrantClient(location=":memory:")
        if s.qdrant_url == ":memory:"
        else QdrantClient(url=s.qdrant_url, timeout=30)
    )
    return VectorStore(client, s.qdrant_collection)
