# Backups and restore

| Data | Lean (GCP) | Standard (GCP) | Local / compose |
| --- | --- | --- | --- |
| Postgres | `pg_dump -Fc` nightly 02:30 UTC to `gs://P-fv-backups/postgres/YYYY/MM/DD/`, plus daily disk snapshots | Cloud SQL automated backups + point-in-time recovery | `pnpm backup` |
| Qdrant | Collection snapshot nightly to `gs://P-fv-backups/qdrant/...` | Same (VM) | `pnpm backup` |
| Uploads | GCS bucket (object versioning not enabled; deleted sources are purged on purpose) | Same | MinIO volume |

Backup objects are deleted after `backup_retention_days` (bucket lifecycle in
`modules/platform/main.tf`); the bucket is versioned, so an overwritten or deleted object stays
recoverable for 7 more days. Qdrant can always be rebuilt from Postgres + uploads by
re-ingesting, so its backup shortens recovery rather than being the only copy.

## Taking a backup before a risky change

- Local: `pnpm backup` (writes `backups/<timestamp>/` with a SHA-256 manifest; git-ignored).
- Lean: `gcloud compute ssh fv-data --zone Z --tunnel-through-iap -- sudo systemctl start fv-backup`
  then confirm the new objects with `gcloud storage ls -l gs://P-fv-backups/postgres/$(date -u +%Y/%m/%d)/`.
- Standard: `gcloud sql backups create --instance fv-postgres`.

## Restore drill (monthly, and after changing backup code)

```bash
pnpm backup:drill
```

Backs up the local stack, restores side by side into `folioverse_restore_check` and
`fv_restore_check`, compares the row count of every table and the vector point count, and
drops the scratch copies. It exits non-zero on any mismatch. Run it with no writes in flight.
Record the result (date, rows, duration) in the status file when it is part of a release.

## Restoring

Always restore **side by side** first, verify, then switch. `restore.mjs` refuses to overwrite
an existing database or collection without `--replace`.

### Local / compose

```bash
pnpm restore -- --from backups/<timestamp> --database folioverse_restored --collection fv_chunks_restored
# inspect, then switch: stop the app, restore over the live names
pnpm restore -- --from backups/<timestamp> --database folioverse --collection fv_chunks_v1 --replace
```

### Lean (data VM)

1. Stop writers: `gcloud run services update fv-api-http --region R --ingress internal` blocks
   user traffic (the web app shows the API as unavailable). Wait until the worker's queues are
   empty (worker `/ready`, or the *Runs* dashboard), so no job writes during the restore.
2. Download the objects to the VM (it has the storage role):
   `gcloud compute ssh fv-data --zone Z --tunnel-through-iap`, then on the VM use
   `toolbox` or `docker run --rm -v /mnt/disks/data/backups:/b google/cloud-sdk:slim gcloud storage cp gs://P-fv-backups/postgres/<day>/<file> /b/`.
3. Side by side:

   ```bash
   docker exec fv-postgres createdb -U folioverse folioverse_restored
   docker exec -i fv-postgres pg_restore -U folioverse -d folioverse_restored --no-owner --exit-on-error < /mnt/disks/data/backups/<file>.dump
   curl -X POST 'http://127.0.0.1:6333/collections/fv_chunks_restored/snapshots/upload?priority=snapshot' -F snapshot=@/mnt/disks/data/backups/<file>.snapshot
   ```

4. Verify counts against expectations, then swap names:
   `ALTER DATABASE folioverse RENAME TO folioverse_old; ALTER DATABASE folioverse_restored RENAME TO folioverse;`
   For Qdrant, restore the snapshot again under `fv_chunks_v1` (delete the damaged collection first).
5. Restore ingress (`--ingress all`, or `internal-and-cloud-load-balancing` behind the load
   balancer), run the deployed smoke, keep `folioverse_old` for a week.

To rehearse with a cloud backup off the VM, download the `.dump` and `.snapshot` into one
directory and run `pnpm restore -- --from <dir> --database folioverse_rehearsal` against the
local compose stack; without a manifest, digests are not checked.

### Standard (Cloud SQL)

Point-in-time recovery into a new instance, then switch `database-url`:

```bash
gcloud sql instances clone fv-postgres fv-postgres-restore --point-in-time 2026-10-12T09:00:00Z
```

Update the `database-url` secret to the clone's private IP and roll the services
([rotate-secrets.md](rotate-secrets.md#rotation-procedure)). Qdrant is restored as for lean.
