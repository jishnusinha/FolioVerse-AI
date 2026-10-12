# FolioVerse Implementation Status

States: PLANNED, IN_PROGRESS, DONE, BLOCKED. Execution is sequential by a single agent
(no concurrent workstreams actually ran). Evidence lists the validation command and outcome.
Build host: Windows 11, Node 22, pnpm 9.15, Python 3.12, Docker Desktop.

## Gate 0 — Foundation — DONE (CI push BLOCKED: no remote)

- `FV-G00-REPO-001` Monorepo scaffold — DONE. `pnpm install` and `python -m uv sync --all-packages --extra dev`
  succeed. Deviations: Node 22 (D-001), pnpm 9 (D-002), no Turborepo (D-004).
- `FV-G00-REPO-002` Shared config — DONE. `packages/shared-config` (eslint web/node presets, `tsconfig.base.json`,
  `ruff.toml`, `pyrightconfig.json`). `eslint src` on web exits 0; `ruff check` clean on ai-service.
- `FV-G00-ENV-003` Env templates + validation — DONE. `.env.example` documents every variable with empty secrets;
  `infrastructure/scripts/check-env.mjs` prints names only; API zod env schema, Python pydantic-settings;
  `gen-keys.mjs` fills missing secrets without printing them.
- `FV-G00-TOK-004` Design tokens — DONE. `node --test "test/*.test.mjs"` 5/5 pass; web build output contains
  `--fv-*` variables and `bg-fv-*` utilities generated from `@folioverse/design-tokens/tailwind.css`.
- `FV-G00-CON-005` Contracts v0 — DONE. `pnpm contracts:check` OK; generated `api-types.ts`, `web.d.ts`,
  `openapi/api.json` (55 paths). Pricing/anchor/citation fixtures pass in both TS (Jest) and Python (pytest).
- `FV-G00-WEB-006` Web skeleton — DONE. Vite + React 19 JSX, data router from `src/app/routes.js`
  (prototype paths + plan extras, D-016), Tailwind v4 on tokens, TanStack Query, placeholder page per route.
  Evidence: `vitest run` 34/34 pass (every route renders, redirect, not-found, Studio forced dark);
  `vite build` OK (364 kB JS, 10 kB CSS); `eslint src` 0; `tsc -p jsconfig.json` 0;
  `vite preview` serves `/app/knowledge` 200 with SPA fallback.
- `FV-G00-API-007` NestJS skeleton — DONE. `tsc --noEmit` OK; Jest unit 34 pass; integration suite
  (`jest -c jest.integration.config.js`, real Postgres/Redis/SeaweedFS) 15/15 pass incl. `/api/live`, `/api/ready`.
- `FV-G00-AI-008` FastAPI skeleton — DONE. `pytest` 66 pass (mock provider, hash embedder, no network);
  unauthorized internal call → 401 covered in `test_routes.py`; both roles start via `python -m folioverse_ai.serve`.
- `FV-G00-DB-009` Prisma slice schema — DONE. `prisma migrate deploy` applies `0001_init` to a fresh database
  (`folioverse_test`); dedupe/constraint behaviour covered by `ledger.spec.ts` (duplicate usage event,
  concurrent budget reservations: exactly 5 of 12 succeed against a 5.00 hard limit). Checkpointer tables are
  created at runtime in schema `langgraph` (D-012).
- `FV-G00-DOCK-010` Docker Compose — DONE (partial validation). `docker compose config` valid; data services
  (postgres, redis, qdrant, SeaweedFS, mailpit) ran healthy and backed the live smoke test. Application images
  (`api`, `ai`, `web` Dockerfiles) were NOT built locally because of host disk space; they are built in CI.
  `docker-compose.dev.yml` replaced by native dev (D-015).
- `FV-G00-DEV-011` One-command dev — DONE. `pnpm up -- --infra` (compose + migrate + seed) and `pnpm dev`
  (web, api, worker, ai-api, ai-ingest). Evidence: `node infrastructure/scripts/smoke.mjs` → SMOKE OK
  (upload → PREVIEW_READY → ingestion READY with real fastembed; grounded_qa streamed 37 events and finished
  ANSWERED with a VALID citation; receipt FINALIZED, DEMO; abstention with 0 model calls; cross-workspace 404).
- `FV-G00-CI-012` CI baseline — BLOCKED (no Git remote). `.github/workflows/ci.yml` written (path filters, node,
  api-integration, ai, docker jobs; `FV_LIVE_PROVIDER_TESTS=0`). Every job's commands were run locally and pass.
  Unblock: add a GitHub remote and push.
- `FV-G00-STAT-013` Planning files — DONE. `MASTER_IMPLEMENTATION_PLAN.md`, this file, `DECISION_LOG.md`.

Gate summary: the backend vertical slice works end to end locally with the mock provider. Open items carried
forward: application Docker images unbuilt locally; CI not yet run remotely; smoke receipt printed
`model=undefined` (receipt shape to align in Gate 3 UI); stray `", ` prefix in API pino log lines.
Next: Gate 1 (design system and shell).

## Gate 1 — Design System & Application Shell — DONE

Validation (apps/web, local Chrome via `PW_CHANNEL=chrome`, D-017): `vitest run` 123/123; `eslint src` clean;
`tsc -p jsconfig.json` 0; `vite build` OK; `playwright test` 34/34 (prototype 21, shell 7, visual 6).

- `FV-G01-PROTO-001` Prototype — DONE. `design-prototype/index.html` renders all 14 views with no script errors;
  palette navigation, notifications drawer (focus restore) and writer Folio Lens verified (`playwright/prototype.spec.js`).
  Two rendering bugs fixed (rail and brand icons collapsed to 0px width; D-019). References recorded:
  `apps/web/playwright/reference/home-{1280,1440,1920,mobile}.png` + `view-<view>-1440.png` for all 14 views.
  Known prototype quirk carried to Gate 8: Studio panes are auto-placed out of order at 1440px.
- `FV-G01-SHELL-002` AppShell — DONE. Prototype markup/classes: rail 60/224 (Ctrl+\, persisted), top bar 56 with
  breadcrumbs, search/palette trigger, + New, notifications; mobile bottom bar; `Panes` primitive with context (260)
  and inspector (330). Prototype CSS ported to `src/styles/components.css` (D-018).
- `FV-G01-UI-003` Primitives — DONE. `src/shared/ui`: Button, IconButton, Kbd, Input, Textarea, Select, Field, Dialog,
  Sheet, Tabs, Tooltip, DropdownMenu, Popover, Toast/Toaster, Badge, Skeleton, ScrollArea, Separator, Progress,
  Segmented, Table, KeyValue, Card, Callout; Command via cmdk in the palette.
- `FV-G01-STATE-004` States — DONE. `src/shared/states.js` (9 vocabularies) + `StatusBadge`, `StageTrack`,
  `DemoBadge`. `states.test.jsx` asserts every vocabulary equals `states.schema.json` and every value renders a badge.
- `FV-G01-OVL-005` Overlays — DONE (shells). CommandPalette (route + action registry, feature-registered commands),
  FolioLens (K/W/R action registry; loading/streaming/done/abstain/error states; roving focus, Escape, outside
  click), EvidenceDrawer (440; version drift, revoked/purged, weak/unresolved), RunReceipt (bound to the API receipt
  shape), ModelSelector (registry options only, DEMO and missing-price flags), ShortcutsDialog, Toaster.
- `FV-G01-THEME-006` Theme — DONE. `useThemeStore` light/dark/system (persisted, pre-paint script in `index.html`),
  Settings › Appearance control, Studio forced dark on `<main>`, reduced motion honoured, token font stacks.
- `FV-G01-A11Y-007` A11y — DONE. Skip link, focus return for dialogs/sheets (D-021), focus trap and roving tabindex
  utilities, shortcut registry (`?`, Ctrl/Cmd+K, Ctrl+\, `g h/k/w/l/d/s/c`) ignored while typing.
- `FV-G01-VR-008` Visual regression — DONE (win32 baseline). `playwright/visual.spec.js`, 2% threshold, shell at
  1280/1440/1920/mobile and gallery light/dark; baselines in `playwright/__screenshots__/visual/win32` (D-020).
  CI job `web-e2e` runs prototype + shell projects; Linux baseline deferred to Gate 13.
- `FV-G01-DOC-009` Gallery — DONE. `/app/docs/design` shows tokens, type scale, all state badges and stage tracks,
  citation chips, primitives and every overlay (DEMO data).

Also fixed: smoke script read non-existent `receipt.model`/`receipt.plan` (cause of `model=undefined`); it now reads
`modelCalls`/`modelPlan`.
## Gate 2 — Auth, Workspaces, Projects, Upload — DONE

Validation: API `test:integration` 72/72 against Postgres/Redis/SeaweedFS (`folioverse_test` DB, D-023), API unit 34/34,
API `tsc` 0 and `eslint` clean; web `vitest run` 150/150, `eslint src` clean, `tsc` 0, `vite build` OK; Playwright
`shell` 7/7 + `auth-upload` 3/3 against the fake API (D-024), `visual` 6/6 still within 2% of the Gate 1 baselines.

- `FV-G02-AUTH-001` Auth — DONE. register/login/refresh/logout/me, argon2id, `fv_at` 10 min, rotating `fv_rt` with
  family revocation on reuse, `fv_csrf` double-submit. Rate limits now use a Redis store shared by replicas (D-025).
  Tests: reuse detection, CSRF missing → 403, expired access → 401 `TOKEN_EXPIRED` then refresh → 200, logout revokes
  the refresh token, forgot-password → 429 after the limit. Web: register → onboarding, login → `next`, transparent
  refresh-and-retry in `src/api/client.js`, sign out (Playwright `auth-upload`).
- `FV-G02-AUTHZ-002` Authorization — DONE. Roles OWNER/ADMIN/EDITOR/VIEWER via `@RequireRole` + global guard (non-members
  → 404). `test/integration/authz.matrix.spec.ts` enumerates every workspace-scoped route from controller metadata (fails
  on unclassified routes) and checks outsider 404, below-role 403 and allowed roles never 401/403/5xx for 52 endpoints.
  ScopedPrisma extension replaced by explicit predicates + the matrix (D-022).
- `FV-G02-MAIL-003` Mail — DONE. Verification and reset emails via Mailpit SMTP (in-memory outbox in tests); single-use
  hashed tokens. Web pages `/verify-email`, `/auth/forgot-password`, `/reset-password`.
- `FV-G02-WS-004` Workspaces — DONE. PERSONAL workspace at signup, TEAM create, rename (`PATCH /workspaces/:id`, new),
  members/roles, invitations (+ web `/accept-invite`), workspace switcher in Knowledge (selection persisted).
- `FV-G02-PROJ-005` Projects/folders — DONE. Kinds, adjacency + materialized path, rename/move/archive/trash/restore; daily
  BullMQ `maintenance` purge after 30 days (`PurgeService`; no automated test yet because it calls the AI service purge).
- `FV-G02-UPL-006` Uploads — DONE (proxy mode, D-014). Session → PUT → complete verifies size, sha256 and magic bytes;
  pdf/docx/txt/md/epub; UPLOADING → UPLOADED → SCANNING → PREVIEW_READY or QUARANTINED. GCS adapter and >64 MB
  multipart are not implemented (local SeaweedFS only); see Gate 10.
- `FV-G02-SRC-007` Sources/versions — DONE. Immutable `source_versions`, stored objects, ranged file GET, version list and
  "Upload new version" flow in the web details panel.
- `FV-G02-AUD-008` Audit + idempotency — DONE. Audit rows asserted in `tenancy.spec.ts` (`auth.register`, `source.upload`).
- `FV-G02-FE-009` Web — DONE. Auth pages and onboarding (prototype `auth` view), Knowledge home (projects + create),
  project page (prototype `knowledge` view: folder tree with counts, filters, batch move/reprocess/trash, details panel,
  ingestion tray with retry, polling while busy), upload dialog (XHR progress, per-file state badges, rejected/quarantined
  states, cancel), trash with restore. Editing controls follow the member role (API still enforces).
- `FV-G02-TEST-010` Harness — DONE with deviations (D-023, D-024). Playwright project `auth-upload` added to `test:e2e`.

Also fixed: mis-encoded `·` in the document title (`AppShell.jsx`); a lint error in `file-scan.ts`.
Not done here: the unexplained untracked `apps/web/src/features/design/samples.js` (another session's file) is left
untouched and uncommitted at the user's request.
## Gate 3 — First Vertical Slice — DONE (live OpenAI path BLOCKED: no key)

Validation: Python `pytest` 70/70 and `ruff check` / `ruff format --check` clean; API integration 81/81 and unit 40/40,
`tsc` 0; `contracts:check` OK; web `vitest run` 171/171, `eslint src` clean; Playwright `slice` (fake API) and
`slice-live` against `pnpm dev` (register → upload → READY → ask → VALID citation → highlight → Studio → receipt →
Costs, 18.4 s); `node infrastructure/scripts/smoke.mjs` OK.

- `FV-G03-ING-001` Ingestion orchestration — DONE. BullMQ queues, `ingestion_jobs` state machine, `AiServiceClient`
  (internal ES256 JWT, NDJSON reader, timeouts, retry by error class); `test/unit/ai-client.spec.ts` with a fake NDJSON server.
- `FV-G03-ING-002` Ingest pipeline — DONE with deviation D-006 (purpose-built parsers instead of Unstructured).
  `test_ingestion.py`: markdown, PDF word boxes, DOCX headings, EPUB spine, corrupt/unsupported files.
- `FV-G03-ING-003` Chunking — DONE with deviation D-027 (offline token approximation instead of tiktoken). Determinism
  and idempotent re-ingest tests.
- `FV-G03-ING-004` Indexing — DONE. fastembed dense + BM25 sparse in Qdrant `fv_chunks_v1` with deterministic point ids;
  READY/PARTIAL/FAILED/QUARANTINED transitions covered by `test_ingestion.py` and the API tenancy suite.
- `FV-G03-ING-005` Ingestion SSE — DONE. `GET /api/workspaces/:id/events` (Redis Stream, Last-Event-ID); web
  `useWorkspaceEvents()` mounted in the shell patches the source caches (`applyWorkspaceEvent`, unit-tested).
- `FV-G03-RAG-006` Scope resolution — DONE. `context_scopes`, signed 5-minute ScopeToken; tampered or mismatched token →
  401 (`test_scope_token_must_match_run`); cross-workspace isolation test.
- `FV-G03-RAG-007` Hybrid retrieval — DONE. Dense + sparse prefetch → RRF, optional rerank flag, parent expansion, token
  packer, `retrieval_events`; `test_eval_retrieval.py` logs recall@k on `qa-small.jsonl` (not gating, D-031).
- `FV-G03-RAG-008` Providers — DONE for Mock; `OpenAIAdapter` implemented, live test BLOCKED (no `OPENAI_API_KEY`).
- `FV-G03-RAG-009` `grounded_qa` — DONE. Abstention with zero model calls; citation fixtures in TS and Python; anchors
  follow the quoted page (`test_anchors_pdf.py`, D-028). BudgetGuard: under a hard budget the plan carries
  `budgetGuard {maxCost, prices}`; the graph re-prices the real prompt and routes to `budget_stop` (BUDGET_REJECTED,
  no model call) instead of generating (`test_budget_guard.py`, API test "hands the graph a budget guard only under a
  hard budget"). Pause-for-approval is deferred (D-033).
- `FV-G03-RUN-010` Run lifecycle — DONE. Admission, reservation, Redis Stream relay, persisted events, cancel, heartbeat
  reaper → INTERRUPTED (integration test), hard-budget rejection before any model call.
- `FV-G03-CONV-011` Conversations — DONE. Threads, message tree, citations; fetch-based SSE with Last-Event-ID (D-026);
  resume without duplicated text (web test with a cut stream). A new conversation scoped to one document is filed
  under that document and its project (`threads.sourceId`), so the document page lists it.
- `FV-G03-LEDGER-012` Ledger — DONE. Shared pricing fixtures pass in TS and Python; duplicate usage events are ignored;
  runs without model calls get a zero FINALIZED receipt (D-029).
- `FV-G03-RCPT-013` Receipt + evidence — DONE. Receipt endpoint; `RunReceipt`, evidence drawer, citation chip → PDF
  highlight on the anchor page. Trace link: the receipt shows the run trace inside Studio; OTel trace ids arrive with
  Gate 10.
- `FV-G03-VIEW-014` Document page — DONE. react-pdf viewer with text layer and bbox highlight (direct `pdfjs-dist`
  dependency, D-030), version selector, chat with streaming, branch selector, abstain, interrupted and BUDGET_REJECTED
  states, ask disabled while indexing.
- `FV-G03-STUDIO-015` Studio minimal — DONE. Run explorer, dagre graph from the graph JSON endpoint, node list, timeline,
  replay of recorded events only. Pane placement fixed with explicit grid columns (the Gate 1 visual note).
- `FV-G03-COST-016` Cost minimal — DONE. Month-to-date, per-run receipts with estimate/final badges, "No model call" rows.
- `FV-G03-E2E-017` Slice E2E — DONE with the mock provider (`slice`, `slice-live` opt-in via `FV_E2E_BASE_URL`, D-032).
  Live OpenAI dispatch BLOCKED.

Also: Home page (continue a conversation, budget, recent runs, projects); visual baselines re-recorded against an empty
fake workspace (D-034). Not done: OTel span linking (Gate 10), Linux visual baselines (Gate 13).

## Gate 4 — Knowledge Advanced — DONE (live model path BLOCKED: no key)

Validation: Python `pytest` 86/86, `ruff check` / `ruff format --check` clean; API unit 46/46, integration 97/97
(`knowledge.spec.ts` new), `tsc` 0, eslint clean; `contracts:check` OK; web `vitest run` 198/198, `eslint src` clean,
`vite build` OK (knowledge map chunk lazy-loaded); Playwright `visual`/`shell`/`auth-upload`/`slice`/`preview` pass,
`gate4-preview.spec.js` (Chrome, fake API) covers knowledge map, Lens → note → "Show in document", artifact page,
search page and palette search; `node infrastructure/scripts/smoke.mjs` OK against `pnpm dev` (insight
`quick_summary` and `knowledge_map` artifacts with validated citations, note + `search?q=procurement` finds note and
passage with `semantic=OK`).

- `FV-G04-INS-001` Insight registry — DONE. 14 actions in `packages/contracts/fixtures/insight-actions.json` mapped to
  graph and tier; the API registry (`insight-actions.spec.ts`), the web fake and Python (`test_insight_actions.py`) are
  checked against it (D-036). Summaries/key facts T0 over packed context, study tools T1, `multi_doc_compare`,
  `risk_contradiction` (risks and contradictions with evidence pairs), `knowledge_map` JSON. Mock knowledge maps fall
  back to recurring key terms when a document has few proper nouns (D-043).
- `FV-G04-ART-002` Artifacts — DONE. `artifacts` table (migration `0002_knowledge`), list/get/rename/archive/delete API,
  per-version pins with `currentVersionId`; uploading a new version marks pinned artifacts stale (integration test).
  Every successful insight run is saved automatically (D-035). Web: project artifact list, artifact page (pins, stale
  callout, regenerate on current version, rename/archive/delete, citations → document).
- `FV-G04-SRCH-003` Workspace search — DONE. Postgres FTS over source/thread/artifact titles and notes (GIN indexes in
  SQL only, D-037) merged with semantic passages from Qdrant through the AI service under a one-minute scope token
  (D-038); semantic failure degrades to `UNAVAILABLE`. Web: `/app/search` grouped results and palette "In this
  workspace" results.
- `FV-G04-CONV-004` Conversations — DONE. Thread rename/archive/search, branch compare dialog, attach/detach sources
  mid-thread creates a new `context_scope` that later questions inherit (D-039; integration test).
- `FV-G04-DOCX-005` Reading view — DONE. DOCX/MD/TXT canonical text with numbered paragraph anchors (`p-<page>-<n>`)
  and a version diff summary (`sources/diff.ts`, `diff.spec.ts`; "Changes since v<n>" on the document page).
- `FV-G04-LENS-006` Folio Lens knowledge actions — DONE. Explain, define, list facts, ask, find related (workspace
  search, D-041), add to notes with a selection anchor (page, text quote, text position from DOM ranges) and compare;
  "Show in document" returns to the exact passage (PDF switches to the text view when there is no bbox, D-042). Ask
  actions run as grounded chat questions (D-040); viewers only get "Find related evidence".
- `FV-G04-BATCH-007` Batch ops and ingestion retry — DONE in Gate 2/3 (multi-select move/delete, retry failed
  ingestion); unchanged here.
- `FV-G04-MAP-008` Knowledge map — DONE. `@xyflow/react` + dagre canvas (lazy chunk) with an accessible concept list;
  node → evidence drawer (web test and Gate 4 preview spec).

Not done: live-model insight quality (BLOCKED, no `OPENAI_API_KEY`); the web fake serves the same pages for every
version of the demo PDF (D-044).

## Gates 5–13 — PLANNED

## External setup (Section N)
- OpenAI API key — BLOCKED until provided (`OPENAI_API_KEY`, `FV_LIVE_PROVIDER_TESTS=1`). Mock provider used.
- GCP project / WIF / Artifact Registry — BLOCKED.
- GitHub remote + Actions — BLOCKED.
- Kaggle account — BLOCKED (notebooks run locally only).
