"""Graph registry: tier, builder, input mapping, result mapping and a static description for Studio."""

from collections.abc import Callable
from dataclasses import dataclass

from . import artifacts, grounded_qa, judge, reader, research, writer


@dataclass(frozen=True)
class GraphSpec:
    name: str
    tier: str
    build: Callable
    init: Callable[[dict], dict]
    result: Callable[[dict], dict]
    needs_scope: bool
    description: str


GRAPHS: dict[str, GraphSpec] = {
    "grounded_qa": GraphSpec(
        "grounded_qa",
        "T1",
        grounded_qa.build,
        grounded_qa.initial_state,
        grounded_qa.result,
        True,
        "Grounded question answering with abstention and citation validation.",
    ),
    "insight": GraphSpec(
        "insight",
        "T0",
        artifacts.build,
        artifacts.initial_state_for("insight"),
        artifacts.result,
        True,
        "Single-pass insight actions (summaries, notes, flashcards, quiz, FAQ, report).",
    ),
    "multi_doc_compare": GraphSpec(
        "multi_doc_compare",
        "T1",
        artifacts.build,
        artifacts.initial_state_for("multi_doc_compare"),
        artifacts.result,
        True,
        "Compares documents point by point with cited differences.",
    ),
    "risk_contradiction": GraphSpec(
        "risk_contradiction",
        "T1",
        artifacts.build,
        artifacts.initial_state_for("risk_contradiction"),
        artifacts.result,
        True,
        "Finds risks and numeric contradictions across sources.",
    ),
    "knowledge_map": GraphSpec(
        "knowledge_map",
        "T1",
        artifacts.build,
        artifacts.initial_state_for("knowledge_map"),
        artifacts.result,
        True,
        "Builds an entity/concept graph from sources.",
    ),
    "research_writing": GraphSpec(
        "research_writing",
        "T2",
        research.build,
        research.initial_state,
        research.result,
        True,
        "Agentic research: plans sub-queries, retrieves (bounded tool loop), drafts with citations.",
    ),
    "writer_revision": GraphSpec(
        "writer_revision",
        "T0",
        writer.build_revision,
        writer.initial_state,
        writer.result,
        False,
        "Rewrite/expand/shorten/tone/dialogue/continue suggestions.",
    ),
    "continuity_check": GraphSpec(
        "continuity_check",
        "T1",
        writer.build_continuity,
        writer.initial_state,
        writer.result,
        False,
        "Checks a scene against canon facts (rules + model).",
    ),
    "dna_extraction": GraphSpec(
        "dna_extraction",
        "T1",
        writer.build_dna,
        writer.initial_state,
        writer.result,
        False,
        "Proposes Narrative DNA entities and relations (author approves).",
    ),
    "passage_explain": GraphSpec(
        "passage_explain",
        "T0",
        reader.build_passage,
        reader.passage_initial,
        reader.passage_result,
        True,
        "Explains a book passage using only earlier pages (spoiler guard).",
    ),
    "rec_explain": GraphSpec(
        "rec_explain",
        "T0",
        reader.build_rec,
        reader.rec_initial,
        reader.rec_result,
        False,
        "Explains a recommendation from its signals.",
    ),
    "answer_judge": GraphSpec(
        "answer_judge",
        "T0",
        judge.build,
        judge.initial_state,
        judge.result,
        False,
        "Grades how well an answer addresses its question (opt-in evaluation judge).",
    ),
}


def describe(name: str) -> dict:
    spec = GRAPHS[name]
    g = spec.build().get_graph()
    nodes = [
        {"id": n, "label": n, "kind": "terminal" if n in ("__start__", "__end__") else "node"}
        for n in g.nodes
    ]
    edges = [{"source": e.source, "target": e.target, "conditional": bool(e.conditional)} for e in g.edges]
    return {"name": name, "tier": spec.tier, "description": spec.description, "nodes": nodes, "edges": edges}
