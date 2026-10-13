---
title: Design system & states
description: Design tokens, typography, shared components and the status vocabulary used across the app.
section: Reference
order: 2
gates: [1]
---

The live component gallery is in the app at **Documentation → Component gallery** (`/app/docs/design`). It renders
every shared component and every status badge from the same code the product uses.

## Tokens

`packages/design-tokens/tokens.json` is the single source for:

| Group | Contents |
| --- | --- |
| `color` | Light, dark and Studio (forced dark) palettes: background, surface, text, muted, border, accent, AI, ok, warn, bad, info, paper, chart series |
| `font` | Sans for interface text, serif for manuscripts, reading and evidence, mono for ids, numbers and code |
| `fs`, `s`, `r` | Type scale, spacing scale and radii |
| `layout` | Rail, top bar, context pane, inspector, drawer and reading/editor measures |
| `motion`, `shadow` | Durations, easing and elevation per theme |

`pnpm tokens:build` generates CSS variables (`--fv-*`), the Tailwind v4 `@theme` and a JS module. Feature code in
`apps/web/src/features` must use tokens: hex colours there fail review. Reduced motion follows the operating system.

## Components

Shared components live in `apps/web/src/shared/ui` (buttons, fields, badges, tabs, dialogs, sheets, tables,
skeletons, progress, toasts) on top of Radix primitives, and the cross-product patterns in
`apps/web/src/shared/overlays`:

- **Folio Lens**: actions on a text selection, per context: explain, define, ask, find related evidence, note or
  excerpt in Knowledge; rewrite, tighten, expand, change tone or look up canon in Writer; define, explain,
  summarize, highlight or create a study note in the Reader.
- **Evidence drawer**: the passage behind a citation, at its exact location in the source version.
- **Run receipt**: model calls, tokens, price and cost tier for any AI action.
- **Model selector**: the models a workspace may use, with DEMO labels.

## States

Status badges come from one vocabulary (`apps/web/src/shared/states.js`), so the same state always looks and reads
the same. Each state has a tone, a glyph and a label, so colour is never the only signal.

| Family | States |
| --- | --- |
| `ingest` | Document ingestion: uploading, uploaded, scanning, preview ready, parsing, indexing, ready, partial, failed, quarantined |
| `run` | AI run status: queued, running, streaming, awaiting input, succeeded, partial, failed, cancelled, interrupted, budget limit |
| `outcome` | Answered, not enough evidence (abstained), partially answered |
| `cite` | Citation validation: verified quote (VALID), weak support, unresolved, access revoked, source deleted |
| `anchor` | Whether a note or excerpt still resolves: exact, shifted, fuzzy match, location lost |
| `sugg` | Writer suggestions: pending review, accepted, rejected, stale, superseded |
| `cost` | Cost tiers: preflight estimate, live estimate, finalized, final (estimated), reconciled, variance |
| `dna` | Narrative DNA facts: canon, proposed, retired |
| `origin` | Who added a DNA fact: the author or an AI extraction |

The values match the enums in `packages/contracts/schemas/states.schema.json`, and a test fails if they drift.

## Accessibility

Every page has a skip link, landmarks and a single `h1`; focus moves to the main region on navigation; all actions
are keyboard reachable (`?` lists the shortcuts, `Ctrl K` opens the command palette).
