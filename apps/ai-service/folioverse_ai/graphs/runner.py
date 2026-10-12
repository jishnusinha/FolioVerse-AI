"""Executes one run work unit and reports everything through the emitter (NDJSON to the API worker)."""

import structlog
from fastapi import HTTPException
from langgraph.errors import GraphRecursionError

from ..auth import verify_scope
from ..providers import ProviderError
from .checkpoints import copy_checkpoint, get_checkpointer
from .registry import GRAPHS
from .runtime import RUN_CONTEXTS, RetrievalUnavailable, RunContext

RETRYABLE_PROVIDER = {"TIMEOUT", "RATE_LIMIT", "UNAVAILABLE", "PROVIDER"}
log = structlog.get_logger("runner")


def normalize_input(inp: dict) -> dict:
    inp = dict(inp or {})
    params = dict(inp.get("params") or {})
    for k in ("action", "text"):
        if inp.get(k) and k not in params:
            params[k] = inp[k]
    inp["params"] = params
    return inp


async def run_unit(req: dict, emitter) -> None:
    run_id, workspace_id, graph_name = req["runId"], req["workspaceId"], req["graph"]
    spec = GRAPHS.get(graph_name)
    if spec is None:
        await emitter.emit(
            "run.failed",
            {"errorClass": "UNKNOWN_GRAPH", "message": f"Unknown graph {graph_name}", "retryable": False},
        )
        return
    try:
        scope = verify_scope(req["scopeToken"], run_id, workspace_id)
    except HTTPException as e:
        await emitter.emit(
            "run.failed", {"errorClass": "SCOPE_INVALID", "message": str(e.detail), "retryable": False}
        )
        return

    plan = req["modelPlan"]
    ctx = RunContext(
        run_id=run_id,
        workspace_id=workspace_id,
        graph=graph_name,
        plan=plan,
        scope=scope,
        emitter=emitter,
        options=req.get("options") or {},
        history=req.get("history") or [],
        user_id=req.get("userId"),
    )
    RUN_CONTEXTS[run_id] = ctx
    inp = normalize_input(req.get("input") or {})
    try:
        saver = await get_checkpointer()
        graph = spec.build(saver)
        config = {
            "configurable": {"thread_id": run_id},
            "recursion_limit": int(ctx.options.get("maxSteps", 30)),
        }
        primary = plan.get("primary", {})
        await emitter.emit(
            "run.started",
            {
                "graph": graph_name,
                "tier": spec.tier,
                "provider": primary.get("provider"),
                "model": primary.get("model"),
                "isDemo": ctx.is_demo,
                "forkedFrom": req.get("resumeFromCheckpoint"),
            },
        )
        start_input = spec.init(inp)
        cp = req.get("resumeFromCheckpoint")
        if cp and req.get("parentRunId"):
            copied = await copy_checkpoint(req["parentRunId"], cp, run_id, start_input)
            if not copied:
                await emitter.emit(
                    "run.failed",
                    {
                        "errorClass": "CHECKPOINT_NOT_FOUND",
                        "message": "Checkpoint not found for parent run",
                        "retryable": False,
                    },
                )
                return
            final = await graph.ainvoke(None, config)
        else:
            final = await graph.ainvoke(start_input, config)
        await emitter.emit("run.finished", spec.result(final or {}))
    except RetrievalUnavailable as e:
        await emitter.emit(
            "run.failed", {"errorClass": "RETRIEVAL_UNAVAILABLE", "message": str(e), "retryable": True}
        )
    except ProviderError as e:
        await emitter.emit(
            "run.failed",
            {
                "errorClass": f"PROVIDER_{e.kind}",
                "message": str(e),
                "retryable": e.kind in RETRYABLE_PROVIDER,
            },
        )
    except GraphRecursionError:
        await emitter.emit(
            "run.failed",
            {"errorClass": "STEP_LIMIT", "message": "Run exceeded its step limit", "retryable": False},
        )
    except Exception as e:
        log.exception("run_failed", run_id=run_id, graph=graph_name)
        await emitter.emit(
            "run.failed", {"errorClass": "INTERNAL", "message": e.__class__.__name__, "retryable": True}
        )
    finally:
        RUN_CONTEXTS.pop(run_id, None)
