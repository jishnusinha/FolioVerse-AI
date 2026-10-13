---
title: Troubleshooting
description: Common problems in local development and operation, and how to resolve them.
section: Reference
order: 1
gates: [3]
---

## A document is stuck in INDEXING or FAILED

1. Open the project in Folio Knowledge: the upload tray shows each document's ingestion state and error.
2. Is the worker running? Ingestion jobs are consumed by `api-worker`; in `pnpm dev` look for the `worker` log
   prefix. Retryable failures are retried with backoff (three attempts) before the document is marked FAILED.
3. Is the ingestion service reachable? The worker calls `ai-ingest` (port 8001 natively). With
   `FV_EMBEDDER=fastembed` the first ingestion downloads the embedding models; without network access set
   `FV_EMBEDDER=hash`.
4. Select **Retry** on the document (or select several and choose **Reprocess**). Chunk ids are deterministic, so
   reprocessing a version is idempotent.

A version marked PARTIAL indexed every page that parsed and can be asked about; pages that failed to parse are not
searchable.

## Registration emails never arrive

Locally all mail goes to Mailpit at http://localhost:8025. In other environments check the SMTP variables with
`pnpm check:env` (it prints names, never values).

## Answers say the documents do not cover the question

That is abstention: retrieval found no passage with enough dense similarity or lexical overlap, so no model was
called and the run cost nothing. Check that the document is READY and in scope for the chat. With the hash embedder
retrieval is purely lexical, so paraphrased questions abstain more often.

## A run fails or ends as BUDGET_REJECTED

- `BUDGET_REJECTED`: a hard budget (workspace, user or project) would be exceeded by the run's estimate. Raise the
  limit in the Cost Center or make the budget soft.
- `RETRIEVAL_UNAVAILABLE`: Qdrant or the AI service was unreachable; the run is retryable.
- `PROVIDER_RATE_LIMIT`, `PROVIDER_TIMEOUT`: the model provider throttled or timed out; check the model registry
  and the provider's status.
- `INTERRUPTED`: the worker stopped heartbeating mid-run (for example it was restarted); start a new run.

Every failed run is in AI Studio with its events up to the failure.

## Costs show 0 with PRICE_MISSING

No price was in effect for that model when the call happened. A super admin enters prices with a source URL in
Administration → Model prices; amounts are recorded as `FINAL_ESTIMATED` until then. Prices are never guessed.

## Discover says the catalog is empty

The synthetic catalog is loaded by `db:seed` when `FV_DEMO_CATALOG=true`. Re-run `pnpm db:seed`.

## Streaming stops behind a proxy

Server-Sent Events must not be buffered. The bundled Caddy configuration flushes `/api` immediately; any other
proxy in front of FolioVerse needs response buffering turned off for `/api/workspaces/*/runs/*/events` and
`/api/workspaces/*/events`. Clients reconnect with `Last-Event-ID` and resume without losing events.

## The documentation link shows an error in development

`/docs` is served by the web container in Docker. With `pnpm dev`, start the docs dev server as well
(`pnpm --filter @folioverse/docs dev`); Vite proxies `/docs` to it.

## Something else

Search the [runbooks](../../infrastructure/runbooks/README.md) for operational procedures, and the
[decision log](../planning/DECISION_LOG.md) for why things work the way they do.
