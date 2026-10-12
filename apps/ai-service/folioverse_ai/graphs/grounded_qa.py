"""grounded_qa (T1): retrieve -> (abstain | generate) -> validate_citations -> finalize.

Abstention happens before any model call, so an unanswerable question costs nothing.
"""

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from .extract import answer_for
from .nodes import do_retrieve, validate_and_emit
from .runtime import SYSTEM_GROUNDED, call_model, ctx_of, format_context, node

ABSTAIN_TEXT = (
    "I couldn't find enough evidence in the selected sources to answer that. "
    "Try rephrasing the question, or add sources that cover this topic."
)


class QAState(TypedDict, total=False):
    question: str
    packed: list[dict]
    abstain: bool
    topScore: float
    answer: str
    citations: list[dict]
    outcome: str
    status: str


@node("retrieve")
async def retrieve_node(state: QAState, config) -> dict[str, Any]:
    ctx = ctx_of(config)
    return await do_retrieve(ctx, state["question"])


def route(state: QAState) -> str:
    return "abstain" if state.get("abstain") else "generate"


@node("abstain")
async def abstain_node(state: QAState, config) -> dict[str, Any]:
    ctx = ctx_of(config)
    await ctx.emit("token.delta", {"text": ABSTAIN_TEXT})
    return {"answer": ABSTAIN_TEXT, "citations": [], "outcome": "ABSTAINED", "status": "SUCCEEDED"}


@node("generate")
async def generate_node(state: QAState, config) -> dict[str, Any]:
    ctx = ctx_of(config)
    packed = state["packed"]
    messages = [{"role": "system", "content": SYSTEM_GROUNDED}]
    for h in ctx.history[-8:]:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append(
        {"role": "user", "content": f"Sources:\n{format_context(packed)}\n\nQuestion: {state['question']}"}
    )
    res = await call_model(ctx, messages, mock_text=answer_for(state["question"], packed))
    return {"answer": res.text}


@node("validate_citations")
async def validate_node(state: QAState, config) -> dict[str, Any]:
    ctx = ctx_of(config)
    r = await validate_and_emit(ctx, state["answer"], state["packed"])
    return {"citations": r["citations"], "outcome": r["outcome"]}


@node("finalize")
async def finalize_node(state: QAState, config) -> dict[str, Any]:
    outcome = state.get("outcome", "ANSWERED")
    return {"status": "PARTIAL" if outcome == "PARTIAL" else "SUCCEEDED"}


def build(checkpointer=None):
    g = StateGraph(QAState)
    g.add_node("retrieve", retrieve_node)
    g.add_node("abstain", abstain_node)
    g.add_node("generate", generate_node)
    g.add_node("validate_citations", validate_node)
    g.add_node("finalize", finalize_node)
    g.add_edge(START, "retrieve")
    g.add_conditional_edges("retrieve", route, {"abstain": "abstain", "generate": "generate"})
    g.add_edge("generate", "validate_citations")
    g.add_edge("validate_citations", "finalize")
    g.add_edge("abstain", "finalize")
    g.add_edge("finalize", END)
    return g.compile(checkpointer=checkpointer)


def initial_state(inp: dict) -> QAState:
    return {"question": (inp.get("question") or "").strip()}


def result(state: dict) -> dict:
    return {
        "answer": state.get("answer", ""),
        "outcome": state.get("outcome", "PARTIAL"),
        "status": state.get("status", "PARTIAL"),
        "artifact": None,
    }
