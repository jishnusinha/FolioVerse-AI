---
title: Interview guide
description: How to present FolioVerse, a ten-minute demo path, design trade-offs and honest answers to likely questions.
section: Reference
order: 3
---

This page is for walking someone through FolioVerse: what it is, what to show, and what is real versus
simulated or blocked.

## The pitch in three sentences

FolioVerse is a reading, research and writing workspace where every AI answer cites the exact passage it came from
and every AI action has a receipt with its real cost. Under the hood it is a production-shaped system: a React
SPA, a NestJS API and worker, a FastAPI service running LangGraph graphs over hybrid retrieval, and an append-only
cost ledger, all observable end to end. It runs fully offline with a deterministic mock model, so it can be demoed
and tested without spending tokens.

## What is real, what is DEMO, what is blocked

| Area | State |
| --- | --- |
| Auth, workspaces, tenancy, uploads, ingestion, hybrid retrieval, citations, runs, SSE, ledger, budgets | Implemented and tested |
| Model answers | DEMO mock model unless `OPENAI_API_KEY` (or Ollama) is configured; no key is configured here |
| Prices | DEMO prices on the mock models; real prices only via the admin UI with a source URL |
| Discover catalog | Synthetic DEMO catalog and interactions |
| GCP deployment, release workflow, cloud backups | Written and validated as code; never applied (no project or remote) |
| CI | Written and validated with actionlint; never run on GitHub (no remote) |
| Kaggle | Notebooks run locally and in a CI smoke workflow; publishing blocked (no account) |

The [implementation status](/docs/project/status/) page has the evidence for each gate.

## A ten-minute demo

1. **Upload and ingest** a PDF in Folio Knowledge; point out the stage track (scan, parse, index) and that the
   document is readable before indexing finishes.
2. **Ask a question**; show streaming, the citation chips and the evidence drawer jumping to the passage. Ask
   something the document does not cover to show abstention at zero cost.
3. **Open the run in AI Studio**: the graph with node timings, the RAG X-Ray (dense, sparse, fused ranks per
   passage), the receipt, then fork from the checkpoint before `generate` with another model and compare.
4. **Writer**: accept a suggestion, extract Narrative DNA (proposals only), add a canon fact and run the
   continuity check to catch a contradiction.
5. **Costs**: the Cost Center by feature and model; set a tiny hard budget and show a run rejected before any
   model call.
6. **Evaluations**: the golden-set evaluation and the research notebooks' findings.

## Design decisions worth discussing

- **Run ledger as the backbone.** Every AI action is a run with recorded events, so replay, receipts, costs, Studio
  and observability share one source of truth. Replay never re-executes; a fork is a new billed run.
- **Signed scope tokens.** Retrieval filters come only from a token the API signs, so a bug in the AI service cannot
  widen what a user may search.
- **Cost honesty.** Estimate, finalized and reconciled amounts are separate tiers; a missing price records zero with
  `PRICE_MISSING` instead of guessing.
- **RRF over weighted fusion.** Notebook 03 shows tuned weighted fusion can score higher (0.392 vs 0.320 nDCG@10),
  but its best weight depends on each embedder's score scale; RRF needs no per-embedder tuning.
- **Deterministic citation validation.** Content-word containment is free and reproducible; notebook 05 measures it
  (precision 0.977, recall 0.838) and its blind spot (similar passages), which the UI covers by showing the quote.
- **Logic in two languages, one set of fixtures.** Pricing, citations and anchors exist in TypeScript and Python;
  both must pass `packages/contracts/fixtures`.

All decisions, with context and alternatives, are in the [decision log](../planning/DECISION_LOG.md).

## Likely questions

**How do you know the answers are grounded?** Every claim must cite a packed passage; the validator checks each
citation against the stored text, and abstention happens before any model call when retrieval finds nothing. The
golden-set evaluation reports faithfulness and abstention accuracy.

**What stops one tenant seeing another's data?** Every workspace-scoped query filters by `workspaceId`, non-members
get 404, and vector search filters come from the signed scope token. Integration tests cover the authorization
matrix and cross-workspace access.

**What happens when the model provider fails?** Errors are classified with a retryable flag, a timeout tries the
fallback model, and Studio's failure injection reproduces each case on demand.

**How would this scale?** The API, worker and AI services are stateless and scale on Cloud Run; queues absorb
bursts; the standard Terraform profile swaps the data VM for Cloud SQL and Memorystore.

**What would you do next?** Configure a real provider and run the live evaluation, deploy the lean profile, and
finish hardening (security suite, accessibility and visual regression, performance budgets).
