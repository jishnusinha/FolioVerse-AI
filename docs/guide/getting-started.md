---
title: Local setup
description: Install the toolchain, start the data services and run every FolioVerse service on your machine.
section: Developers
order: 1
gates: [0]
---

FolioVerse runs entirely on one machine with Docker for the data services. No cloud account or model provider
key is needed: without a key the AI service uses the deterministic DEMO mock model.

## Prerequisites

- Docker Desktop (with WSL2 on Windows).
- Node.js 22 or newer (`.nvmrc` pins 22; Node 24 is also used) and pnpm 9.15 (`corepack enable`).
- Python 3.12 and [uv](https://docs.astral.sh/uv/) (`python -m pip install uv` works too; the scripts call
  `python -m uv`).

## Install

```bash
pnpm install
python -m uv sync --all-packages --extra dev
```

The first `pnpm up` writes a `.env` from `.env.example` and generates the local secrets (JWT secret, ES256 key
pair). Secret values are never printed. Never commit `.env`.

## Option A: data services in Docker, apps native

```bash
pnpm up -- --infra   # Postgres, Redis, Qdrant, S3 storage (SeaweedFS), Mailpit; then migrate + seed
pnpm dev             # web, api, worker, ai-api and ai-ingest with prefixed logs
```

| Service | URL |
| --- | --- |
| Web (Vite) | http://localhost:5173 |
| API (NestJS) | http://localhost:3000/api |
| AI service, runs | http://localhost:8000 |
| AI service, ingestion | http://localhost:8001 |
| Mailpit (verification and reset emails) | http://localhost:8025 |

## Option B: everything in Docker

```bash
pnpm up              # builds the images, migrates, seeds and waits for health
```

The app is then at http://localhost:8080, with the API behind the same origin under `/api` and this
documentation site under `/docs`. `pnpm down` stops the stack.

## Useful options

- `pnpm up -- --infra --observability` also starts the OpenTelemetry collector and Grafana LGTM
  (http://localhost:3001). See [Observability](observability.md).
- `FV_DEMO_CATALOG=true` (the template default) loads the synthetic Discover catalog during `db:seed`; set it to
  `false` for real deployments.
- `FV_SEED_ADMIN_EMAIL` makes the account that registers with that email a super admin (prices, model
  registry, platform costs).
- `FV_EMBEDDER=fastembed` (the template default) uses `BAAI/bge-small-en-v1.5` dense and `Qdrant/bm25` sparse
  vectors, downloaded on first use; `hash` is a deterministic lexical stand-in that needs no download (tests use it).
- `docker compose --profile local-llm up -d ollama` plus `FV_OLLAMA_URL` enables a local Ollama model.

## Checks

```bash
pnpm test                               # JS/TS unit tests and pytest, mock model, no network
pnpm typecheck && pnpm lint
pnpm test:integration                   # API against the Docker data services
node infrastructure/scripts/smoke.mjs   # end-to-end backend slice against a running stack
pnpm kaggle:smoke                       # research notebooks in smoke mode
pnpm docs:build                         # this documentation site
```

Default tests never call a paid provider. Live provider tests run only with `FV_LIVE_PROVIDER_TESTS=1` and a key.

## Troubleshooting setup

`pnpm check:env` reports missing or malformed variables by name. If a document stays in `INDEXING`, see
[Troubleshooting](troubleshooting.md).
