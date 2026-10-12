# FolioVerse Decision Log

ADR-lite entries. Each records a deviation from, or refinement of, the frozen decisions in
`MASTER_IMPLEMENTATION_PLAN.md` Section A.

## D-001 Node 22 LTS instead of Node 24
- Context: build host has Node v22.22.0; Node 24 is not installed.
- Decision: `.nvmrc` = 22, `engines.node >= 22`, Dockerfiles use `node:22-slim`.
- Consequence: no Node-24-only APIs are used. Upgrade is a one-line change.

## D-002 pnpm 9.15 instead of pnpm 10
- Context: host has pnpm 9.15.0.
- Decision: `packageManager: pnpm@9.15.0`. Workspace semantics are identical for our use.

## D-003 uv invoked as `python -m uv`
- Context: `uv` was not on PATH; installed with `pip install --user uv` (0.13.0).
- Decision: root scripts call `python -m uv ...` so they work without PATH changes. CI installs uv via the official action.

## D-004 No Turborepo
- Context: plan listed `turbo.json`. Task fan-out via `pnpm -r --if-present run <task>` covers our needs with fewer moving parts.
- Decision: drop Turborepo; root scripts use pnpm recursive runs. CI uses path filters for selectivity.

## D-005 fastembed (ONNX) for dense + sparse embeddings instead of sentence-transformers/torch
- Context: CPU torch adds ~1 GB to the AI image and slow cold starts; fastembed ships `BAAI/bge-small-en-v1.5` (dense) and `Qdrant/bm25` (sparse) on onnxruntime.
- Decision: `FV_EMBEDDER=fastembed` in containers; `FV_EMBEDDER=hash` (deterministic feature-hashing embedder) for unit tests and CI so tests run offline without model downloads. Both implement the same `Embedder` protocol.
- Consequence: same model family as planned; reranker remains optional behind `FV_RERANK=1` (fastembed cross-encoder).

## D-006 pdfplumber/python-docx/ebooklib parsers instead of Unstructured
- Context: Unstructured pulls in heavy system deps (poppler, tesseract, libmagic) that complicate Windows dev and slim images.
- Decision: purpose-built parsers per type (pdfplumber with word boxes for PDF, python-docx for DOCX, ebooklib + html parsing for EPUB, plain text/markdown). They emit the same normalized element model with locators (page, bbox, char offsets, heading path). Unstructured can be added later behind the same `Parser` protocol.

## D-007 Docker daemon availability
- Context: Docker Desktop was not running at build start; it was launched by the agent. Compose-based validation is performed only when the daemon is reachable and its outcome is recorded in `IMPLEMENTATION_STATUS.md`.

## D-008 SeaweedFS instead of MinIO for local S3
- Context: `minio/minio` and `minio/mc` could not be pulled from this host ("repository does not exist").
- Decision: `chrislusf/seaweedfs:3.80` S3 gateway on :9000 behind the same `StoragePort`; credentials come from env. No init container: the API creates the bucket on startup (`ensureBucket`).
- Consequence: any S3-compatible store (MinIO, GCS XML API) still works; only the compose service changed.

## D-009 AWS SDK checksum mode `WHEN_REQUIRED`
- Context: AWS SDK v3 defaults to aws-chunked uploads with checksum trailers, which SeaweedFS and the GCS XML API reject (seen as upload SIZE_MISMATCH).
- Decision: `requestChecksumCalculation` and `responseChecksumValidation` set to `WHEN_REQUIRED` in `StorageService`. Integrity is still enforced by our own sha256 on `complete`.

## D-010 Python launcher forces a selector event loop on Windows
- Context: uvicorn >= 0.36 chooses a Proactor loop on Windows; psycopg's async driver needs a selector loop, so `/readyz` hung and Postgres checks failed.
- Decision: `python -m folioverse_ai.serve` passes `loop="asyncio:SelectorEventLoop"` on win32 (`auto` elsewhere) and loads `--env-file`. Docker and dev scripts use this launcher.

## D-011 Separate worker build output
- Context: two `nest start --watch` processes (http, worker) deleting the shared `dist/` raced (EPERM).
- Decision: `tsconfig.worker.json` builds the worker into `dist-worker/`.

## D-012 LangGraph checkpointer schema created at runtime
- Context: the plan listed `scripts/langgraph-setup.py`.
- Decision: `AsyncPostgresSaver.setup()` runs on first use with `search_path=langgraph` (schema auto-created); `FV_CHECKPOINTER=memory` for tests. No separate setup script.

## D-013 `local-compute` registry entry has no price
- Context: local CPU embedding work is metered as usage but no real price exists.
- Decision: entry `local-compute` (provider `local`) without a price, so its cost entries are FINAL_ESTIMATED with PRICE_MISSING until an admin enters a rate with a source URL. No invented prices.

## D-014 Proxy upload mode is the default
- Context: signed PUT direct-to-bucket requires bucket CORS, which differs across SeaweedFS/MinIO/GCS.
- Decision: default `FV_UPLOAD_MODE=proxy` (API streams to storage and verifies size/sha256/magic bytes); signed-URL mode remains available behind config.

## D-015 Native app processes with data services in Docker for development
- Context: host disk space is limited (low single-digit GB free on C: and D: at times); building five application images locally is not feasible, and the plan's `docker-compose.dev.yml` bind-mount setup duplicates node_modules inside containers.
- Decision: `pnpm up -- --infra` runs only the data services in Docker; `pnpm dev` runs web, api, worker, ai-api and ai-ingest natively. Full-Docker mode (`pnpm up`, compose profile `app`) remains and is built in CI. No `docker-compose.dev.yml`.
- Consequence: application Dockerfiles are validated in CI, not locally; recorded in the status file.

## D-016 Web route paths follow the prototype
- Context: Section O of the plan abbreviates routes (`/app/knowledge/:projectId/doc/:sourceId`, `/app/library/read/:itemId`, `/app/discover/lab`), while `design-prototype/index.html` (Prompt 3) uses `/app/knowledge/projects/:projectId/documents/:sourceId`, `/app/library/books/:itemId/read`, `/app/discover/recommendation-lab`.
- Decision: `src/app/routes.js` follows the prototype paths (the plan says routes mirror Prompt 3 Part D) and adds the plan-only routes: `/auth/*`, `/reset-password`, `/verify-email` (links sent by the API mailer), `/app/writer/manuscripts/:id/continuity`, `/app/admin/pricing`, `/app/admin/models`.
