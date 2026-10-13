---
title: Observability
description: Traces, metrics and logs that connect a browser action to every service, model call and ledger entry.
section: DevOps
order: 3
gates: [10]
---

Telemetry is OpenTelemetry end to end and **off by default**: nothing is exported until
`OTEL_EXPORTER_OTLP_ENDPOINT` is set.

## Running it locally

```bash
pnpm up -- --infra --observability   # adds the OTel collector and Grafana LGTM
# .env: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
pnpm dev
```

Grafana is at http://localhost:3001 with four provisioned dashboards (runs, ingestion, ledger, SSE) and five alert
rules. Both containers bind to 127.0.0.1 only.

## One trace per action

A question asked in the browser produces one trace:

```text
browser fetch → folioverse-api (HTTP) → BullMQ job → folioverse-api-worker → folioverse-ai-api (FastAPI)
              → one span per LangGraph node → model call
```

- The API and worker use HTTP, Express and BullMQ instrumentation; the trace context travels inside the job
  payload, so the worker's consumer span joins the request's trace.
- The AI service continues the incoming `traceparent` into run spans and one span per graph node.
- Browser tracing is opt-in at build time (`VITE_OTEL_ENABLED=true`); spans go to the same-origin `/otlp` proxy.
  Without it, no telemetry code ships in the bundle.

Spans carry `fv.run_id`, `fv.workspace_id`, `fv.graph`, `fv.node` and `fv.job_id`, so a trace links directly to the
run in AI Studio and its ledger entries.

## Metrics

| Metric | Meaning |
| --- | --- |
| `fv.runs`, `fv.run.duration` | Runs by graph and final status, and their duration |
| `fv.ingestion.jobs`, `fv.ingestion.duration` | Ingestion jobs by outcome and duration |
| `fv.ledger.entries`, `fv.ledger.charged_usd` | Cost entries written and the amount charged |
| `fv.budget.rejections` | Runs rejected by a budget before any model call |
| `fv.sse.connections`, `fv.sse.events` | Open SSE streams and events sent |

## Privacy

The collector's processors delete authorization and cookie headers, prompt, completion and SQL statement
attributes, and strip query strings (which can carry search text) before export, whatever an instrumentation
library adds. FolioVerse's own spans never carry document text, prompts or answers. Logs are structured JSON and do not include source content
or secrets by default.

## Alerts and runbooks

Each alert rule links to a runbook section (for example a queue backlog to the
[purge-job runbook](../../infrastructure/runbooks/purge-job.md)). `node infrastructure/grafana/generate.mjs --check`
fails when a linked heading disappears, so alerts cannot point at missing instructions.
