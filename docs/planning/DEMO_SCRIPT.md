# FolioVerse Demo Walkthrough Script

> **Notice:** All entities, documents, manuscripts, catalog titles, and model responses in this demo are **DEMO** data created specifically for evaluation and testing. No real model API credits or paid provider endpoints are consumed during this walkthrough (runs execute against the deterministic mock provider).

This script provides an interviewer-ready, step-by-step walkthrough of FolioVerse across all core subsystems:
1. Authentication & Workspace Selection
2. Knowledge Workspace & Grounded Q&A with Verifiable Citations (Project Atlas)
3. Writer, Narrative DNA & Continuity Check (The Glass Meridian)
4. Library & In-App E-Reader (Orbit of Small Lanterns)
5. Discover & Taste Engine (500+ DEMO Titles)
6. AI Studio: Execution Traces, Time Machine Replay & Model Battle
7. Cost Command Center & Admin Pricing

---

## 0. Prerequisites & Setup

Ensure the FolioVerse local development stack is running:

```bash
# 1. Start core data services in Docker
pnpm up -- --infra

# 2. Start native services (API, Worker, AI API, AI Ingestion, Vite Web)
pnpm dev
```

Seed the idempotent interview demo environment:

```bash
# Seeds the demo user, documents, manuscripts, EPUB, and catalog
pnpm demo
```

- **Demo Account Email:** `demo@folioverse.example`
- **Demo Account Password:** `folioverse-demo`
- **Web App URL:** `http://localhost:5173`
- **API URL:** `http://localhost:3000`

---

## Step 1: Authentication & Workspace Context

1. Open your browser and navigate to `http://localhost:5173/auth/login`.
2. Sign in with:
   - **Email:** `demo@folioverse.example`
   - **Password:** `folioverse-demo`
3. Notice:
   - CSRF token is verified and an HttpOnly session cookie is established.
   - You land in the personal workspace **"Aster Research & Stories (DEMO)"**.
   - The workspace navigation rail shows Knowledge, Writer, Library, Discover, AI Studio, and Cost Command Center.

---

## Step 2: Knowledge Workspace & Grounded Q&A (Project Atlas)

1. Click on **Knowledge** in the navigation rail, or navigate to `/app/knowledge`.
2. Select **Project Atlas** (`Market research on assisted-research tools (DEMO)`).
3. **Inspect Sources:**
   - Notice three pre-ingested documents:
     - `Market Outlook 2026.md` (Markdown)
     - `Atlas brief.pdf` (Multi-page PDF)
     - `Competitor notes.md` (Markdown)
   - Click on `Market Outlook 2026.md` to view the parsed text chunks, locator metadata, and bounding boxes.
4. **Grounded Q&A with Verifiable Citations:**
   - In the Q&A / Chat pane, review the completed run for:
     > *"Compare the growth projections and the main risks to them."*
   - Notice the answer rendered with inline citation chips (e.g., `[1]`, `[2]`).
   - Click on a citation badge:
     - The document viewer opens directly to the referenced page and source text.
     - The exact matching text span is highlighted with visual bounding anchors.
     - The citation popover displays the quotation validation status (`VALIDATED`).
5. **Quick-Summary Artifact:**
   - Switch to the **Artifacts** tab to view the generated summary artifact produced by the `insight` graph run.

---

## Step 3: Writer, Narrative DNA & Continuity Check (The Glass Meridian)

1. Click on **Writer** in the navigation rail, or navigate to `/app/writer`.
2. Open the manuscript **"The Glass Meridian"**.
3. **Explore Structure & Prose:**
   - Tree view on the left:
     - *Chapter 1 — The Survey Line*: Scene 1 (*The Survey Line*), Scene 2 (*The Archive Door*).
     - *Chapter 2 — Unconfirmed*: Scene 3 (*Night Readings*).
   - Daily word count goal is set to 1,500 words.
4. **Narrative DNA:**
   - Click the **Narrative DNA** tab.
   - Inspect the **Canon Facts**:
     - `Ilse` &rarr; `eye color` &rarr; `grey` (Canon)
     - `Ilse` &rarr; `age` &rarr; `41` (Canon)
     - `The meridian` &rarr; `material` &rarr; `brass` (Canon)
   - Notice **Proposed Facts** extracted automatically from the prose via the `dna_extraction` graph, ready for one-click approval or rejection.
5. **Continuity Contradiction Detection:**
   - Open `/app/writer/manuscripts/:id/continuity` or the Continuity panel.
   - Notice the detected continuity violation:
     - **Scene:** Chapter 2, Scene 3 (*Night Readings*).
     - **Contradictory Prose:** *"her green eyes aching from the copperplate..."*
     - **Violation:** Contradicts canon fact *"Ilse eye color = grey"*.
     - The issue flags the exact character offset, confidence score, and suggested resolution.

---

## Step 4: Library & E-Reader (Orbit of Small Lanterns)

1. Click on **Library** in the navigation rail, or navigate to `/app/library`.
2. On your shelf, locate the synthetic EPUB book **"Orbit of Small Lanterns"**.
3. Notice reading progress is preserved at **46%**.
4. Click **Read** to launch the reader (`/app/library/books/:id/read`):
   - The EPUB reader loads the current reading location.
   - Inspect the existing highlight on the passage:
     > *"Teodor Lusk had kept the archive for thirty years."*
   - Select any text passage to bring up the context menu:
     - Add note / bookmark / highlight.
     - Trigger **Passage Explain** (`passage_explain` graph) to view an AI-generated explanation grounded in the surrounding chapter context.

---

## Step 5: Discover & Taste Engine

1. Click on **Discover** in the navigation rail, or navigate to `/app/discover`.
2. **Taste Profile:**
   - Notice the curated taste profile:
     - Genres: `Sci-fi`, `Literary`
     - Mood: `Atmospheric`
     - Theme: `memory`
   - Active seed titles from the DEMO catalog.
3. **Recommendations Feed:**
   - Inspect the recommended books ranked by hybrid score fusion (content similarity + taste vector).
   - Each recommendation displays match rationale, dominant themes, and confidence metrics.
4. **Recommendation Lab (`/app/discover/recommendation-lab`):**
   - Adjust the blend weighting slider between collaborative filtering and semantic content similarity.
   - Observe real-time re-ranking of the 500+ DEMO catalog titles.

---

## Step 6: AI Studio (Traces, Time Machine & Model Battle)

1. Click on **Studio** in the navigation rail, or navigate to `/app/studio`.
2. **Run History:**
   - Inspect all recent runs (`grounded_qa`, `insight`, `dna_extraction`, `continuity_check`).
   - Click into the grounded Q&A run to view the execution timeline.
3. **Time Machine & Event Replay:**
   - Select the **Time Machine** tab.
   - Step forward and backward through recorded events:
     - `run.started` &rarr; `retrieval.scored` &rarr; `token.delta` &rarr; `citation.validated` &rarr; `run.finished`.
     - Replay visualizes intermediate states purely from recorded event logs—zero duplicate inference tokens are consumed.
4. **Model Comparison & Battle (`/app/studio/battle`):**
   - Configure side-by-side prompt execution across different model tiers (e.g., `mock-balanced` vs `mock-fast`).
   - Run a prompt battle to compare latency, token count, cost estimate, and output quality side-by-side.

---

## Step 7: Cost Command Center & Admin Pricing

1. Click on **Costs** in the navigation rail, or navigate to `/app/costs`.
2. **Ledger Invariants & Spend Tracking:**
   - Review the ledger breakdown of all completed runs.
   - Each entry shows:
     - Run ID, graph name, model tier
     - Input and output token counts
     - Calculated cost with `FINALIZED` receipt
     - Complete parent-child lineage (`supersedes_entry_id`) for estimation vs finalization.
3. **Budget Guardrails:**
   - View monthly workspace spending caps and alerting thresholds.
   - When a budget limit is reached, subsequent runs are rejected preflight with `BUDGET_REJECTED` before any model call is dispatched.
4. **Admin Model & Pricing Registry (`/app/admin/pricing`, `/app/admin/models`):**
   - Inspect registered models and pricing configurations.
   - Note: Real model IDs and prices require explicit admin entry with an authentic source URL; all simulated or offline compute entries are clearly marked `DEMO` / `local-compute`.

---

## Summary Checklist

| Subsystem | Demonstrated Capability | Verification Point |
| :--- | :--- | :--- |
| **Auth & Security** | Session cookie, CSRF, workspace tenancy | Multi-tenant isolation verified |
| **Knowledge** | Multi-format ingestion (MD, PDF), Grounded Q&A | Citations navigate to visual bounding box |
| **Writer** | Tree manuscript, Narrative DNA, Continuity | Detects Ilse's green eye contradiction |
| **Library** | EPUB streaming, reading progress, annotations | Progress at 46%, highlighted passage |
| **Discover** | 500+ DEMO catalog, hybrid taste engine | Interactive blend re-ranking |
| **Studio** | Traces, Time Machine replay, Model Battle | Zero-cost deterministic replay |
| **Costs** | Append-only ledger, receipts, budget guard | Exact token metering and tier attribution |
