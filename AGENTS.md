# AGENTS.md — working in the FolioVerse repo

Guidance for humans and coding agents. The source of truth for scope and order is
`docs/planning/MASTER_IMPLEMENTATION_PLAN.md`; progress lives in `docs/planning/IMPLEMENTATION_STATUS.md`;
deviations and choices go in `docs/planning/DECISION_LOG.md`.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | React 19 + Vite SPA (JavaScript/JSX only), Tailwind v4 with design tokens |
| `apps/api` | NestJS 11 API (`src/main.ts`) and BullMQ worker (`src/worker.ts`), Prisma 6 |
| `apps/ai-service` | FastAPI AI service: ingestion, hybrid retrieval, LangGraph graphs (`ROLE=api|ingest`) |
| `packages/contracts` | JSON Schemas, golden fixtures (pricing, citations, anchors), generated types |
| `packages/design-tokens` | `tokens.json` → CSS variables, Tailwind `@theme`, JS |
| `packages/folioverse-ml` | Recommendation models and offline evaluation (Python) |
| `config/models/registry.seed.yaml` | Model registry seed (no hard-coded real model ids or prices) |
| `infrastructure/` | Docker files, scripts (`up`, `dev`, `smoke`, `gen-keys`, `check-env`) |

## Commands

```bash
pnpm install && python -m uv sync --all-packages --extra dev   # install
pnpm up -- --infra      # data services in Docker + migrate + seed
pnpm dev                # web, api, worker, ai-api, ai-ingest natively
pnpm up                 # everything in Docker (http://localhost:8080)
pnpm test               # JS/TS unit tests + pytest (mock model, no network)
pnpm typecheck && pnpm lint
node infrastructure/scripts/smoke.mjs   # backend vertical slice against a running stack
```

## Rules

- Never commit `.env` or credentials; never print secret values (scripts print variable names only).
- CI and default tests must not call paid providers. Live provider tests require `FV_LIVE_PROVIDER_TESTS=1`.
- Do not invent model ids or prices. Real model ids come from env vars; prices are entered by an admin
  with a source URL. Anything simulated is labelled DEMO (`is_demo`).
- Replay shows recorded events only; re-execution (fork) creates a new, separately billed run.
- Every workspace-scoped query filters by `workspaceId`; non-members get 404. Retrieval filters come only
  from the signed scope token.
- Pricing, citation and anchor logic exist in TS and Python; both must pass `packages/contracts/fixtures`.
- Web code is JavaScript/JSX; no hex colours in `src/features` (use tokens).
- Treat an unconfigured integration (GCP, OpenAI, Kaggle) as BLOCKED in the status file, not done.
