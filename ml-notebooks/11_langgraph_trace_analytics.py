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
# # 11 · LangGraph trace analytics
#
# Every run streams a typed event log (`node.started` / `node.finished` with durations, `usage.recorded`
# per model attempt, `token.delta`, `citation.validated`, `run.finished` / `run.failed`). Studio's Time
# Machine replays exactly these events. This notebook runs the registered graphs, plus the failure
# injections Studio exposes, through the real runner and analyses the traces:
#
# * steps, latency and time-to-first-token per graph;
# * where time goes per node, and which node spends the tokens;
# * failure classes, retryability and fallback recovery.
#
# The mock model has no network latency (`FV_MOCK_TOKEN_DELAY_MS=0`), so model nodes look cheap here; with a
# live provider the same analysis attributes real provider time.

# %%
import os
import sys

sys.path.insert(0, os.environ.get("FV_NOTEBOOK_DIR", os.getcwd()))
import fvnb

fvnb.setup()
print("smoke mode" if fvnb.SMOKE else "full mode")

# %% [markdown]
# ## Workload

# %%


async def build():
    atlas = await fvnb.ingest(
        (fvnb.DATA / "synthetic/docs/atlas-brief.pdf").read_bytes(), "atlas-brief.pdf", "application/pdf"
    )
    book = await fvnb.ingest(
        (fvnb.DATA / "synthetic/books/small-lanterns.epub").read_bytes(),
        "small-lanterns.epub",
        "application/epub+zip",
    )
    d = fvnb.catalog()[0]
    other = await fvnb.ingest(f"# {d['title']}\n\n{d['description']}", d["title"])
    page = await fvnb.repo().page_text(book, 1)
    return atlas, book, other, page


atlas, book, other, page1 = fvnb.arun(build())
passage = next(s for s in page1.split(". ") if len(s.split()) > 8)[:300]
novel_text = page1[:4000]
FALLBACK = {
    **fvnb.MOCK_PLAN,
    "fallbacks": [
        {"modelConfigId": "mock-fallback", "provider": "mock", "model": "folioverse-mock-fallback"}
    ],
}

workload = [
    ("grounded_qa", [atlas], {"question": "What is the base-case annual growth rate?"}, {}, None),
    ("grounded_qa", [atlas], {"question": "Who won the 1998 chess olympiad?"}, {}, None),
    ("insight", [atlas], {"action": "quick_summary"}, {}, None),
    ("insight", [atlas], {"action": "flashcards"}, {}, None),
    ("risk_contradiction", [atlas], {}, {}, None),
    ("multi_doc_compare", [atlas, other], {}, {}, None),
    ("knowledge_map", [book], {}, {}, None),
    (
        "research_writing",
        [atlas],
        {"question": "Assess growth prospects and risks"},
        {"maxToolCalls": 2},
        None,
    ),
    ("passage_explain", [book], {"params": {"page": 1, "mode": "explain", "passage": passage}}, {}, None),
    ("dna_extraction", [], {"text": novel_text}, {}, None),
    (
        "continuity_check",
        [],
        {
            "params": {
                "text": "Mara looked up, her blue eyes narrowing.",
                "canon": [{"id": "c1", "name": "Mara", "facts": {"eye color": "green"}}],
            }
        },
        {},
        None,
    ),
    (
        "writer_revision",
        [],
        {"text": "It was very dark. She just waited. The door opened.", "params": {"mode": "shorten"}},
        {},
        None,
    ),
    (
        "answer_judge",
        [],
        {"question": "What is the base case growth rate?", "text": "The base case growth rate is 14.2%."},
        {},
        None,
    ),
]
failures = [
    (
        "grounded_qa",
        [atlas],
        {"question": "What is the base-case annual growth rate?"},
        {"inject": "provider_timeout"},
        FALLBACK,
    ),
    (
        "grounded_qa",
        [atlas],
        {"question": "What is the base-case annual growth rate?"},
        {"inject": "provider_429"},
        None,
    ),
    (
        "grounded_qa",
        [atlas],
        {"question": "What is the base-case annual growth rate?"},
        {"inject": "retrieval_down"},
        None,
    ),
    (
        "grounded_qa",
        [atlas],
        {"question": "What is the base-case annual growth rate?"},
        {"inject": "malformed_output"},
        None,
    ),
]
REPS = fvnb.sample(5, 1)

# %%
from datetime import datetime


def ts(e: dict) -> float:
    return datetime.fromisoformat(e["ts"].replace("Z", "+00:00")).timestamp() * 1000


traces = []
for _rep in range(REPS):
    for graph, svids, inp, options, plan in workload + failures:
        terminal, events = fvnb.arun(fvnb.run_graph(graph, svids, inp, options, plan))
        traces.append(
            {"graph": graph, "inject": options.get("inject"), "terminal": terminal, "events": events}
        )
print(len(traces), "traced runs,", sum(len(t["events"]) for t in traces), "events")

# %% [markdown]
# ## Per graph

# %%
from collections import defaultdict

graph_rows = []
by_graph = defaultdict(list)
for t in traces:
    if not t["inject"]:
        by_graph[t["graph"]].append(t)
for graph, ts_ in by_graph.items():
    steps, lat, ttft, calls, tin, tout = [], [], [], [], [], []
    for t in ts_:
        ev = t["events"]
        start = next(e for e in ev if e["type"] == "run.started")
        steps.append(sum(e["type"] == "node.started" for e in ev))
        lat.append(ts(t["terminal"]) - ts(start))
        first = next((e for e in ev if e["type"] == "token.delta"), None)
        if first:
            ttft.append(ts(first) - ts(start))
        usage = [e["data"] for e in ev if e["type"] == "usage.recorded"]
        calls.append(len(usage))
        tin.append(sum(u["usage"]["input"] for u in usage))
        tout.append(sum(u["usage"]["output"] for u in usage))
    graph_rows.append(
        {
            "graph": graph,
            "runs": len(ts_),
            "ok": fvnb.mean(t["terminal"]["type"] == "run.finished" for t in ts_),
            "steps": fvnb.mean(steps),
            "latency_ms_p50": fvnb.percentile(lat, 0.5),
            "ttft_ms_p50": fvnb.percentile(ttft, 0.5) if ttft else None,
            "model_calls": fvnb.mean(calls),
            "input_tokens": fvnb.mean(tin),
            "output_tokens": fvnb.mean(tout),
        }
    )
graph_rows.sort(key=lambda r: -r["latency_ms_p50"])
fvnb.table(graph_rows)

# %% [markdown]
# ## Per node
# Tokens are attributed to the node that was running when `usage.recorded` was emitted.

# %%
node_stats = defaultdict(lambda: {"durations": [], "errors": 0, "input": 0, "output": 0, "graphs": set()})
for t in traces:
    current = None
    for e in t["events"]:
        if e["type"] == "node.started":
            current = e["data"]["node"]
        elif e["type"] == "node.finished":
            s = node_stats[e["data"]["node"]]
            s["durations"].append(e["data"]["durationMs"])
            s["errors"] += e["data"]["status"] == "ERROR"
            s["graphs"].add(t["graph"])
        elif e["type"] == "usage.recorded" and current:
            node_stats[current]["input"] += e["data"]["usage"]["input"]
            node_stats[current]["output"] += e["data"]["usage"]["output"]
total_ms = sum(sum(s["durations"]) for s in node_stats.values())
total_tokens = sum(s["input"] + s["output"] for s in node_stats.values()) or 1
node_rows = sorted(
    (
        {
            "node": n,
            "graphs": len(s["graphs"]),
            "calls": len(s["durations"]),
            "ms_mean": fvnb.mean(s["durations"]),
            "ms_p95": fvnb.percentile(s["durations"], 0.95),
            "time_share": sum(s["durations"]) / total_ms,
            "token_share": (s["input"] + s["output"]) / total_tokens,
            "errors": s["errors"],
        }
        for n, s in node_stats.items()
    ),
    key=lambda r: -r["time_share"],
)
fvnb.table(node_rows)

# %%
import matplotlib.pyplot as plt

top = node_rows[:10]
fig, ax = plt.subplots(figsize=(6, 3))
ax.barh([r["node"] for r in top][::-1], [r["time_share"] for r in top][::-1], label="time")
ax.barh([r["node"] for r in top][::-1], [r["token_share"] for r in top][::-1], alpha=0.5, label="tokens")
ax.set_xlabel("share of all traced runs")
ax.legend(fontsize=8)
fig.tight_layout()

# %% [markdown]
# ## Failure injection

# %%
fail_rows = []
for t in traces:
    if not t["inject"]:
        continue
    usage = [e["data"] for e in t["events"] if e["type"] == "usage.recorded"]
    d = t["terminal"]["data"]
    fail_rows.append(
        {
            "inject": t["inject"],
            "terminal": t["terminal"]["type"],
            "errorClass": d.get("errorClass"),
            "retryable": d.get("retryable"),
            "outcome": d.get("outcome"),
            "attempts": len(usage),
            "attempt_status": ",".join(u["status"] for u in usage),
            "errored_nodes": sum(
                e["type"] == "node.finished" and e["data"]["status"] == "ERROR" for e in t["events"]
            ),
        }
    )
unique_fail = list({r["inject"]: r for r in fail_rows}.values())
fvnb.table(unique_fail)

# %% [markdown]
# ## Findings

# %%
slow = graph_rows[0]
fvnb.finding(
    f"Slowest graph: {slow['graph']} (p50 {slow['latency_ms_p50']:.0f} ms, {slow['steps']:.0f} steps, {slow['model_calls']:.1f} model calls)."
)
fvnb.finding(
    f"Node with the largest time share: {node_rows[0]['node']} ({node_rows[0]['time_share']:.0%}); largest token share: {max(node_rows, key=lambda r: r['token_share'])['node']}."
)
zero = [r["graph"] for r in graph_rows if r["model_calls"] == 0]
if zero:
    fvnb.finding(f"Graphs that finished without a model call in this workload: {', '.join(zero)}.")
for r in unique_fail:
    attempts = r["attempt_status"] or "no model call"
    if r["terminal"] == "run.failed":
        fvnb.finding(
            f"{r['inject']}: failed with {r['errorClass']} (retryable={r['retryable']}; attempts: {attempts})."
        )
    else:
        fvnb.finding(f"{r['inject']}: finished {r['outcome']} (attempts: {attempts}).")

# %%
fvnb.save(
    "11-trace-analytics",
    {"runs": len(traces), "reps": REPS, "graphs": graph_rows, "nodes": node_rows, "failures": unique_fail},
)
