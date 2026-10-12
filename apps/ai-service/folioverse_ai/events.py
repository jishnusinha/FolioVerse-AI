"""Event envelopes and NDJSON streaming for work units (contracts: event-envelope.schema.json)."""

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

HEARTBEAT_SECONDS = 10.0


def envelope(
    type_: str, data: dict[str, Any], seq: int, run_id: str | None = None, workspace_id: str | None = None
) -> dict:
    env: dict[str, Any] = {
        "schemaVersion": 1,
        "type": type_,
        "seq": seq,
        "ts": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "data": data,
    }
    if run_id:
        env["runId"] = run_id
    if workspace_id:
        env["workspaceId"] = workspace_id
    return env


class Emitter:
    """Collects events produced by graph nodes; the HTTP layer drains them as NDJSON lines."""

    def __init__(self, run_id: str | None = None, workspace_id: str | None = None):
        self.queue: asyncio.Queue[dict | None] = asyncio.Queue()
        self.seq = 0
        self.run_id = run_id
        self.workspace_id = workspace_id
        self.history: list[dict] = []

    async def emit(self, type_: str, data: dict[str, Any]) -> None:
        self.seq += 1
        env = envelope(type_, data, self.seq, self.run_id, self.workspace_id)
        if type_ != "token.delta":
            self.history.append(env)
        await self.queue.put(env)

    async def close(self) -> None:
        await self.queue.put(None)


async def ndjson_stream(emitter: Emitter, work: Callable[[], Awaitable[None]]) -> AsyncIterator[bytes]:
    """Runs `work` concurrently and yields each emitted event as one NDJSON line.

    Emits heartbeats while idle. If the client disconnects, the generator is closed and the
    work task is cancelled so no further model calls are made.
    """

    async def runner():
        try:
            await work()
        finally:
            await emitter.close()

    task = asyncio.create_task(runner())
    try:
        while True:
            try:
                item = await asyncio.wait_for(emitter.queue.get(), timeout=HEARTBEAT_SECONDS)
            except TimeoutError:
                yield (json.dumps(envelope("heartbeat", {}, emitter.seq, emitter.run_id)) + "\n").encode()
                continue
            if item is None:
                break
            yield (json.dumps(item, default=str) + "\n").encode()
        await task
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: S110
                pass
