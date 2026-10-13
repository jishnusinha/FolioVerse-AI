---
title: LangGraph workflows
description: The graphs behind every AI action, their tiers, checkpoints, replay and re-execution.
section: AI/ML
order: 2
gates: [3, 8]
blocked: [OpenAI API key]
demo: Graphs run against the DEMO mock models (mock-grounded, mock-concise) unless a provider key is configured.
---

Every AI action in FolioVerse is a run of a named LangGraph graph in the AI service. Graphs are registered in
`apps/ai-service/folioverse_ai/graphs/registry.py`, and AI Studio draws each one from that registry.

## Tiers

| Tier | Meaning | Graphs |
| --- | --- | --- |
| T0 | A single model call with fixed steps | `insight`, `writer_revision`, `passage_explain`, `rec_explain`, `answer_judge` |
| T1 | A workflow graph with branches | `grounded_qa`, `multi_doc_compare`, `risk_contradiction`, `knowledge_map`, `continuity_check`, `dna_extraction` |
| T2 | A bounded agentic loop | `research_writing` (plans sub-queries, retrieves in a capped tool loop, drafts with citations) |

## Anatomy of a run

`grounded_qa` shows the common shape:

```text
START → retrieve ─┬─▶ abstain ───────────────┐
                  ├─▶ budget_stop ───────────┤
                  └─▶ generate → validate_citations → finalize → END
```

Nodes emit `node.started` and `node.finished` events with timings, model calls emit `usage.recorded` with token
counts, and generation streams `token.delta`. The worker stores the events that matter for replay in
`ai_run_events` and relays all of them to the browser.

## Checkpoints, replay and fork

With `FV_CHECKPOINTER=postgres` each step's state is checkpointed in the `langgraph` schema. AI Studio uses this in
two different ways, and the UI keeps them apart:

- **Replay** plays back the recorded events of a finished run. Nothing is executed and nothing is billed.
- **Fork (re-execution)** restarts the graph from a chosen checkpoint, optionally with another model. It creates
  a new, separately billed run linked to its parent, and its output may differ.

## Failure handling

Provider errors are classified (`PROVIDER_TIMEOUT`, `PROVIDER_RATE_LIMIT`, `RETRIEVAL_UNAVAILABLE`, …) with a
retryable flag. A provider timeout tries the plan's fallback model when it has one, and malformed model output ends
the run as PARTIAL instead of failing silently.
When `FV_LAB_FAULTS=true`, Studio's failure injection can force these cases on lab runs
(`provider_timeout`, `provider_429`, `retrieval_down`, `malformed_output`). Keep it off in production.

## AI Studio

| Tool | What it shows |
| --- | --- |
| Run view | The graph with per-node timings, the event timeline (time machine), receipt and RAG X-Ray |
| Compare | Two runs side by side: model, tokens, cost tier, answer |
| Retrieval Playground | Retrieval only, with fusion, rerank and budget options, as a detached lab run |
| Model Battle | Two models answer from the same frozen context, blind until you vote |
| Evaluations | Golden-dataset evaluation of the real graph, plus the research notebooks' findings |

Notebook 11 analyses run events across graphs: latency and token share per node and how each failure class ends
([Research notebooks](../notebooks.md)).
