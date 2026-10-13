---
title: Architecture
description: Services, data stores, contracts and the guarantees the system is built around.
section: Developers
order: 3
gates: [0, 3, 10]
---

FolioVerse is a monorepo with a React single-page app, a NestJS API and worker, and a Python AI service, backed
by PostgreSQL, Redis, Qdrant and S3-compatible object storage.

## Services

```text
Browser ── same origin ──▶ web (Caddy: SPA, /docs, /api proxy)
                              │
                              ▼
                       api-http (NestJS) ──▶ PostgreSQL (app, ai, rec, langgraph schemas)
                              │   ▲               Redis (BullMQ queues, SSE streams, rate limits)
                    BullMQ    ▼   │ SSE           S3 storage (uploads, exports)
                       api-worker ── NDJSON ──▶ ai-api (FastAPI, ROLE=api) ──▶ Qdrant (vectors)
                              │                                            └─▶ model providers
                              └──────────────▶ ai-ingest (FastAPI, ROLE=ingest)
```

| Service | Code | Responsibility |
| --- | --- | --- |
| web | `apps/web` | React 19 + Vite SPA in JavaScript/JSX, Tailwind v4 with design tokens; served by Caddy |
| api-http | `apps/api/src/main.ts` | REST API, auth, authorization, budgets, SSE |
| api-worker | `apps/api/src/worker.ts` | BullMQ consumers: ingestion, AI runs, ledger, maintenance |
| ai-api | `apps/ai-service` (`ROLE=api`) | Hybrid retrieval, LangGraph graphs, providers, recommendations |
| ai-ingest | `apps/ai-service` (`ROLE=ingest`) | Parsing, chunking, embedding and indexing |

The AI service is internal: only the worker and API call it, with ES256-signed service tokens.

## Data

- **PostgreSQL 16** through Prisma 6, in schemas `app` (product data, ledger), `ai` (runs, events, model calls),
  `rec` (catalog, interactions, recommendation sets) and `langgraph` (checkpoints). See the generated [data model](/docs/reference/data-model/).
- **Qdrant** stores one point per chunk with dense and sparse vectors and payload filters (workspace, source version).
- **Redis** carries BullMQ queues (`ingestion`, `ai-runs`, `ledger`, `maintenance`), Redis Streams for SSE replay and
  cancellation flags.
- **Object storage**: SeaweedFS locally, GCS through its S3-compatible API in the cloud.

## Guarantees

- **Universal source versions.** Every upload creates an immutable version; citations, notes, excerpts and research
  notes point at a version and a character range, so they stay valid when a newer version is uploaded.
- **The AI run ledger.** Every AI action is an `ai_runs` row with its recorded events, node executions, model calls,
  usage events and cost entries. Replay shows recorded events only; re-execution (fork) creates a new, separately
  billed run.
- **Tenancy.** Every workspace-scoped query filters by `workspaceId`; non-members get 404, never 403. Retrieval
  filters come only from the signed scope token.
- **Honest costs.** Estimates, finalized amounts and reconciled provider figures are separate tiers and are never
  shown as one another. Prices come from an admin with a source URL; simulated prices and data are labelled DEMO.
- **No invented models.** Real model ids come from environment variables; the registry seed contains no real ids or
  prices.

## Contracts

`packages/contracts` holds JSON Schemas, the OpenAPI document exported from the API, generated types and golden
fixtures. Pricing, citation validation and anchor resolution exist in both TypeScript and Python, and both must pass
the same fixtures (`pnpm contracts:check` and the Python tests). The API reference on this site is generated from the
OpenAPI documents.

## Cross-cutting

- OpenTelemetry traces join the browser, API, worker and AI service; see [Observability](observability.md).
- Design tokens (`packages/design-tokens`) generate CSS variables, the Tailwind theme and JS constants; web code uses
  tokens, never raw colours.
- Configuration is environment-only and validated at startup by variable name, never by printing values.
