"""LangGraph checkpointer (memory for tests/dev, Postgres for real runs) and the time-machine helpers."""

from typing import Any

from langgraph.checkpoint.memory import InMemorySaver

from ..settings import get_settings
from .runtime import summarize

_saver: Any = None


async def get_checkpointer():
    global _saver
    if _saver is not None:
        return _saver
    s = get_settings()
    if s.checkpointer == "postgres" and s.database_url:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        from psycopg.rows import dict_row
        from psycopg_pool import AsyncConnectionPool

        dsn = s.database_url.split("?")[0]
        async with await __import__("psycopg").AsyncConnection.connect(dsn, autocommit=True) as conn:
            await conn.execute("CREATE SCHEMA IF NOT EXISTS langgraph")
        pool = AsyncConnectionPool(
            dsn,
            min_size=1,
            max_size=20,
            open=False,
            kwargs={
                "autocommit": True,
                "prepare_threshold": 0,
                "row_factory": dict_row,
                "options": "-c search_path=langgraph",
            },
        )
        await pool.open()
        saver = AsyncPostgresSaver(pool)
        await saver.setup()
        _saver = saver
    else:
        _saver = InMemorySaver()
    return _saver


def reset_checkpointer() -> None:
    global _saver
    _saver = None


def _next_nodes(values: dict) -> list[str]:
    return sorted(k.split(":", 2)[2] for k in values if k.startswith("branch:to:"))


def _state_values(values: dict) -> dict:
    return {k: v for k, v in values.items() if not k.startswith("branch:") and not k.startswith("__")}


async def list_checkpoints(run_id: str) -> list[dict]:
    saver = await get_checkpointer()
    out = []
    async for t in saver.alist({"configurable": {"thread_id": run_id}}):
        values = t.checkpoint.get("channel_values", {})
        out.append(
            {
                "checkpointId": t.checkpoint["id"],
                "parentCheckpointId": (t.parent_config or {}).get("configurable", {}).get("checkpoint_id"),
                "step": t.metadata.get("step"),
                "source": t.metadata.get("source"),
                "createdAt": t.checkpoint.get("ts"),
                "next": _next_nodes(values),
                "state": summarize(_state_values(values)),
            }
        )
    out.sort(key=lambda c: c["step"] if c["step"] is not None else -2)
    return out


async def copy_checkpoint(parent_run_id: str, checkpoint_id: str, new_run_id: str, overrides: dict) -> bool:
    """Forks: copies a parent checkpoint into the new run's thread, applying input overrides."""
    saver = await get_checkpointer()
    t = await saver.aget_tuple(
        {"configurable": {"thread_id": parent_run_id, "checkpoint_ns": "", "checkpoint_id": checkpoint_id}}
    )
    if t is None:
        return False
    cp = dict(t.checkpoint)
    values = dict(cp.get("channel_values", {}))
    versions = dict(cp.get("channel_versions", {}))
    for k, v in overrides.items():
        if v is not None and k in values and values[k] != v:
            values[k] = v
    cp["channel_values"] = values
    meta = dict(t.metadata or {}) | {
        "source": "fork",
        "forkedFrom": {"runId": parent_run_id, "checkpointId": checkpoint_id},
    }
    await saver.aput({"configurable": {"thread_id": new_run_id, "checkpoint_ns": ""}}, cp, meta, versions)
    return True
