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
| `apps/docs` | Astro Starlight documentation site; content is generated from `docs/` and the repo on each build |
| `docs/guide` | Guide pages (single source for the site and the in-app help at `/app/docs`) |
| `packages/contracts` | JSON Schemas, golden fixtures (pricing, citations, anchors), generated types |
| `packages/design-tokens` | `tokens.json` → CSS variables, Tailwind `@theme`, JS |
| `packages/folioverse-ml` | Recommendation models and offline evaluation (Python) |
| `ml-notebooks` | Eleven jupytext-paired evaluation notebooks (`.py` is the source) and `fvnb.py` helpers |
| `config/models/registry.seed.yaml` | Model registry seed (no hard-coded real model ids or prices) |
| `infrastructure/` | Docker files, scripts (`up`, `dev`, `smoke`, `gen-keys`, `check-env`, `backup`), OTel collector, Grafana, Terraform, runbooks |

## Commands

```bash
pnpm install && python -m uv sync --all-packages --extra dev   # install
pnpm up -- --infra      # data services in Docker + migrate + seed
pnpm dev                # web, api, worker, ai-api, ai-ingest natively
pnpm up                 # everything in Docker (http://localhost:8080)
pnpm test               # JS/TS unit tests + pytest (mock model, no network)
pnpm typecheck && pnpm lint
node infrastructure/scripts/smoke.mjs   # backend vertical slice against a running stack
pnpm smoke:deployed -- --base <url>     # read-only checks of any deployment
pnpm up -- --infra --observability      # adds the OTel collector + Grafana LGTM (http://localhost:3001)
pnpm backup:drill                       # back up, restore side by side, compare counts, clean up
pnpm docs:build                         # Starlight site (apps/docs) from docs/, runbooks, OpenAPI, Prisma; served at /docs
pnpm docs:shots                         # documentation screenshots of the real app (needs a running stack)
pnpm test:infra                         # infra script tests + Grafana/runbook consistency
pnpm kaggle:smoke                       # notebooks in smoke mode (needs `uv sync ... --extra notebooks`)
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
- Documentation status badges come from `IMPLEMENTATION_STATUS.md`; guide pages declare `gates`, `blocked` and
  `demo` in frontmatter instead of claiming a state. Screenshots come only from `pnpm docs:shots`.
- After changing routes in `apps/ai-service`, re-export `packages/contracts/openapi/ai.json`
  (`python -m uv run --directory apps/ai-service python -m folioverse_ai.openapi_export`).
- Notebooks: edit the `.py` file, never only the `.ipynb`; findings go through `fvnb.finding` (computed, not typed).
  Regenerate outputs with `node ml-notebooks/run-smoke.mjs --full` before committing changed notebooks.
