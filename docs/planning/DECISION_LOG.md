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

## D-017 Playwright may use a system browser locally
- Context: the cached Playwright Chromium (rev 1243) does not match `@playwright/test` 1.64 (rev 1248); downloading it costs ~300 MB on a nearly full system drive.
- Decision: `playwright.config.js` reads `PW_CHANNEL` (`chrome` or `msedge`) and uses the installed system browser when set. CI installs Playwright's Chromium (`playwright install --with-deps chromium`).

## D-018 Prototype CSS as the component layer; owned JSX primitives
- Context: the plan asks for shadcn-style JSX primitives and 1:1 fidelity with the prototype.
- Decision: the prototype's component/layout CSS (sections 2–6) is ported verbatim into `src/styles/components.css` inside `@layer components`, so Tailwind utilities still override it. Primitives in `src/shared/ui` are owned JSX (shadcn approach: source in repo) that render the prototype classes on top of the already-installed Radix packages (dialog, dropdown, popover, tabs, tooltip) and cmdk. Select, Progress, ScrollArea, Separator and Toast use native elements or local code instead of adding more Radix packages.
- Consequence: no new dependencies; visual parity comes from shared class names and tokens.

## D-019 Prototype rendering fixes
- Context: in the collapsed rail the nav and brand SVGs shrank to 0px because the hidden label still occupied flex space.
- Decision: added `flex-shrink:0` to `.nav-btn svg` and `.brand svg` in both the prototype and the app CSS; references re-recorded.

## D-020 Visual regression baselines are per platform; prototype screenshots are references
- Context: font rendering differs between Windows and Linux, and placeholder pages differ in content from the prototype's demo screens, so a pixel diff against the prototype is not meaningful yet.
- Decision: prototype screenshots in `playwright/reference/` are fidelity references for review. The VR gate compares the app against its own committed baseline (2% threshold), stored per platform (`__screenshots__/visual/win32`). Linux baselines are generated in Gate 13; CI runs prototype + shell projects until then.

## D-021 Focus return for Radix dialogs opened from arbitrary controls
- Context: Radix modal dialogs return focus only to a Radix `Trigger`; our dialogs are opened from shell buttons, shortcuts and the palette, so focus was lost on close.
- Decision: the `Dialog`/`Sheet` wrappers remember the focused element at open time and restore it in `onCloseAutoFocus`.

## D-022 Workspace scoping by explicit predicates instead of a ScopedPrisma extension
- Context: the plan proposes a Prisma client extension that injects the workspace predicate. Query extensions do not
  cover nested writes, `$transaction` arrays built from the base client, or raw SQL, so they give partial protection.
- Decision: every workspace-scoped query passes `workspaceId` explicitly; the global guard resolves membership and
  returns 404 to non-members. `authz.matrix.spec.ts` derives the route list from controller metadata so a new endpoint
  cannot ship without a role classification and outsider/role tests.

## D-023 Integration tests use the compose data services, not Testcontainers
- Context: Testcontainers would pull and start fresh Postgres/Redis/S3 containers per run on a nearly full system drive.
- Decision: the integration suite runs against the existing compose services with a dedicated `folioverse_test`
  database (migrated in `global-setup.ts`), per-test random users, and per-instance rate-limit key prefixes. CI provides
  the same services as job `services:`.

## D-024 Web E2E runs against an in-memory fake API
- Context: Gate 2 asks for a "mock everything" E2E job; booting the API, worker and AI services in the web job is slow.
- Decision: `src/test/fakeApi.js` implements the Gate 2 endpoints in memory (DEMO data, problem+json errors, CSRF,
  roles, 401/refresh). Vitest installs it as `fetch`; Playwright routes `/api/**` to it (`playwright/fixtures.js`).
  The real API is covered by the Supertest integration suite and `infrastructure/scripts/smoke.mjs`.

## D-025 Rate-limit counters in Redis without a new dependency
- Context: `@nestjs/throttler` defaults to per-process memory; the plan asks for a Redis store.
- Decision: `RedisThrottlerStorage` (one Lua script: INCR + PEXPIRE + block key) on the existing ioredis client.

## D-026 Run and workspace streams use fetch-based SSE, not EventSource
- Context: `EventSource` cannot send the CSRF/credential headers we need consistently, gives no status code on failure,
  and cannot be faked in Vitest/Playwright without a polyfill.
- Decision: `readEventStream` in `src/api/client.js` reads `text/event-stream` over `fetch`, sends `Last-Event-ID` on
  reconnect, stops on 204/401/403/404 and backs off up to 30 s otherwise.

## D-027 Offline token approximation instead of tiktoken
- Context: tiktoken downloads its BPE files on first use, which breaks offline CI and the "no network" test rule.
- Decision: `folioverse_ai.text.count_tokens` counts words and punctuation. Chunk sizes and the budget guard use it;
  billing always uses provider-reported usage, never this estimate.

## D-028 Citation anchors use the page of the quoted text
- Context: a parent chunk can span pages; anchoring to the chunk's first page highlighted the wrong page.
- Decision: `_quote_page` locates the validated quote inside the chunk's page spans and anchors to that page and box.

## D-029 Zero-cost FINALIZED receipt for runs with no model call
- Context: abstained and budget-stopped runs have no usage events, so their receipts showed no final tier.
- Decision: the receipt reports tier FINALIZED with total 0 for a terminal run with no model calls (no ledger row is
  invented); the Costs page shows such runs as "No model call".

## D-030 Direct `pdfjs-dist` dependency
- Context: react-pdf bundles its own pdfjs; the worker URL must match the exact version under Vite.
- Decision: pin `pdfjs-dist` 4.8.69 directly and load the worker from that package.

## D-031 Retrieval evaluation is logged, not gating
- Context: recall@k on a tiny synthetic set is noisy; the plan marks it "logged, not gating".
- Decision: `test_eval_retrieval.py` prints recall@k, page recall and abstain accuracy and only warns below the 0.8
  recall floor; it fails only if ingestion or the dataset breaks.

## D-032 Fake AI endpoints for web tests; live slice E2E is opt-in
- Context: D-024's fake API covered Gate 2 only.
- Decision: `src/test/fakeAi.js` adds runs, SSE events (with a cut-stream option), receipts, traces, threads, costs and
  pages with DEMO prices. `playwright/slice-live.spec.js` runs the same flow against a real stack only when
  `FV_E2E_BASE_URL` is set.

## D-033 BudgetGuard stops before generate; approval pause deferred
- Context: the plan asks for a BudgetGuard interrupt "when plan says so" but defines no policy.
- Decision: the API adds `budgetGuard {maxCost = reservation + remaining headroom, prices}` to the ModelPlan only under a
  hard budget. `grounded_qa` prices the real prompt plus `maxOutputTokens` and, if it exceeds `maxCost`, finishes as
  BUDGET_REJECTED with no model call and nothing charged. An AWAITING_INPUT approval flow (pause and resume) needs a
  product decision and is deferred to Gate 9 budgets.

## D-034 Visual baselines use an empty fake workspace
- Context: the seeded demo run made the shell screenshots depend on fake run data.
- Decision: `visual.spec.js` uses `apiOptions: { empty: true }`; Win32 baselines were re-recorded.

## D-016 Web route paths follow the prototype
- Context: Section O of the plan abbreviates routes (`/app/knowledge/:projectId/doc/:sourceId`, `/app/library/read/:itemId`, `/app/discover/lab`), while `design-prototype/index.html` (Prompt 3) uses `/app/knowledge/projects/:projectId/documents/:sourceId`, `/app/library/books/:itemId/read`, `/app/discover/recommendation-lab`.
- Decision: `src/app/routes.js` follows the prototype paths (the plan says routes mirror Prompt 3 Part D) and adds the plan-only routes: `/auth/*`, `/reset-password`, `/verify-email` (links sent by the API mailer), `/app/writer/manuscripts/:id/continuity`, `/app/admin/pricing`, `/app/admin/models`. Gate 2 adds `/accept-invite` (invitation emails) and `/app/knowledge/trash`.
