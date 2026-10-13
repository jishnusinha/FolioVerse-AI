---
title: Cost ledger
description: How every AI action is estimated, reserved, priced, settled and reconciled, and where to see it.
section: DevOps
order: 4
gates: [3, 9]
blocked: [OpenAI admin key for the Costs API, GCP project / WIF / Artifact Registry]
demo: The seeded mock models carry DEMO prices; real prices are entered by a super admin with a source URL.
---

Every AI action writes to an append-only cost ledger (`app.cost_entries`). The ledger keeps three kinds of truth
apart and never presents one as another: what was **estimated**, what was **calculated** from reported usage, and
what the **provider reported** it billed.

## Pricing

Prices live in `model_prices` with an effective period, a unit, a currency (USD) and the **source URL** they were
copied from. A super admin enters them in Administration → Model prices; nothing in the repository contains a real
model price. A usage event is priced with the price that was in effect when the call happened:

```text
cost = [ (input − cached) × P_in + cached × P_cached + (output − reasoning) × P_out + reasoning × P_reasoning ]
       / 1,000,000 × (1 − batch discount)
```

Cached and reasoning prices default to the input and output prices when not set. Amounts are rounded half-up to 8
decimal places. The TypeScript (`apps/api/src/modules/ledger/pricing.ts`) and Python
(`apps/ai-service/folioverse_ai/pricing.py`) implementations must both pass
`packages/contracts/fixtures/pricing-cases.json`.

## Tiers

| Tier | Written when |
| --- | --- |
| `PREFLIGHT_ESTIMATE` | Before the run: estimate from the model plan and current price, reserved against budgets |
| `LIVE_ESTIMATE` | Shown in the UI while tokens stream; not written to the ledger |
| `FINALIZED` | The provider reported usage and a price was in effect |
| `FINAL_ESTIMATED` | Usage had to be estimated, or no price was in effect (`PRICE_MISSING`, amount 0) |
| `RECONCILED` | A day's ledger total matched the provider's report within tolerance |
| `VARIANCE` | The provider's figure differed; the difference is allocated pro rata to that day's entries |

Cost classes separate `AI_API` spend from metered `LOCAL_COMPUTE` (CPU-seconds of local embedding, reranking and
local models, priced per CPU-hour when an admin sets a rate). Platform `CLOUD_INFRA` spend is not attributable to a
workspace, so it is kept in a separate table (`infra_costs`) rather than in the ledger.

## Budgets

Budgets apply to a workspace, a user or a project, daily or monthly, with alert thresholds (75%, 90% and 100% by
default) and either a hard limit (the default) or a soft one that only alerts. A run reserves its estimate against every applicable budget before it starts; if a hard
budget would be exceeded, the run ends as `BUDGET_REJECTED` without any model call. Reservations are consumed by
the final amount and released when the run ends.

## Reconciliation

A super admin can upload a provider's cost export as CSV for any day; FolioVerse compares it with the ledger and
writes `RECONCILED` or `VARIANCE` entries (tolerance `FV_RECON_TOLERANCE_USD`, default 0.01). Fetching directly from the OpenAI Costs API
needs an organisation admin key, and importing GCP spend needs a Billing export to BigQuery; both are blocked until
configured, and the CSV upload and manual cloud cost entry work without them.

## Where to see it

- **Receipt** on every answer: model calls, tokens (input, cached, output), the price used and the cost tier.
- **Cost Center** (`/app/costs`): spend by day, feature, model, project and user (people visible to admins only),
  budgets and a CSV export.
- **Cost Command Center** (`/app/admin/costs`, super admins): platform totals across AI API, cloud and local
  compute, top workspaces and users, high-cost workflows, anomalies against a 14-day baseline, reconciliation and
  recent model calls.
