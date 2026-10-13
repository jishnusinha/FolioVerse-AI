---
title: GCP deployment
description: The Terraform profiles for Google Cloud, what they create and how a first deployment would proceed.
section: DevOps
order: 2
gates: [10]
blocked: [GCP project / WIF / Artifact Registry, GitHub remote + Actions]
---

FolioVerse is designed to run on Google Cloud with Cloud Run for the stateless services. The Terraform code is
complete and validated (`terraform validate`, `tflint`, Trivy config scan), but **it has never been applied**: no
GCP project, credentials or GitHub remote are configured. Nothing on this page has been deployed.

## Profiles

| Profile | Path | What it creates |
| --- | --- | --- |
| Lean | `infrastructure/terraform/envs/lean` | Five Cloud Run services (web, api-http, api-worker, ai-api, ai-ingest) and a migrate job; one private `e2-standard-2` VM running Postgres, Redis and Qdrant; GCS buckets for uploads and backups; Secret Manager; Artifact Registry; Cloud Monitoring uptime check and alerts; an optional budget |
| Standard | `infrastructure/terraform/envs/standard` | The lean platform plus Cloud SQL, Memorystore and a global HTTPS load balancer, each switched on by a variable. Qdrant stays on a small private VM because GCP has no managed Qdrant |

Modules live in `infrastructure/terraform/modules`: `network`, `platform`, `data_vm`, `managed_data`,
`load_balancer` and `github_wif`.

## Identity and secrets

- GitHub Actions authenticates through Workload Identity Federation (`github_wif`): no service account keys.
  Publishing images and deploying use separate identities.
- Each Cloud Run service has its own runtime service account with only the roles it needs.
- Terraform creates the Secret Manager *containers*; secret values are added with `gcloud` and never appear in
  Terraform state or variables. See the [rotate-secrets runbook](../../infrastructure/runbooks/rotate-secrets.md).
- Object storage uses GCS through its S3-compatible XML API with HMAC keys, so the same S3 client works locally and
  in the cloud.

## First deployment, step by step

The [deploy runbook](../../infrastructure/runbooks/deploy.md) covers bootstrap, releases, expand/contract
migrations, health checks and rollback. In outline:

1. Create a project, enable billing and copy `terraform.tfvars.example` to `terraform.tfvars` (git-ignored).
2. `terraform init` and `terraform apply` in `envs/lean` (or `envs/standard`).
3. Add the secret values to Secret Manager and set the `GCP_*` repository variables for `release.yml`.
4. Push a release; approve the `production` environment; the workflow migrates, rolls out by digest, runs the
   deployed smoke and rolls back on failure.

Treat the first run as a rehearsal: the procedures have only been exercised against local stand-ins.

## Costs

Cloud Run scales to zero, so the lean profile's fixed cost is mostly the data VM, storage and logging. The optional
budget (`monthly_budget_usd`) alerts by email. Actual cloud spend can be entered by hand in the Cost Command Center,
or imported from a GCP Billing export once one is configured (blocked today).
