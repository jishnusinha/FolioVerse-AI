"""Persistence for derived AI data (schema `ai`) and usage events (`app.usage_events`).

Prisma owns migrations; this module only reads/writes rows. `MemoryRepo` mirrors the behaviour
for unit tests so the AI service is testable without Postgres.
"""

import json
from functools import lru_cache
from typing import Any, Protocol

from .ids import uuid7
from .settings import get_settings


class Repo(Protocol):
    async def replace_version(
        self, workspace_id: str, svid: str, pages: list[dict], chunks: list[dict], manifest: dict
    ) -> None: ...
    async def delete_versions(self, svids: list[str]) -> None: ...
    async def get_chunks(self, ids: list[str]) -> dict[str, dict]: ...
    async def version_chunks(self, svid: str, level: str = "PARENT", limit: int = 400) -> list[dict]: ...
    async def page_text(self, svid: str, page: int) -> str | None: ...
    async def insert_retrieval_event(self, row: dict) -> None: ...
    async def insert_usage_event(self, row: dict) -> str: ...
    async def ping(self) -> bool: ...


class MemoryRepo:
    def __init__(self):
        self.chunks: dict[str, dict] = {}
        self.pages: dict[tuple[str, int], dict] = {}
        self.manifests: dict[str, dict] = {}
        self.retrieval_events: list[dict] = []
        self.usage_events: list[dict] = []

    async def replace_version(self, workspace_id, svid, pages, chunks, manifest):
        await self.delete_versions([svid])
        for p in pages:
            self.pages[(svid, p["page_no"])] = {**p, "workspace_id": workspace_id, "source_version_id": svid}
        for c in chunks:
            self.chunks[c["id"]] = {**c, "workspace_id": workspace_id, "source_version_id": svid}
        self.manifests[svid] = manifest

    async def delete_versions(self, svids):
        for k in [k for k, v in self.chunks.items() if v["source_version_id"] in svids]:
            del self.chunks[k]
        for k in [k for k in self.pages if k[0] in svids]:
            del self.pages[k]
        for s in svids:
            self.manifests.pop(s, None)

    async def get_chunks(self, ids):
        return {i: self.chunks[i] for i in ids if i in self.chunks}

    async def version_chunks(self, svid, level="PARENT", limit=400):
        rows = [c for c in self.chunks.values() if c["source_version_id"] == svid and c["level"] == level]
        return sorted(rows, key=lambda c: c["ordinal"])[:limit]

    async def page_text(self, svid, page):
        p = self.pages.get((svid, page))
        return p["text"] if p else None

    async def insert_retrieval_event(self, row):
        self.retrieval_events.append(row)

    async def insert_usage_event(self, row):
        row = {"id": row.get("id") or uuid7(), **row}
        self.usage_events.append(row)
        return row["id"]

    async def ping(self):
        return True


class PostgresRepo:
    def __init__(self, dsn: str):
        from psycopg_pool import AsyncConnectionPool

        # Prisma URLs may carry ?schema=...; psycopg rejects unknown params.
        self.dsn = dsn.split("?")[0]
        self.pool = AsyncConnectionPool(self.dsn, min_size=1, max_size=8, open=False, timeout=15)
        self._opened = False

    async def _conn(self):
        if not self._opened:
            await self.pool.open()
            self._opened = True
        return self.pool.connection()

    async def replace_version(self, workspace_id, svid, pages, chunks, manifest):
        async with await self._conn() as conn, conn.transaction():
            await conn.execute("DELETE FROM ai.chunks WHERE source_version_id = %s", (svid,))
            await conn.execute("DELETE FROM ai.source_pages WHERE source_version_id = %s", (svid,))
            async with conn.cursor() as cur:
                await cur.executemany(
                    "INSERT INTO ai.source_pages (id, workspace_id, source_version_id, page_no, text, width, height) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                    [
                        (
                            uuid7(),
                            workspace_id,
                            svid,
                            p["page_no"],
                            p["text"],
                            p.get("width"),
                            p.get("height"),
                        )
                        for p in pages
                    ],
                )
                await cur.executemany(
                    """INSERT INTO ai.chunks (id, workspace_id, source_version_id, parent_id, level, ordinal, text, token_count,
                       page_start, page_end, locator, heading_path) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    [
                        (
                            c["id"],
                            workspace_id,
                            svid,
                            c.get("parent_id"),
                            c["level"],
                            c["ordinal"],
                            c["text"],
                            c["token_count"],
                            c.get("page_start"),
                            c.get("page_end"),
                            json.dumps(c.get("locator", {})),
                            c.get("heading_path", []),
                        )
                        for c in chunks
                    ],
                )
            await conn.execute(
                """INSERT INTO ai.index_manifests (id, workspace_id, source_version_id, collection, embedder, dims, parent_count, child_count)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (source_version_id) DO UPDATE SET collection = EXCLUDED.collection, embedder = EXCLUDED.embedder,
                     dims = EXCLUDED.dims, parent_count = EXCLUDED.parent_count, child_count = EXCLUDED.child_count, created_at = now()""",
                (
                    uuid7(),
                    workspace_id,
                    svid,
                    manifest["collection"],
                    manifest["embedder"],
                    manifest["dims"],
                    manifest["parent_count"],
                    manifest["child_count"],
                ),
            )

    async def delete_versions(self, svids):
        if not svids:
            return
        async with await self._conn() as conn, conn.transaction():
            for table in ("ai.chunks", "ai.source_pages", "ai.index_manifests"):
                await conn.execute(f"DELETE FROM {table} WHERE source_version_id = ANY(%s::uuid[])", (svids,))  # noqa: S608

    @staticmethod
    def _row(cols, r) -> dict[str, Any]:
        d = dict(zip(cols, r, strict=True))
        for k in ("id", "parent_id", "source_version_id", "workspace_id"):
            if d.get(k) is not None:
                d[k] = str(d[k])
        return d

    _COLS = "id, workspace_id, source_version_id, parent_id, level, ordinal, text, token_count, page_start, page_end, locator, heading_path"

    async def get_chunks(self, ids):
        if not ids:
            return {}
        async with await self._conn() as conn:
            cur = await conn.execute(f"SELECT {self._COLS} FROM ai.chunks WHERE id = ANY(%s::uuid[])", (ids,))  # noqa: S608
            cols = [d.name for d in cur.description]
            return {str(r[0]): self._row(cols, r) for r in await cur.fetchall()}

    async def version_chunks(self, svid, level="PARENT", limit=400):
        async with await self._conn() as conn:
            cur = await conn.execute(
                f"SELECT {self._COLS} FROM ai.chunks WHERE source_version_id = %s AND level = %s ORDER BY ordinal LIMIT %s",  # noqa: S608
                (svid, level, limit),
            )
            cols = [d.name for d in cur.description]
            return [self._row(cols, r) for r in await cur.fetchall()]

    async def page_text(self, svid, page):
        async with await self._conn() as conn:
            cur = await conn.execute(
                "SELECT text FROM ai.source_pages WHERE source_version_id = %s AND page_no = %s", (svid, page)
            )
            r = await cur.fetchone()
            return r[0] if r else None

    async def insert_retrieval_event(self, row):
        async with await self._conn() as conn:
            await conn.execute(
                """INSERT INTO ai.retrieval_events (id, workspace_id, run_id, query, params, candidates, packed, latency_ms)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    uuid7(),
                    row["workspace_id"],
                    row["run_id"],
                    row["query"],
                    json.dumps(row["params"]),
                    json.dumps(row["candidates"]),
                    json.dumps(row["packed"]),
                    row["latency_ms"],
                ),
            )

    async def insert_usage_event(self, row):
        uid = row.get("id") or uuid7()
        async with await self._conn() as conn:
            await conn.execute(
                """INSERT INTO app.usage_events (id, workspace_id, run_id, user_id, model_call_id, model_config_id, cost_class, provider, model,
                     input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, compute_seconds, reported, is_demo, feature)
                   VALUES (%s,%s,%s,%s,%s,%s,%s::app."CostClass",%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    uid,
                    row["workspace_id"],
                    row.get("run_id"),
                    row.get("user_id"),
                    row.get("model_call_id"),
                    row.get("model_config_id"),
                    row.get("cost_class", "AI_API"),
                    row["provider"],
                    row["model"],
                    row.get("input", 0),
                    row.get("output", 0),
                    row.get("cached_input", 0),
                    row.get("reasoning", 0),
                    row.get("compute_seconds"),
                    row.get("reported", True),
                    row.get("is_demo", False),
                    row.get("feature"),
                ),
            )
        return uid

    async def ping(self):
        try:
            async with await self._conn() as conn:
                await conn.execute("SELECT 1")
            return True
        except Exception:
            return False


_override: Repo | None = None


def set_repo(repo: Repo | None) -> None:
    global _override
    _override = repo
    get_repo.cache_clear()


@lru_cache
def get_repo() -> Repo:
    if _override is not None:
        return _override
    s = get_settings()
    if s.database_url:
        return PostgresRepo(s.database_url)
    return MemoryRepo()
