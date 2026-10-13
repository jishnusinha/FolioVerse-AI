# FolioVerse AI

A knowledge, writing, reading and discovery workspace with grounded AI: every answer cites the exact
passage it came from, every run has a receipt (model, tokens, cost tier), and every AI workflow is
inspectable in AI Studio.

> Status: under active construction. See [`docs/planning/IMPLEMENTATION_STATUS.md`](docs/planning/IMPLEMENTATION_STATUS.md)
> for what is DONE, IN_PROGRESS or BLOCKED, with evidence.

## Architecture

```
browser ── Caddy (:8080) ──┬── static SPA (React 19, Vite, Tailwind v4)
                           ├── /docs ── documentation site (Astro Starlight, static)
                           └── /api ── NestJS API (auth, workspaces, uploads, runs, SSE, ledger)
                                         │  BullMQ (Redis) ── API worker ──NDJSON──┐
                                         │                                         ├── AI service api role (LangGraph graphs)
                                         │                                         └── AI service ingest role (parse, chunk, embed)
                                         ├── Postgres 16 (schemas app, ai; LangGraph checkpoints)
                                         ├── Qdrant (dense bge-small + BM25 sparse, RRF)
                                         └── S3-compatible storage (SeaweedFS locally, GCS in cloud)
```

- **Grounding:** hybrid retrieval → token-budget packing → `[S#]` citations validated deterministically
  (VALID / WEAK / UNRESOLVED). Below-threshold retrieval abstains *before* any model call.
- **Cost:** preflight estimate reserved against a workspace budget; each model call writes a usage
  event that the ledger turns into an idempotent cost entry (FINALIZED or FINAL_ESTIMATED).
- **Models:** a deterministic mock model (labelled DEMO) works with no keys. OpenAI or Ollama are used
  only when configured; model ids come from env vars, prices are entered by an admin with a source URL.

## Quick start

Prerequisites: Node 22+, pnpm 9, Python 3.12 with `uv` (`pip install uv`), Docker.

```bash
pnpm install
python -m uv sync --all-packages --extra dev
pnpm up -- --infra        # Postgres, Redis, Qdrant, S3 storage, Mailpit + migrate + seed
pnpm dev                  # web :5173, api :3000, worker, ai :8000/:8001
```

Or run everything in containers: `pnpm up` → http://localhost:8080.

`pnpm up` creates `.env` from `.env.example` and generates local secrets (never printed). To use a real
model, set `OPENAI_API_KEY` and `FV_OPENAI_MODEL` (the exact model id you are entitled to use).

## Tests

```bash
pnpm test                                  # unit tests (TS + Python), no network, no paid tokens
pnpm test:integration                      # API against Postgres/Redis/S3 from `pnpm up -- --infra`
node infrastructure/scripts/smoke.mjs      # end-to-end backend slice against a running stack
```

## Documentation

Guides live in [`docs/guide`](docs/guide) and are published twice: at `/docs/` (Starlight, with the generated
API reference and data model; `pnpm docs:dev` or `pnpm docs:build`) and inside the app at `/app/docs`, with
status badges taken from the implementation status file. `pnpm docs:shots` refreshes the screenshots from a
running stack.

## Repository guide

See [`AGENTS.md`](AGENTS.md).
