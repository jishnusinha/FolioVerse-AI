# Maintenance jobs and queues

The worker (`apps/api/src/worker.ts`) consumes four BullMQ queues in Redis:

| Queue | Jobs | Schedule |
| --- | --- | --- |
| `ingestion` | parse → chunk → embed → index a source version | on upload |
| `ai-runs` | execute a run against the AI service, stream events | on request |
| `ledger` | `sweep`: settle reservations of finished or abandoned runs | every 30 s |
| `maintenance` | `reap`: mark runs whose worker vanished as INTERRUPTED | every 15 s |
| `maintenance` | `purge`: delete trash older than 30 days | daily 03:17 UTC |

Redis runs with `noeviction`; evicting BullMQ keys would lose jobs.

## Trash purge

Deleting a project or source moves it to the trash (Knowledge → Trash shows each item's purge
date). After 30 days `purge` removes, per source: vectors (via the AI service), stored objects,
chunks, pages, index manifests, ingestion jobs and the source row. Citations that pointed at it
keep their place in conversations but become `SOURCE_PURGED` with the quote removed.

- If the AI service is unreachable the source is skipped (log: `vector purge deferred`) and
  retried the next day, so no database row is removed while its vectors still exist.
- Restoring from the trash before the purge date is a normal user action. After the purge the
  only way back is a backup ([restore-backup.md](restore-backup.md)).
- Not scheduled locally? The schedule is registered when the worker starts; restart it.

## Queue backlog

Alert *Queue backlog above 100* (`fv_queue_depth` waiting jobs for 10 minutes).

1. Which queue? Grafana *Runs* / *Ingestion* dashboards show depth per queue; the worker's
   `/ready` returns the same numbers.
2. Is the worker alive? `fv-api-worker` must have at least one instance with CPU always on.
   `gcloud run services describe fv-api-worker --region R` and its logs. The Cloud Monitoring
   alert *fv-api-worker has no running instance* fires separately when it is down.
3. Is it stuck downstream? Traces for `ai-runs` / `ingestion` jobs show where time goes
   (AI service cold starts, embedding, Qdrant). Raise `max_instances` for `fv-ai-ingest` or the
   worker in tfvars for sustained load, and apply.
4. A burst from one workspace (e.g. a bulk upload) drains on its own; worker concurrency per
   queue is fixed in `worker.module.ts`. Budgets are checked when a run is created, so a
   backlog does not create spend beyond the workspace budgets.
5. Ingestion jobs retry 3 times with exponential backoff; runs are not retried (a fork creates a
   new run). BullMQ keeps the last 5000 failed jobs for inspection. Users can re-ingest a source
   from its page once the cause is fixed.

Do not flush Redis to clear a backlog: it would drop queued work and in-progress run state.
