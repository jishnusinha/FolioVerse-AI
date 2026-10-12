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
## Gate 2 — Auth, Workspaces, Projects, Upload — PLANNED
## Gate 3 — First Vertical Slice — PLANNED (backend slice already passing smoke; UI pending)
## Gates 4–13 — PLANNED

## External setup (Section N)
- OpenAI API key — BLOCKED until provided (`OPENAI_API_KEY`, `FV_LIVE_PROVIDER_TESTS=1`). Mock provider used.
- GCP project / WIF / Artifact Registry — BLOCKED.
- GitHub remote + Actions — BLOCKED.
- Kaggle account — BLOCKED (notebooks run locally only).
