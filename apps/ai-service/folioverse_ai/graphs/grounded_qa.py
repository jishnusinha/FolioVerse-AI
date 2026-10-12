"""grounded_qa (T1): retrieve -> (abstain | budget_stop | generate) -> validate_citations -> finalize.

Abstention happens before any model call, so an unanswerable question costs nothing. When the plan
carries a budget guard (hard workspace budget), the prompt actually built from the retrieved passages is
priced before generating; if it could exceed what the budget still allows, the run stops without a call.
"""

from decimal import Decimal
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from ..pricing import price_usage
from ..text import count_tokens
from .extract import answer_for
from .nodes import do_retrieve, validate_and_emit
from .runtime import SYSTEM_GROUNDED, RunContext, call_model, ctx_of, format_context, node

ABSTAIN_TEXT = (
    "I couldn't find enough evidence in the selected sources to answer that. "
    "Try rephrasing the question, or add sources that cover this topic."
)


class QAState(TypedDict, total=False):
    question: str
    packed: list[dict]
    abstain: bool
    overBudget: dict
    topScore: float
    answer: str
    citations: list[dict]
    outcome: str
    status: str


def prompt_messages(ctx: RunContext, question: str, packed: list[dict]) -> list[dict]:
    messages = [{"role": "system", "content": SYSTEM_GROUNDED}]
    for h in ctx.history[-8:]:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append(
        {"role": "user", "content": f"Sources:\n{format_context(packed)}\n\nQuestion: {question}"}
    )
    return messages


def budget_check(ctx: RunContext, messages: list[dict]) -> dict | None:
    """Returns the overrun when the plan's budget guard would be exceeded by this prompt, else None."""
    guard = ctx.plan.get("budgetGuard")
    if not guard:
        return None
    prompt_tokens = sum(count_tokens(m["content"]) for m in messages)
    output_tokens = int(ctx.plan.get("maxOutputTokens", 800))
    estimate = price_usage(guard["prices"], {"input": prompt_tokens, "output": output_tokens}).amount
    if estimate <= Decimal(str(guard["maxCost"])):
        return None
    return {"estimate": str(estimate), "maxCost": str(guard["maxCost"]), "promptTokens": prompt_tokens}


@node("retrieve")
async def retrieve_node(state: QAState, config) -> dict[str, Any]:
    ctx = ctx_of(config)
    res = await do_retrieve(ctx, state["question"])
    if not res.get("abstain"):
        over = budget_check(ctx, prompt_messages(ctx, state["question"], res["packed"]))
        if over:
            res["overBudget"] = over
    return res


def route(state: QAState) -> str:
    if state.get("abstain"):
        return "abstain"
    return "budget_stop" if state.get("overBudget") else "generate"


@node("abstain")
async def abstain_node(state: QAState, config) -> dict[str, Any]:
    ctx = ctx_of(config)
    await ctx.emit("token.delta", {"text": ABSTAIN_TEXT})
    return {"answer": ABSTAIN_TEXT, "citations": [], "outcome": "ABSTAINED", "status": "SUCCEEDED"}


@node("budget_stop")
async def budget_stop_node(state: QAState, config) -> dict[str, Any]:
    over = state["overBudget"]
    text = (
        f"Stopped before calling the model: with the retrieved passages this answer could cost up to "
        f"${over['estimate']}, more than the ${over['maxCost']} the workspace's hard budget still allows. "
        "Nothing was charged."
    )
    return {"answer": text, "citations": [], "outcome": "ABSTAINED", "status": "BUDGET_REJECTED"}


@node("generate")
async def generate_node(state: QAState, config) -> dict[str, Any]:
    ctx = ctx_of(config)
    packed = state["packed"]
    messages = prompt_messages(ctx, state["question"], packed)
    res = await call_model(ctx, messages, mock_text=answer_for(state["question"], packed))
    return {"answer": res.text}


@node("validate_citations")
async def validate_node(state: QAState, config) -> dict[str, Any]:
    ctx = ctx_of(config)
    r = await validate_and_emit(ctx, state["answer"], state["packed"])
    return {"citations": r["citations"], "outcome": r["outcome"]}


@node("finalize")
async def finalize_node(state: QAState, config) -> dict[str, Any]:
    if state.get("status") == "BUDGET_REJECTED":
        return {}
    outcome = state.get("outcome", "ANSWERED")
    return {"status": "PARTIAL" if outcome == "PARTIAL" else "SUCCEEDED"}


def build(checkpointer=None):
    g = StateGraph(QAState)
    g.add_node("retrieve", retrieve_node)
    g.add_node("abstain", abstain_node)
    g.add_node("budget_stop", budget_stop_node)
    g.add_node("generate", generate_node)
    g.add_node("validate_citations", validate_node)
    g.add_node("finalize", finalize_node)
    g.add_edge(START, "retrieve")
    g.add_conditional_edges(
        "retrieve", route, {"abstain": "abstain", "budget_stop": "budget_stop", "generate": "generate"}
    )
    g.add_edge("generate", "validate_citations")
    g.add_edge("validate_citations", "finalize")
    g.add_edge("abstain", "finalize")
    g.add_edge("budget_stop", "finalize")
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
