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

## D-035 Insight artifacts are saved automatically per run
- Context: the plan lists an artifacts table but not when an artifact is created.
- Decision: the run executor saves an artifact when an artifact graph finishes SUCCEEDED or PARTIAL, pinned to the
  packed source versions; `run.finished` carries `artifactId`. Users archive or delete artifacts they don't want instead of
  saving them explicitly.

## D-036 Insight action registry is a contract fixture
- Decision: `packages/contracts/fixtures/insight-actions.json` holds the 14 actions with graph and tier. The API registry
  and the web fake are TypeScript/JS copies checked for equality in tests; Python reads the fixture in its test.

## D-037 Full-text indexes live only in SQL migrations
- Context: Prisma cannot express expression GIN indexes.
- Decision: `0002_knowledge` creates `to_tsvector('english', …)` GIN indexes on source/thread/artifact titles and note
  text by hand; the Prisma schema does not declare them, so they must not be dropped by future `migrate diff` output.

## D-038 Semantic search uses a per-search scope token
- Decision: search signs a 60-second scope token listing the workspace's READY current versions for a random search id;
  the AI service accepts filters only from that token. If the AI service fails, keyword results are returned with
  `semantic.status = UNAVAILABLE`.

## D-039 Changing a thread's sources creates a new context scope
- Decision: `PUT /threads/:id/scope` stores a new `context_scope` and points the thread at it; runs in that thread without
  an explicit scope inherit it. Earlier runs keep their original scope, so receipts and replays stay accurate.

## D-040 Folio Lens ask actions are grounded chat questions
- Decision: explain, define, list facts and compare send a templated question through `grounded_qa` in the document's
  chat (with citations and a receipt), instead of separate graphs. They are disabled when asking is blocked or for viewers.

## D-041 "Find related evidence" uses workspace search
- Decision: the Lens calls `/search` with the selected text scoped to the project and shows passages, notes and artifacts;
  no model call, so it is free and available to viewers.

## D-042 "Show in document" for text anchors switches the PDF to the text view
- Context: notes anchored by text quote have no bbox to highlight on the rendered PDF.
- Decision: when the anchor has no bbox the document opens in the text view and highlights the quote (whitespace-insensitive
  match; selection offsets computed from DOM ranges because Chrome's `Selection.toString()` collapses newlines).

## D-043 Mock knowledge maps fall back to key terms
- Context: the extractive knowledge map used repeated proper nouns, which yields an empty map for short non-fiction.
- Decision: with fewer than three entities the mock adds recurring key terms; node markers become cited claims
  (`label [S#]`) so map nodes carry validated citations.

## D-044 The web fake serves the same pages for every version
- Decision: `fakeKnowledge.js` returns the demo PDF's pages for any version id and a scripted diff; real per-version text
  is covered by the API integration tests.

## D-045 Author snapshots coalesce; AI, undo and restore snapshots do not
- Context: autosave every 1.2 s would create hundreds of revisions per session.
- Decision: an `AUTHOR` save by the same user within 5 minutes of the latest `AUTHOR` snapshot updates that snapshot
  (same revision row, new content). `POST_AI`, `UNDO` and `RESTORE` saves always create a new snapshot so every AI
  change and every restore can be found and reverted.

## D-046 Restore saves a new RESTORE revision
- Context: restore originally reused the author save path, so a restore within 5 minutes of an author save could
  coalesce into that snapshot and lose the version the author was restoring away from.
- Decision: `saveDoc(..., { restoreOf })` records origin `RESTORE` with note "Restored rN" and never coalesces;
  `writer.spec.ts` asserts the history after a restore.

## D-047 Batch revision is one T0 run per paragraph
- Decision: "Revise whole scene" creates one `writer_revision` run per prose paragraph, sharing a `batchId`, each with
  its own estimate and receipt. Budget rejection is reported per paragraph (`budgetRejected`); there is no combined
  multi-paragraph prompt, so a stale paragraph never invalidates the others.

## D-048 Accept and undo are document saves
- Decision: the client applies the chosen variant locally and sends the whole document with `action: accept|undo`,
  `suggestionId`, `variant` and the known `revision`. The server checks that the saved block text equals the
  suggestion's `baseText` (otherwise `SUGGESTION_STALE`) and that the new block equals the variant
  (`VARIANT_MISMATCH`), so accept goes through the same optimistic concurrency as typing. Accepted blocks carry
  `aiAssisted` (a margin line in the editor).

## D-049 AI only proposes story facts
- Decision: `dna_extraction` writes facts and links as `PROPOSED`/`AI_EXTRACTED`; only an author action makes them
  `CANON`, and rejecting retires them with note "Rejected by author" so re-extraction does not propose them again.
  Continuity checks compare against `CANON` only.

## D-050 Fact evidence is re-resolved on read
- Decision: evidence stores `{nodeId, blockId, quote}`; `GET dna` resolves it against the current scene text as EXACT
  (same block), SHIFTED (quote moved to another block), FUZZY (normalised match) or ORPHANED, using the same anchor
  states as Knowledge citations.

## D-051 Continuity issues are fingerprinted
- Decision: an issue's fingerprint hashes `(scene, entity, fact, found value, normalised quote)`. A re-check never
  duplicates an issue, keeps DISMISSED issues dismissed, reopens a RESOLVED issue whose contradiction is back, and
  resolves open issues the check no longer finds. Editing the quoted passage changes the fingerprint, so a dismissed
  issue can return once its passage changes.

## D-052 Research notes copy the excerpt
- Decision: a note created from an excerpt copies the quote and `{sourceId, sourceVersionId, projectId, title, anchor}`,
  so deleting the excerpt or uploading a new source version does not change a footnote that is already in the text.

## D-053 PDF export uses the browser's print
- Decision: `/app/writer/manuscripts/:id/print` renders the compiled manuscript with numbered footnotes; print CSS hides
  the shell and breaks pages before parts. No server-side PDF renderer (no headless browser in the API image). MD and
  DOCX are generated by the API.

## D-054 Writer Lens actions
- Decision: Lens offers Rewrite paragraph, Tighten (`shorten`), Expand, Change tone… (tone list) and Look up canon. The
  first four create suggestions for the paragraph under the selection (a partial selection adds an instruction naming
  the selected words); canon lookup is free and is the only action for viewers. Knowledge documents gain "Save as
  excerpt".

## D-055 Draft recovery falls back to memory
- Decision: unsaved edits are written to IndexedDB (`folioverse-writer/drafts`, key `workspace:scene`) 300 ms after a
  change and removed after a successful save. When IndexedDB is unavailable (private mode, jsdom) a memory store is
  used, so recovery is per-tab only. Conflict responses include `problem.current` so the merge dialog needs no extra
  request.

## D-056 Test `Request` shim for Node 24
- Context: the local Node runtime is now 24.19; its `Request` rejects jsdom's `AbortSignal`, which React Router passes
  on every navigation, so navigation tests failed.
- Decision: `src/test/setup.js` subclasses `Request` to keep the signal outside undici. Test-only; no app code change.

## D-057 EPUB chapters are pages; `href` places a passage
- Context: the retrieval stack, citations and anchors are page based. epub.js only writes the `[id]` step assertion
  when the spine itemref has an `id`; ebooklib-built books (including the synthetic one) have none, so client CFIs look
  like `epubcfi(/6/2!/4/4,/1:0,/1:44)`.
- Decision: the parser emits one page per spine chapter (1-based, `href` relative to the OPF, paragraph CFIs) and
  chunking never crosses a chapter, so `page_start == page_end` for book chunks. A locator is placed by `href` first,
  then the CFI spine step (`/6/(2n)`), then `locations.page`. TS (API, web) share `locator-cases.json` fixtures.

## D-058 Library items are per member
- Decision: a `library_item` belongs to one user in a workspace (shelf, status, rating, progress, annotations are
  private, so personal routes need only VIEWER); each item gets its own `book` row, so editing book metadata never
  affects another member. Uploaded book files are ordinary sources in a hidden LIBRARY project; explain and excerpts
  create billed runs and Writer data, so they require EDITOR.

## D-059 Annotation sync with client ids and tombstones
- Decision: the client creates annotations with `crypto.randomUUID()` (idempotent POST), applies changes optimistically
  and pulls `?since=<serverTime>`; deletes are soft (`deletedAt`) so other tabs and devices drop them. Last write wins
  per annotation. Bookmarks are simple create/delete.

## D-060 Spoiler guard for passage explain
- Decision: `passage_explain` context = the current chapter up to the end of the selected passage (≤1500 tokens,
  whitespace-insensitive match; no match → no current-chapter text), ≤3 earlier passages retrieved with
  a page limit of chapter − 1 (inside the Qdrant filter, and on fused candidates by `page_end`), and extractive summaries of ≤6 earlier
  chapters. Every item is verbatim book text, so citations validate normally; `retrieval.completed.spoilerGuard`
  records the counts and the reader shows exactly what was sent.

## D-061 Unplaceable selections are rejected
- Decision: explain requires a locator that maps to a chapter; otherwise `400 LOCATOR_UNKNOWN` and no run is created
  (no fallback to the whole book, which could leak later chapters).

## D-062 Book metadata: EPUB first, providers optional
- Decision: EPUB metadata fills only blank book fields (after ingestion, and at shelve time when the source is already
  ingested); it never overwrites user edits. Open Library and Google Books are behind `FV_METADATA_OPEN_LIBRARY` /
  `FV_METADATA_GOOGLE_BOOKS` (default off), cached 30 days in `book_metadata_cache`, 5 s timeout, failures return no
  results. Manual entry always works.

## D-063 Run results carry citations without a message
- Decision: reader runs have no conversation, so the run result returned by the API includes validated citations
  (`anchor.page`, `anchor.locator.href`), and the reader turns them into jump links. The mock model is labelled DEMO
  in the panel when `model.provider === 'mock'`.

## D-064 Reader Lens actions
- Decision: editors get Define, Explain, Summarize passage, Highlight, Add note and Save as excerpt, plus a free
  question; viewers get Highlight and Add note. Excerpts store `{itemId, href, cfi, chapterTitle}` so Writer research
  notes link back to `/app/library/books/:itemId/read?cfi=`.

## D-065 Reader measure lives inside the EPUB iframe
- Context: constraining the host element clipped epub.js columns until a resize, and `reportLocation` called before
  layout is silently dropped.
- Decision: the line width (54/62/74ch) and font are applied to the book body via epub.js themes; the host stays full
  width. `EpubEngine` calls `rendition.reportLocation()` after every `display`/`next`/`prev` and after the first display.
  The preview Playwright project serves the built `dist`, so `pnpm build` must run before it.

## D-066 Recsys "semantic" factor uses LSA, not a neural embedder
- Context: the catalog is synthetic and the recommender must train offline in seconds with no downloads or paid calls.
- Decision: the semantic factor is a truncated-SVD (LSA) projection of the TF-IDF matrix, kept separate from the
  lexical TF-IDF factor. Swapping in a sentence embedder later only replaces this factor's vectors.

## D-067 Model artifacts are npz + JSON with checksums
- Decision: `rec_model_vN.json` manifest (data hashes, params, training counts, vocabulary) plus `.npz` arrays; every
  file's sha256 is verified on load and nothing is unpickled. Versions increment in `FV_REC_ARTIFACT_DIR`
  (default `.data/rec-artifacts`, gitignored); the served label is `recsys-hybrid vN`.

## D-068 Hybrid weights and the quality prior cap
- Decision: factors semantic / tfidf / theme / preference / prior (defaults 0.35 / 0.20 / 0.20 / 0.20 / 0.05). Weights
  are clipped to [0, 1], normalised to sum 1, then the prior is capped at 0.10 and the excess is dropped, not
  redistributed, so popularity cannot dominate. Themes use pseudo-relevance feedback from the top 10 items. The web
  fake mirrors the same rule.

## D-069 Diversity with MMR and caps
- Decision: MMR over the top 200 scored candidates with λ (default 0.7), at most 2 per creator and 2 per franchise by
  default, book/film balance on by default when no media type is chosen. Items similar to disliked ones lose up to
  0.15 (scaled by semantic similarity). Cold start (no signals) uses the prior pool.

## D-070 Profile sources
- Decision: profile = declared taste (genres, moods, themes, favourite titles), query text, Library items, clicks and
  feedback (`SAVE`, `LIKE`, `DISLIKE`, `DISMISS` and their undo actions), with part weights history 1.0, query 1.5,
  declared 0.6, context 0.8. Dismissed items are excluded from later sets.

## D-071 Impressions only for Discover
- Decision: Discover sets write impression interactions; Lab re-ranks are experiments and do not, so tuning in the Lab
  never changes the profile.

## D-072 Saving a recommendation shelves it
- Decision: SAVE on a book adds it to the member's Library as `TO_READ` with `externalIds.catalogId`; films go to the
  saved shelf (shown as the watchlist) only. Re-saving is idempotent.

## D-073 DEMO catalog load is opt-in by flag
- Decision: the seed loads `datasets/synthetic/catalog` only when `FV_DEMO_CATALOG=true`. `.env.example`, `pnpm up`
  and the compose `migrate` service default it to true for local use; a production deployment sets it explicitly.
  Every item and metric derived from it is labelled DEMO.

## D-074 `rec.evaluation_reports` table
- Context: the plan's `rec` table list does not include evaluation storage.
- Decision: offline evaluations are stored as rows (status, K, variants, metrics JSON, duration, model version) so the
  Lab and Studio can list history; the job runs on the worker `maintenance` queue as `rec-eval`.

## D-075 Shared catalog, private signals
- Decision: catalog items and themes are global (not workspace-scoped); taste, interactions, sets and feedback are
  scoped by `workspaceId` and `userId`. Non-members get 404.

## D-076 Recommender outages are 503
- Decision: any AI-service failure on a recommendation call (HTTP error or network error) becomes
  `503 RECOMMENDER_UNAVAILABLE` with no upstream detail. The authz matrix treats that code as "allowed but upstream
  down" so the test does not depend on the AI service.

## D-077 Studio Evaluations tab
- Decision: Studio gets a Runs / Evaluations switch via `?view=evaluations` (no new route), reusing the Lab's
  evaluation panel so there is one implementation.

## D-078 Second DEMO model `mock-concise`
- Context: Compare, Model Battle and the cost-vs-quality chart need two models that differ, and no live key exists.
- Decision: the registry seed adds `mock-concise` (deterministic, shorter answers, its own DEMO prices) next to
  `mock-grounded`. Both are `is_demo`; no real model id or price is invented.

## D-079 Detached lab runs
- Decision: Playground runs, forks, battle contestants and evaluation questions are `lab: true, detached: true`:
  no thread or messages are created, the answer and citations live on the run, and each run still gets its own
  receipt and ledger entries. `detached`, `fallbackModels` and `options.inject` are rejected with `LAB_ONLY` on
  normal runs.

## D-080 RAG evaluations run inline on the maintenance queue
- Decision: one `rag-eval` job on the existing maintenance queue executes the questions sequentially (no fan-out
  queue). The golden set is small, so this keeps ordering and cost accounting simple; `FV_EVAL_DIR` points at
  `datasets/evaluation` (baked into the API image).

## D-081 Frozen context is re-checked against the scope
- Decision: a battle passes recorded `chunkId`s and levels as `options.frozenContext`; the AI service reloads those
  chunks and drops any whose source version is not in the signed scope token, so a frozen list can never widen
  retrieval.

## D-082 Judge verdict as JSON in the answer
- Decision: the `answer_judge` graph returns `{"score": 1-5, "reason": ...}` as the run's answer and is stored as the
  item's relevance. It is a normal billed run (judge cost is added to cost per answer); unparseable verdicts score as
  missing, not zero.

## D-083 Blind battle API
- Decision: models are shuffled into A/B labels when the battle is created; responses hide run id, model, cost,
  tokens and duration until the single vote (a label or `TIE`, only after every answer has finished) is recorded.
  A second vote is `409 ALREADY_VOTED`.

## D-084 `model_battles` and `evaluation_runs` live in the `app` schema
- Decision: both tables are workspace-scoped app data (filtered by `workspaceId`), unlike the shared `rec` catalog;
  `evaluation_runs` reuses the `rec.EvalStatus` enum.

## D-085 Packer notes and page spans
- Context: retrieval recall scored only the child's start page, so a packed parent section covering the evidence
  page counted as a miss (live smoke: recall 0.4 vs accuracy 0.9).
- Decision: each packed passage records `pageFrom` / `pageTo` of the text actually packed (the parent when the parent
  is packed); recall counts a hit when the gold page falls in that span (smoke after the fix: recall 1).

## D-086 Studio sub-routes supersede D-077
- Decision: Compare, Playground, Model Battle and Evaluations get their own routes under `/app/studio/*`;
  `/app/studio?view=evaluations` redirects to `/app/studio/evaluations`.

## D-087 Tests settle usage explicitly
- Decision: integration tests and the smoke wait for (or call) ledger processing before reading costs, because FINAL
  cost entries are written by the ledger queue after the run completes.

## D-088 Budgets per workspace, project and member
- Decision: `budget_policies` have a scope (`WORKSPACE`, `PROJECT`, `USER`), a period (`DAILY`, `MONTHLY`), a hard or
  soft limit and up to five alert thresholds (default 75/90/100). A run reserves its estimate against every policy
  that applies (the workspace's, its project's, its user's); if any hard policy lacks room, reservations already taken
  are released and the run is `BUDGET_REJECTED` with `budget.scope` naming the one that stopped it, so the UI can say
  "your personal / this project's / the workspace AI budget".
- A run's project is `scope.projectId`, else its thread's project, else the project of its single source; it is
  stored in the run scope for reporting. Budgets cap AI API spend only.

## D-089 Local compute is priced per CPU-hour
- Decision: `model_prices.unit` is `MTOK` (per 1M tokens) or `CPU_HOUR`; `CPU_HOUR` is only valid for provider `local`
  and stores the rate in `input_per_mtok`. Embedding, sparse encoding and rerank wall time is metered by the AI
  service as `LOCAL_COMPUTE` usage (features `ingestion`, `retrieval`, `search`) and priced like any other usage; with
  no rate it records $0 as `FINAL_ESTIMATED`. Local compute never counts against budgets or a run's API total.

## D-090 Price entry rules
- Decision: prices are USD only (`CURRENCY_UNSUPPORTED`; the ledger does not convert), need an `https://` source URL
  (`demo://` only when the price is flagged DEMO), and are never edited: a new row with `effectiveFrom` supersedes the
  old one. A backdated price does not reprice entries already finalized; the API returns a note saying so. Public
  `/models` shows only the current price (`effectiveFrom <= now`), so a scheduled price is not shown early.

## D-091 Reconciliation per provider and UTC day
- Decision: a provider report (CSV upload, or the OpenAI Costs API when `OPENAI_ADMIN_KEY` is set) is stored once per
  provider and closed UTC day. Within `FV_RECON_TOLERANCE_USD` every FINAL entry of that day gets a zero
  `RECONCILIATION` entry with tier `RECONCILED`; otherwise the difference is split pro rata over the day's entries as
  `VARIANCE` entries. Both carry `supersedes_entry_id`, so the ledger stays append-only. Today is `SKIPPED`; a repeat
  import with the same amount is `UNCHANGED`, a different amount is `CONFLICT ALREADY_RECONCILED`. Reports for the
  `mock` provider are DEMO.

## D-092 Cloud costs in `infra_costs`
- Decision: cloud spend is not ledger data (it is not per run), so it lives in `infra_costs` (day, service, amount,
  source `MANUAL | GCP_BILLING`). The GCP import queries the Billing export table (`FV_GCP_BILLING_TABLE`) through the
  BigQuery REST API with the runtime service account's metadata-server token; without the variable the import answers
  `503 GCP_BILLING_UNCONFIGURED` and costs are entered by hand.

## D-093 Rollups and anomalies
- Decision: `cost_rollups` (hourly and daily, per workspace × dimension `total|model|feature|user|class`) are rebuilt
  with idempotent `INSERT … ON CONFLICT` by the `cost-rollup` worker job every 10 minutes (or on demand by a super
  admin). Anomalies use a z-score of the day against its previous 14 days (missing days count as 0, at least 7 days
  with spend, standard deviation floored at 10% of the mean), flagged at `FV_ANOMALY_Z` (3) and `FV_ANOMALY_MIN_USD`;
  each new anomaly notifies the workspace's owners and admins.

## D-094 Super-admin pages answer "not found"
- Decision: `/app/admin/*` render the same Not found page as the API's 404 for anyone without `platformRole =
  SUPER_ADMIN`; the rail item and palette entries appear only for super admins. The Cost Command Center reads
  rollups, never run inputs or document text.

## D-095 One trace from browser to graph node
- Decision: W3C `traceparent` crosses process boundaries in two places only: BullMQ job data (`TracedQueue.add`
  stamps it; the worker's `inJobSpan` starts a CONSUMER span from it) and the HTTP header on the NDJSON calls to the
  AI service. LangGraph nodes are spans named `node <name>`. Span attributes are limited to ids
  (`fv.workspace_id`, `fv.run_id`, `fv.graph`, `fv.node`, `fv.job_id`, `fv.step`, `fv.source_version_id`); no prompt,
  completion, query string or document text is recorded, and the collector also drops credential headers and
  `gen_ai.*`/`llm.*` content attributes in case a library adds them. The 15-second `reap` and 30-second `sweep`
  maintenance jobs are not traced (noise). Without `OTEL_EXPORTER_OTLP_ENDPOINT` nothing is created or exported.
- Evidence: local end-to-end run with the collector in debug mode: 12/12 run traces span API → worker → AI service →
  node spans; ingestion traces reach ai-ingest; 0 spans with query strings or credential headers.

## D-096 Metrics are named once and checked
- Decision: the API emits ten `fv.*` instruments (runs, run duration, ingestion jobs and duration, ledger entries and
  charged USD, budget rejections, SSE connections and events, queue depth). Dashboards and alert rules are generated by
  `infrastructure/grafana/generate.mjs`; `--check` (CI and `pnpm test:infra`) fails when a committed file is stale,
  when a query names an `fv_*` series the API does not emit, or when an alert links a runbook heading that does not
  exist. Our datasources have fixed uids (`fv-prometheus`, `fv-tempo`) so the generated JSON does not depend on the
  LGTM image's defaults.
- Not verified: the dashboards were not rendered in Grafana locally (not enough free disk for the LGTM image).

## D-097 Browser tracing is opt-in and same-origin
- Decision: `VITE_OTEL_ENABLED=true` at build time loads the OTel web SDK through a dynamic import (separate 97 kB
  chunk); otherwise the code is removed from the bundle. Spans go to `/otlp/v1/traces` on the app's own origin
  (Caddy in Docker, the Vite proxy in dev), so the CSP keeps `connect-src 'self'` and no collector is exposed
  publicly. URLs are recorded as route templates (`/api/workspaces/:id/...`) without query strings.

## D-098 Image and container hardening
- Decision: all images run as fixed non-root users (api 1000, ai 10001, web 65532) with root-owned application
  files, and compose runs them with `read_only`, a 512 MB `/tmp` tmpfs, `cap_drop: ALL` and `no-new-privileges`.
  Package managers are removed from the runtime images; `prisma` became a runtime dependency so `migrate deploy`
  never downloads an unpinned CLI. Caddy's file capability (for binding low ports) is removed, since it listens on 8080, because
  the kernel refuses to exec a binary with file capabilities under `no-new-privileges` and an empty bounding set.
  The worker gets a small `/live` and `/ready` server (`FV_WORKER_HEALTH_PORT`) so Docker and Cloud Run can probe it.
- CI builds each image, rejects images whose user is root, writes an SPDX SBOM (syft), reports HIGH/CRITICAL findings
  and fails on fixable CRITICAL ones (Trivy). Trivy `config` scans Terraform and Dockerfiles; two findings are
  ignored in place with reasons (AVD-GCP-0068: the WIF repository condition exists but is a variable; AVD-GCP-0015:
  TLS is enforced with `ssl_mode`, the successor of `require_ssl`).

## D-099 Terraform shape
- Decision: secrets are containers only (values would land in state); operators add versions with `gcloud`. Cloud
  Run URLs are deterministic (`https://fv-<svc>-<project number>.<region>.run.app`), which breaks the
  api ↔ web ↔ AI URL cycle without a second apply. The AI services use internal ingress and allow
  unauthenticated invocation at the IAM layer because every call already carries the API's signed ES256 token; the
  network limit plus the app token avoid minting Google ID tokens in the API. GitHub uses Workload Identity
  Federation with two identities: a publisher (Artifact Registry writer, any workflow in the repository) and a
  deployer (Cloud Run developer, only jobs in the `production` environment). Terraform ignores image changes so a
  later apply never reverts a release.
- Deviation: the lean data VM runs Container-Optimized OS with `docker run` units from the startup script instead of
  Docker Compose (COS has no compose and is the patched, minimal choice for a VM that only runs containers).
- Not done: nothing was applied; no GCP project exists (BLOCKED).

## D-100 Release order and rollback
- Decision: `release.yml` migrates first (expand-only migrations, so the running revision keeps working), then
  deploys consumers before producers (ai-api, ai-ingest, api-worker, api-http, web) by image digest, runs the
  read-only deployed smoke, and on failure shifts traffic back to the revisions it recorded before starting. Schema
  changes are never rolled back automatically. Without the GCP repository variables the workflow emits a warning and
  stops, so tags do not fail in repositories that have not been set up.

## D-101 Deployed smoke is read-only
- Decision: `smoke-deployed.mjs` only sends GET requests: web `/healthz`, the SPA shell and its security headers,
  `/api/live`, `/api/ready` (AI service reachable) and two 401 checks (session and workspace SSE without a cookie).
  It creates no users or data, so it is safe against production; the full write path stays in `smoke.mjs` for local
  stacks.

## D-102 Backups and the restore drill
- Decision: backups are a Postgres custom-format dump plus a Qdrant collection snapshot. Locally `pnpm backup` writes
  them with a SHA-256 manifest; on the lean VM a systemd timer uploads them nightly to the versioned backup bucket;
  the standard profile relies on Cloud SQL backups and PITR for Postgres. Restores are side by side by default:
  `restore.mjs` refuses to overwrite an existing database or collection without `--replace`. `pnpm backup:drill`
  restores into scratch copies and compares every table's row count and the vector point count.

## D-016 Web route paths follow the prototype
- Context: Section O of the plan abbreviates routes (`/app/knowledge/:projectId/doc/:sourceId`, `/app/library/read/:itemId`, `/app/discover/lab`), while `design-prototype/index.html` (Prompt 3) uses `/app/knowledge/projects/:projectId/documents/:sourceId`, `/app/library/books/:itemId/read`, `/app/discover/recommendation-lab`.
- Decision: `src/app/routes.js` follows the prototype paths (the plan says routes mirror Prompt 3 Part D) and adds the plan-only routes: `/auth/*`, `/reset-password`, `/verify-email` (links sent by the API mailer), `/app/writer/manuscripts/:id/continuity`, `/app/admin/pricing`, `/app/admin/models`. Gate 2 adds `/accept-invite` (invitation emails) and `/app/knowledge/trash`.
