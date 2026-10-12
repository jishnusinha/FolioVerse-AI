"""research_writing (T2, agentic): plan -> research (bounded tool loop) -> draft -> validate -> finalize.

The planner may only call the retrieval tool, at most `maxToolCalls` times (default 3). Every
retrieval is scope-filtered and recorded as a retrieval event.
"""

import json
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from ..text import content_words
from .extract import key_sentences
from .nodes import do_retrieve, validate_and_emit
from .runtime import SYSTEM_GROUNDED, call_model, ctx_of, format_context, node, parse_json


class ResearchState(TypedDict, total=False):
    question: str
    subquestions: list[str]
    cursor: int
    packed: list[dict]
    answer: str
    citations: list[dict]
    outcome: str
    status: str


def _mock_plan(q: str) -> list[str]:
    words = content_words(q)[:6]
    core = " ".join(words) or q
    return [q, f"key facts about {core}", f"risks or limitations of {core}"]


@node("plan")
async def plan_node(state: ResearchState, config) -> dict[str, Any]:
    ctx = ctx_of(config)
    limit = int(ctx.options.get("maxToolCalls", 3))
    messages = [
        {
            "role": "system",
            "content": f'Plan research. Return JSON {{"subquestions":[...]}} with at most {limit} short search queries.',
        },
        {"role": "user", "content": state["question"]},
    ]
    res = await call_model(
        ctx,
        messages,
        mock_text=json.dumps({"subquestions": _mock_plan(state["question"])}),
        stream=False,
        json_mode=True,
        max_tokens=200,
    )
    try:
        subs = [s for s in parse_json(res.text).get("subquestions", []) if isinstance(s, str) and s.strip()]
    except ValueError:
        subs = _mock_plan(state["question"])
    return {"subquestions": subs[:limit] or [state["question"]], "cursor": 0, "packed": []}


@node("research")
async def research_node(state: ResearchState, config) -> dict[str, Any]:
    ctx = ctx_of(config)
    q = state["subquestions"][state["cursor"]]
    await ctx.emit(
        "run.state", {"status": "RUNNING", "reason": f"Tool call {state['cursor'] + 1}: search_sources"}
    )
    r = await do_retrieve(ctx, q)
    seen = {p["chunkId"] for p in state.get("packed", [])}
    merged = list(state.get("packed", []))
    for p in r["packed"]:
        if p["chunkId"] not in seen and len(merged) < 10:
            merged.append(p)
            seen.add(p["chunkId"])
    for i, p in enumerate(merged, start=1):
        p["marker"] = f"S{i}"
    return {"packed": merged, "cursor": state["cursor"] + 1}


def loop(state: ResearchState) -> str:
    return "research" if state["cursor"] < len(state["subquestions"]) else "draft"


@node("draft")
async def draft_node(state: ResearchState, config) -> dict[str, Any]:
    ctx = ctx_of(config)
    packed = state.get("packed") or []
    if not packed:
        text = "I couldn't find enough evidence in the selected sources to write this."
        await ctx.emit("token.delta", {"text": text})
        return {"answer": text, "outcome": "ABSTAINED"}
    messages = [
        {
            "role": "system",
            "content": SYSTEM_GROUNDED + " Write a structured, well-organised piece with headings.",
        },
        {"role": "user", "content": f"Sources:\n{format_context(packed)}\n\nTask: {state['question']}"},
    ]
    sents = key_sentences(packed, 8, state["question"])
    mock = (
        "## Overview\n"
        + " ".join(f"{s} [{m}]." for m, s in sents[:3])
        + "\n\n## Details\n"
        + "\n".join(f"- {s} [{m}]." for m, s in sents[3:])
    )
    res = await call_model(ctx, messages, mock_text=mock, max_tokens=1800)
    return {"answer": res.text}


@node("validate_citations")
async def validate_node(state: ResearchState, config) -> dict[str, Any]:
    if state.get("outcome") == "ABSTAINED":
        return {"citations": []}
    r = await validate_and_emit(ctx_of(config), state["answer"], state.get("packed") or [])
    return {"citations": r["citations"], "outcome": r["outcome"]}


@node("finalize")
async def finalize_node(state: ResearchState, config) -> dict[str, Any]:
    return {"status": "PARTIAL" if state.get("outcome") == "PARTIAL" else "SUCCEEDED"}


def build(checkpointer=None):
    g = StateGraph(ResearchState)
    for name, fn in (
        ("plan", plan_node),
        ("research", research_node),
        ("draft", draft_node),
        ("validate_citations", validate_node),
        ("finalize", finalize_node),
    ):
        g.add_node(name, fn)
    g.add_edge(START, "plan")
    g.add_conditional_edges("plan", loop, {"research": "research", "draft": "draft"})
    g.add_conditional_edges("research", loop, {"research": "research", "draft": "draft"})
    g.add_edge("draft", "validate_citations")
    g.add_edge("validate_citations", "finalize")
    g.add_edge("finalize", END)
    return g.compile(checkpointer=checkpointer)


def initial_state(inp: dict) -> ResearchState:
    return {"question": (inp.get("question") or "").strip()}


def result(state: dict) -> dict:
    return {
        "answer": state.get("answer", ""),
        "outcome": state.get("outcome", "PARTIAL"),
        "status": state.get("status", "PARTIAL"),
        "artifact": None,
    }
