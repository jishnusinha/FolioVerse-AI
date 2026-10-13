# Deploy

Two Terraform profiles live in `infrastructure/terraform/envs`:

- **lean**: five Cloud Run services, one private `e2-standard-2` VM (Container-Optimized OS)
  running Postgres, Redis and Qdrant, GCS for uploads and backups. Cheapest always-on shape.
- **standard**: the same services with Cloud SQL (private IP, PITR) and Memorystore, an optional
  external HTTPS load balancer with a managed certificate, and the VM reduced to Qdrant.

Cloud Run services: `fv-web`, `fv-api-http`, `fv-api-worker` (min 1, CPU always on),
`fv-ai-api`, `fv-ai-ingest` (internal ingress), plus the `fv-migrate` job.

## First-time bootstrap

Prerequisites: `gcloud`, Terraform ≥ 1.9, Docker, a project with billing enabled (an operator
decision; nothing here creates or modifies billing accounts), Owner on the project.

1. **State bucket** (once per project):

   ```bash
   gcloud storage buckets create gs://P-tfstate --project P --location R \
     --uniform-bucket-level-access --public-access-prevention
   gcloud storage buckets update gs://P-tfstate --versioning
   ```

2. **Variables**: `cd infrastructure/terraform/envs/lean` (or `standard`),
   `cp terraform.tfvars.example terraform.tfvars` and fill it in. The file is git-ignored and
   must never contain secret values. `app_origin` is `https://fv-web-<PROJECT_NUMBER>.R.run.app`
   (or `https://<domain>` behind the load balancer).

3. **Init**: `terraform init -backend-config="bucket=P-tfstate" -backend-config="prefix=folioverse/lean"`

4. **Foundations** (registry, secret containers, network). Cloud Run cannot be created before
   its images and secret versions exist, so the first apply is targeted:

   ```bash
   terraform apply -target=google_project_service.apis \
     -target=module.platform.google_artifact_registry_repository.images \
     -target=module.platform.google_secret_manager_secret.app -target=module.network
   ```

5. **Secrets**: add a version to each id in `terraform output secrets_to_populate` following
   [rotate-secrets.md](rotate-secrets.md#adding-a-version). Do `postgres-password` first, then
   apply the data VM (`terraform apply -target=module.data`), then build `database-url` and
   `redis-url` from `terraform output data_vm_ip`:
   `postgresql://folioverse:<password>@<ip>:5432/folioverse?schema=app` and `redis://<ip>:6379`.
   Leave `openai-api-key`/`openai-admin-key` empty-versioned only if `enable_openai` is false.

6. **Bootstrap images**: build and push once from a workstation, tagged `BOOTSTRAP_TAG` as in
   `terraform.tfvars`:

   ```bash
   gcloud auth configure-docker R-docker.pkg.dev
   for s in web api ai; do
     docker build -f infrastructure/docker/$s.Dockerfile -t R-docker.pkg.dev/P/folioverse/$s:BOOTSTRAP_TAG .
     docker push R-docker.pkg.dev/P/folioverse/$s:BOOTSTRAP_TAG
   done
   ```

7. **Everything else**: `terraform plan -out tf.plan`, review, `terraform apply tf.plan`.
   Then run migrations and the seed: `gcloud run jobs execute fv-migrate --region R --wait`.

8. **GitHub**: set the repository variables from `terraform output github_variables`
   (`GCP_PROJECT_ID`, `GCP_REGION`, `GCP_REGISTRY`, `GCP_WIF_PROVIDER`, `GCP_PUBLISHER_SA`,
   `GCP_DEPLOYER_SA`) plus `FV_PUBLIC_URL` (the web URL). Create the `production` environment
   with required reviewers; the deployer identity only trusts tokens issued for that
   environment, so an unapproved job cannot deploy. No JSON keys are created anywhere.

9. **Observability**: Cloud Run sends logs and the built-in metrics to Cloud Monitoring; the
   uptime check and alert policies come from Terraform. To export OTel traces/metrics, run a
   collector with `infrastructure/otel/collector.yaml` (e.g. as another Cloud Run service with
   `FV_OTLP_UPSTREAM` pointing at your backend) and set `OTEL_EXPORTER_OTLP_ENDPOINT` in the
   platform module's `plain_env`. Telemetry stays off until that variable is set.

10. **Verify**: `node infrastructure/scripts/smoke-deployed.mjs --base https://<web url>`.

## Releasing

Push a tag `vX.Y.Z` (or run *Release* manually). `.github/workflows/release.yml`:

1. builds `web`, `api`, `ai` images, writes SBOMs, fails on CRITICAL Trivy findings, pushes to
   Artifact Registry with the publisher identity;
2. waits for `production` approval, records the serving revision of every service;
3. points `fv-migrate` at the new api image and runs it (`--wait`);
4. deploys `fv-ai-api`, `fv-ai-ingest`, `fv-api-worker`, `fv-api-http`, `fv-web` in that order
   (consumers before producers so new callers never reach old callees);
5. runs the deployed smoke and, if it fails, shifts traffic back to the recorded revisions.

Terraform ignores the image field, so a later `terraform apply` never reverts a release.

### Migrations: expand, then contract

The previous revision keeps serving while `fv-migrate` runs, and a rollback keeps the new
schema. Every migration must therefore work with the code of the release before it:

- **Expand** (this release): add tables/nullable columns/indexes (`CREATE INDEX CONCURRENTLY`
  for large tables), write to both shapes, backfill in a job.
- **Contract** (a later release, once no deployed revision reads the old shape): drop columns,
  add `NOT NULL`, remove fallbacks.

Never edit an applied migration. A destructive migration needs a fresh backup
([restore-backup.md](restore-backup.md#taking-a-backup-before-a-risky-change)) and a second reviewer.

## Health checks

| Endpoint | Meaning |
| --- | --- |
| `GET /healthz` (web) | Caddy is serving |
| `GET /api/live` | API process is up |
| `GET /api/ready` | Database, Redis, storage and AI service reachable; `checks.aiService` false means the API is up but AI calls will fail |
| worker `GET /live`, `/ready` | Worker process up; `/ready` reads queue depths from Redis |
| ai `GET /healthz`, `/readyz` | AI service up; `/readyz` checks Postgres, Qdrant and that the internal public key is configured |

Triage order when an alert fires (ingestion failures, 5xx, uptime):

1. `node infrastructure/scripts/smoke-deployed.mjs --base <url>` — read-only, safe in production.
2. Grafana *FolioVerse — Ingestion* / *Runs* dashboards, or Cloud Monitoring for GCP; group
   failures by `mime` and `state`.
3. Open a failing trace (Tempo/Cloud Trace) and filter by `fv.workspace_id`, `fv.run_id` or
   `fv.source_version_id`: one trace covers API → queue → worker → AI service → graph nodes.
4. Logs: `gcloud run services logs read fv-ai-ingest --region R --limit 200` (logs never include
   source text or secrets by default).
5. Common causes: AI service cold start or OOM (raise memory), Qdrant unreachable from the
   VPC connector, a document type the parser rejects (user-visible error, not an incident),
   storage HMAC key rotated without a redeploy.

Failed sources can be re-ingested from the source's page once the cause is fixed.

## Rollback

Code rollback is a traffic shift; it does not touch the database.

```bash
for s in web api-http api-worker ai-ingest ai-api; do
  gcloud run revisions list --service fv-$s --region R --limit 5
done
gcloud run services update-traffic fv-api-http --region R --to-revisions <previous-revision>=100
```

Roll back in the reverse of the deploy order (web first, AI services last). The release
workflow does this automatically when its smoke fails; do it by hand when an alert such as
*Run failure rate above 20%* fires after a release.

- Thanks to expand/contract, the previous code works against the new schema. If a migration
  itself corrupted data, stop writes (scale `fv-api-worker` to 0, put `fv-web` on the previous
  revision) and follow [restore-backup.md](restore-backup.md).
- `fv-migrate` keeps the new image; the next release updates it again.
- Local/compose: `git checkout <previous tag> && pnpm up`.
- After the incident, roll forward with a fix rather than leaving traffic pinned: pinned
  traffic stops `gcloud run deploy` from sending traffic to new revisions until
  `--to-latest` is used.
