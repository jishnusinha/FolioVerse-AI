# Secrets

All runtime secrets live in Secret Manager as `fv-<id>`; Terraform creates the containers and
IAM but never values. Cloud Run reads version `latest` **when a revision starts**, so a rotation
takes effect only after a new revision is rolled out. Local development uses `.env`
(`pnpm gen-keys` fills the generated ones; it never prints values).

| Env var | Secret id | Used by | Effect of rotating |
| --- | --- | --- | --- |
| `DATABASE_URL` | `database-url` | api, worker, ai | Change the DB password first, then this |
| `REDIS_URL` | `redis-url` | api, worker | — |
| `FV_JWT_SECRET` | `jwt-secret` | api | Every user session ends; users sign in again |
| `FV_INTERNAL_JWT_PRIVATE_KEY` / `_PUBLIC_KEY` | `internal-jwt-private-key` / `-public-key` | api signs, ai verifies | Rotate as a pair; in-flight AI calls fail with 401 |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | `storage-access-key` / `-secret-key` | api | GCS HMAC key of `fv-run-api` |
| `SMTP_URL` | `smtp-url` | api | — |
| `OPENAI_API_KEY` | `openai-api-key` | ai | Only when `enable_openai = true` |
| `OPENAI_ADMIN_KEY` | `openai-admin-key` | api (reconciliation) | Only when `enable_openai_admin = true` |
| `POSTGRES_PASSWORD` | `postgres-password` | lean data VM | Read at VM boot |

## Adding a version

```bash
read -rs VALUE && printf '%s' "$VALUE" | gcloud secrets versions add fv-jwt-secret --data-file=- && unset VALUE
```

Generate values locally, never in CI logs: `openssl rand -base64 48` for `jwt-secret`; for the
internal pair, `openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt`
(private) and `openssl ec -pubout` of it (public). GCS HMAC:
`gcloud storage hmac create fv-run-api@P.iam.gserviceaccount.com` prints the pair once —
pipe it straight into the two secrets.

## Rotation procedure

1. Add the new version (above). For credentials with two sides (database password, HMAC key),
   create the new credential first and keep the old one valid.
2. Roll new revisions of every service that uses it, e.g.

   ```bash
   gcloud run services update fv-api-http --region R --update-env-vars FV_SECRETS_ROTATED_AT=$(date -u +%s)
   ```

   (repeat for `fv-api-worker`, and `fv-ai-api`/`fv-ai-ingest` where listed). The marker variable is
   removed on the next `terraform apply`, which simply creates one more revision.
3. Check `/api/ready` and the deployed smoke.
4. Revoke the old credential, then disable the old secret version:
   `gcloud secrets versions disable <n> --secret fv-<id>`. Destroy it after a week.

For the internal JWT pair, drain first: wait until the *Runs* dashboard shows no runs in
progress, then update the AI services and the API in the same window.

## Model prices

Alert *Unpriced model usage* means a ledger entry was recorded with cost class `unpriced`:
a model ran without a price effective at that time. Spend is understated until fixed.

1. Admin → **Model prices** (`/app/admin/pricing`); find models with no current price.
2. Add the price from the provider's published price page and paste that URL as the source.
   Never guess a price and never copy one from another model. DEMO prices are only for DEMO
   models and are labelled as such.
3. Prices are not applied retroactively. If the gap matters for reporting, record the
   correction in the reconciliation view (Admin → **Cost Command Center**), which compares the
   ledger with the provider's invoice export.

## Suspected key abuse

Alert *Real AI spend above $5/hour* (or a provider usage email) with no matching activity.

1. **Contain**: disable the paid models — Admin → **Model registry**, set status `DISABLED`
   (or `PATCH /api/admin/models/<id>` with `{"status":"DISABLED"}`). New runs on them are
   refused immediately; DEMO models keep working.
2. Revoke the key in the provider console and create a new one with the smallest scope and a
   provider-side spending limit.
3. Rotate `openai-api-key` (procedure above) and, if the admin key may be exposed,
   `openai-admin-key`.
4. Investigate: Cost Command Center by model and workspace; the ledger links every charge to a
   run, workspace and user. Check audit events for budget or model changes, and the access log
   of `fv-<id>` secrets: `gcloud logging read 'protoPayload.serviceName="secretmanager.googleapis.com"'`.
5. Re-enable models once the new key is deployed, and tighten workspace budgets if a workspace
   was the source.
