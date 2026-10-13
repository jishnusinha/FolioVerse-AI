# Runbooks

Operational procedures for FolioVerse. Grafana alert rules link here by relative path
(`infrastructure/grafana/generate.mjs --check` fails if a linked heading disappears).

| Runbook | Use it when |
| --- | --- |
| [deploy.md](deploy.md) | First-time GCP bootstrap, every release, health checks, rollback |
| [rotate-secrets.md](rotate-secrets.md) | Rotating any secret, model prices missing, suspected key abuse |
| [restore-backup.md](restore-backup.md) | Restoring Postgres/Qdrant from a backup, running the restore drill |
| [purge-job.md](purge-job.md) | Trash purge, maintenance jobs, queue backlog |

The GCP procedures have been validated with `terraform validate`/`tflint` and the deployed
smoke has been exercised against local stand-ins, but **no real GCP project has been deployed
yet** (see `docs/planning/IMPLEMENTATION_STATUS.md`). Treat the first run as a rehearsal and
fix this document where reality differs.

Conventions used below: `R` is the region (e.g. `us-central1`), `P` the project id. Commands
never echo secret values; read them with `read -rs` or pipe them from a password manager.
