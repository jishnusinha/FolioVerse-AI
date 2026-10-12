from conftest import MOCK_PLAN, scope_token

from folioverse_ai.events import Emitter
from folioverse_ai.graphs.runner import run_unit
from folioverse_ai.ids import uuid7
from folioverse_ai.ingestion.pipeline import run_ingestion


async def ingest(
    text: str | bytes, workspace_id: str, title: str = "Doc", mime: str = "text/markdown"
) -> str:
    svid = uuid7()
    em = Emitter(None, workspace_id)
    res = await run_ingestion(
        {
            "jobId": uuid7(),
            "workspaceId": workspace_id,
            "sourceId": uuid7(),
            "sourceVersionId": svid,
            "title": title,
            "mimeType": mime,
            "objectUrl": "unused",
        },
        em,
        data=text if isinstance(text, bytes) else text.encode(),
    )
    assert res["state"] == "READY", res
    return svid


async def run(
    graph: str,
    workspace_id: str,
    svids: list[str],
    inp: dict,
    plan: dict | None = None,
    options: dict | None = None,
    **extra,
) -> tuple[dict, list[dict], str]:
    run_id = uuid7()
    em = Emitter(run_id, workspace_id)
    req = {
        "runId": run_id,
        "workspaceId": workspace_id,
        "graph": graph,
        "input": inp,
        "history": [],
        "modelPlan": plan or MOCK_PLAN,
        "scopeToken": scope_token(run_id, workspace_id, svids),
        "options": options or {},
        **extra,
    }
    await run_unit(req, em)
    events = []
    while not em.queue.empty():
        events.append(em.queue.get_nowait())
    terminal = next((e for e in reversed(events) if e["type"] in ("run.finished", "run.failed")), None)
    assert terminal is not None, [e["type"] for e in events]
    return terminal, events, run_id


def of_type(events: list[dict], t: str) -> list[dict]:
    return [e for e in events if e["type"] == t]
