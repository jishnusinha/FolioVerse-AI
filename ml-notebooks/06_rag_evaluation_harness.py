# ---
# jupyter:
#   jupytext:
#     formats: ipynb,py:percent
#     text_representation:
#       extension: .py
#       format_name: percent
#   kernelspec:
#     display_name: Python 3
#     language: python
#     name: python3
# ---

# %% [markdown]
# # 6 · RAG evaluation harness
#
# End-to-end evaluation of the `grounded_qa` graph exactly as the API worker runs it (scope token, retrieval,
# abstention gate, generation, deterministic citation validation, usage metering), with the DEMO mock models.
# The harness measures what the product promises rather than what an LLM grader thinks:
#
# * **answer support**: the gold evidence span appears in the answer;
# * **abstention**: unanswerable questions abstain (and cost nothing), answerable ones do not;
# * **citations**: share of VALID / WEAK / UNRESOLVED markers;
# * **cost & latency**: tokens from `usage.recorded`, priced with the registry's DEMO prices; node timings.
#
# The `answer_judge` heuristic score (1–5, content-word overlap) is reported alongside as a DEMO relevance proxy.
# Swap the plan for a live provider (opt-in, `FV_LIVE_PROVIDER_TESTS=1`) to evaluate a real model with the same code.

# %%
import os
import sys

sys.path.insert(0, os.environ.get("FV_NOTEBOOK_DIR", os.getcwd()))
import fvnb

fvnb.setup()
print("smoke mode" if fvnb.SMOKE else "full mode")
print(fvnb.DEMO_NOTE)

# %% [markdown]
# ## Corpus and question set

# %%
import random

rng = random.Random(6)
items = fvnb.catalog()[: fvnb.sample(200, 30)]


async def build():
    svids = [
        await fvnb.ingest(
            (fvnb.DATA / "synthetic/docs/atlas-brief.pdf").read_bytes(), "atlas-brief.pdf", "application/pdf"
        )
    ]
    svids.append(
        await fvnb.ingest(
            (fvnb.DATA / "synthetic/books/small-lanterns.epub").read_bytes(),
            "small-lanterns.epub",
            "application/epub+zip",
        )
    )
    for d in items:
        svids.append(await fvnb.ingest(f"# {d['title']}\n\n{d['description']}", d["title"]))
    return svids


svids = fvnb.arun(build())

questions = [{"set": "qa-small", **q} for q in fvnb.qa_small()]
# Catalog questions ask about one half of a description's "A novel about X and Y." sentence; Y is the evidence.
# Several titles share phrases, so these are deliberately ambiguous.
for d in rng.sample(items, fvnb.sample(40, 6)):
    first = d["description"].split(". ")[0]
    if " about " in first and " and " in first:
        x, y = first.split(" about ", 1)[1].split(" and ", 1)
        questions.append(
            {
                "set": "catalog",
                "question": f"Which story is about {x}?",
                "evidence": y.rstrip("."),
                "answerable": True,
            }
        )
off_topic = [
    "What is the boiling point of tungsten?",
    "Who won the 1966 football world cup?",
    "How do I file a tax return in Norway?",
    "What is the airspeed of an unladen swallow?",
    "Which vaccine schedule applies to toddlers in Peru?",
    "What is the capital of Burkina Faso?",
]
questions += [
    {"set": "off-topic", "question": q, "answerable": False} for q in off_topic[: fvnb.sample(6, 3)]
]
print(
    len(questions),
    "questions:",
    {s: sum(q["set"] == s for q in questions) for s in ("qa-small", "catalog", "off-topic")},
)

# %% [markdown]
# ## Run the graph

# %%
from decimal import Decimal

from folioverse_ai.graphs.judge import heuristic
from folioverse_ai.pricing import price_usage

prices = fvnb.demo_prices()


def demo_cost(u: dict) -> Decimal:
    """Prices one usage.recorded event with the model's DEMO price (missing price -> 0)."""
    return price_usage(prices.get(u["modelConfigId"]), u["usage"]).amount


CONCISE = {
    **fvnb.MOCK_PLAN,
    "primary": {"modelConfigId": "mock-concise", "provider": "mock", "model": "folioverse-mock-concise"},
    "maxOutputTokens": 300,
}
configs = [
    {"name": "grounded topK=6", "plan": fvnb.MOCK_PLAN, "options": {"topK": 6}},
    {"name": "grounded topK=3", "plan": fvnb.MOCK_PLAN, "options": {"topK": 3}},
    {"name": "concise topK=6", "plan": CONCISE, "options": {"topK": 6}},
]
if fvnb.SMOKE:
    configs = configs[::2]


async def evaluate(cfg) -> list[dict]:
    rows = []
    for q in questions:
        with fvnb.Timer() as t:
            terminal, events = await fvnb.run_graph(
                "grounded_qa", svids, {"question": q["question"]}, cfg["options"], cfg["plan"]
            )
        data = terminal["data"]
        answer = data.get("answer", "")
        usage = [e["data"] for e in events if e["type"] == "usage.recorded"]
        cites = [e["data"]["state"] for e in events if e["type"] == "citation.validated"]
        cost = sum((demo_cost(u) for u in usage), Decimal(0))
        rows.append(
            {
                "config": cfg["name"],
                "set": q["set"],
                "answerable": q["answerable"],
                "outcome": data.get("outcome") if terminal["type"] == "run.finished" else "FAILED",
                "supported": bool(q.get("evidence")) and q["evidence"].lower() in answer.lower(),
                "citations": cites,
                "judge": heuristic(q["question"], answer)["score"],
                "input": sum(u["usage"]["input"] for u in usage),
                "output": sum(u["usage"]["output"] for u in usage),
                "cost": cost,
                "ms": t.seconds * 1000,
            }
        )
    return rows


results = [r for cfg in configs for r in fvnb.arun(evaluate(cfg))]
print(len(results), "runs")

# %% [markdown]
# ## Scorecard

# %%


def scorecard(rows: list[dict]) -> dict:
    ans = [r for r in rows if r["answerable"]]
    una = [r for r in rows if not r["answerable"]]
    cites = [c for r in rows for c in r["citations"]]
    resolved_cites = [c for c in cites if c != "UNRESOLVED"]
    paid = [r for r in rows if r["input"]]
    correct_abstention_decisions = sum(1 for r in ans if r["outcome"] != "ABSTAINED") + sum(1 for r in una if r["outcome"] == "ABSTAINED")
    return {
        "config": rows[0]["config"],
        "citation_resolution": len(resolved_cites) / len(cites) if cites else 1.0,
        "claim_support": cites.count("VALID") / len(cites) if cites else 0.0,
        "answer_relevance": fvnb.mean(r["judge"] for r in ans),
        "retrieval_quality": fvnb.mean(r["supported"] for r in ans),
        "abstention_accuracy": correct_abstention_decisions / len(rows) if rows else 1.0,
        "answer_support": fvnb.mean(r["supported"] for r in ans),
        "false_abstain": fvnb.mean(r["outcome"] == "ABSTAINED" for r in ans),
        "abstain_unanswerable": fvnb.mean(r["outcome"] == "ABSTAINED" for r in una),
        "citations_valid": cites.count("VALID") / len(cites) if cites else 0.0,
        "citations_weak": cites.count("WEAK") / len(cites) if cites else 0.0,
        "judge_mean": fvnb.mean(r["judge"] for r in ans),
        "tokens_per_run": fvnb.mean(r["input"] + r["output"] for r in paid),
        "demo_cost_per_1k_runs": float(sum(r["cost"] for r in rows)) / len(rows) * 1000,
        "abstained_cost": float(sum(r["cost"] for r in rows if r["outcome"] == "ABSTAINED")),
        "latency_ms_p50": fvnb.percentile([r["ms"] for r in rows], 0.5),
        "latency_ms_p95": fvnb.percentile([r["ms"] for r in rows], 0.95),
    }


cards = [scorecard([r for r in results if r["config"] == c["name"]]) for c in configs]
fvnb.table(cards)

# %%
per_set = []
for cfg in configs:
    for s in ("qa-small", "catalog"):
        rows = [r for r in results if r["config"] == cfg["name"] and r["set"] == s and r["answerable"]]
        per_set.append(
            {
                "config": cfg["name"],
                "set": s,
                "n": len(rows),
                "answer_support": fvnb.mean(r["supported"] for r in rows),
            }
        )
fvnb.table(per_set)

# %%
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(6, 2.8))
for c in cards:
    ax.scatter(c["demo_cost_per_1k_runs"], c["answer_support"], s=60)
    ax.annotate(
        c["config"],
        (c["demo_cost_per_1k_runs"], c["answer_support"]),
        fontsize=8,
        xytext=(4, 4),
        textcoords="offset points",
    )
ax.set_xlabel("DEMO cost per 1k runs (USD, not real prices)")
ax.set_ylabel("answer support")
fig.tight_layout()

# %% [markdown]
# ## Findings

# %%
base = cards[0]
fvnb.finding(
    f"{base['config']}: answer support {base['answer_support']:.0%}, false abstentions {base['false_abstain']:.0%}, "
    f"unanswerable abstained {base['abstain_unanswerable']:.0%}, VALID citations {base['citations_valid']:.0%}."
)
fvnb.finding(
    f"Abstained runs cost {base['abstained_cost']:.8f} DEMO USD in total: abstention happens before any model call."
)
leaked = [
    r
    for r in results
    if r["config"] == base["config"] and not r["answerable"] and r["outcome"] != "ABSTAINED"
]
if leaked:
    leaked_valid = [c for r in leaked for c in r["citations"]]
    fvnb.finding(
        f"{len(leaked)} unanswerable question(s) were answered: with the hash embedder the abstention gate is "
        "lexical, so a question sharing words with the corpus passes it. "
        f"{leaked_valid.count('VALID')}/{len(leaked_valid)} of their citations are still VALID because the mock "
        f"quotes passages verbatim; citation validity is not relevance (judge mean {fvnb.mean(r['judge'] for r in leaked):.1f}/5)."
    )
for c in cards[1:]:
    fvnb.finding(
        f"{c['config']}: support {c['answer_support'] - base['answer_support']:+.0%}, "
        f"tokens/run {c['tokens_per_run'] - base['tokens_per_run']:+.0f}, DEMO cost/1k {c['demo_cost_per_1k_runs'] - base['demo_cost_per_1k_runs']:+.4f}."
    )

# %%
fvnb.save(
    "06-rag-evaluation",
    {
        "questions": len(questions),
        "sources": len(svids),
        "scorecards": cards,
        "perSet": per_set,
        "pricing": "DEMO prices from config/models/registry.seed.yaml",
    },
)
