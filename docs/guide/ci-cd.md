---
title: CI/CD
description: What runs on every change, how images are built and scanned, and how a release reaches Cloud Run.
section: DevOps
order: 1
gates: [0, 10]
blocked: [GitHub remote + Actions]
---

Three GitHub Actions workflows live in `.github/workflows`, validated with actionlint. `ci.yml` runs on GitHub
(`jishnusinha/FolioVerse-AI`); `kaggle-smoke.yml` has not run there yet, and `release.yml` still needs a GCP project
and Workload Identity Federation.

## ci.yml: every push and pull request

A `changes` job uses path filters so each job runs only when its inputs change.

| Job | Runs when | What it does |
| --- | --- | --- |
| `node` | web, api or contracts change | `pnpm lint`, `pnpm typecheck`, unit tests, `pnpm contracts:check`, web build |
| `web-e2e` | web changes | Prototype checks and shell end-to-end tests in Playwright (Chromium) |
| `api-integration` | api changes | Integration tests against Postgres, Redis and SeaweedFS service containers |
| `ai` | AI service or ML package change | Ruff and pytest with the mock provider, hash embedder and in-memory Qdrant |
| `docs` | docs, guide pages or their sources change | Tests the content generators, builds this documentation site and uploads it as the `docs-site` artifact |
| `docker` | Dockerfiles or lockfiles change, and every push to `main` | Builds the three images, checks they run as non-root, a read-only runtime smoke for web, SPDX SBOMs, Trivy (CRITICAL with a fix fails the build) |
| `infra` | infrastructure or workflows change | Compose config, infra script tests, Grafana dashboards and runbook links, OTel collector and Caddyfile validation, Terraform fmt/validate, tflint, Trivy config scan, actionlint |

CI never consumes paid inference: no provider keys are configured and `FV_LIVE_PROVIDER_TESTS` is `0`.

## kaggle-smoke.yml: research notebooks

On manual dispatch and on pull requests that touch the notebooks or the code they exercise, the workflow runs
ruff on `ml-notebooks` and executes all eleven notebooks in smoke mode (`KAGGLE_SMOKE=1`, about three minutes),
uploading the executed notebooks and metrics as artifacts. See [Research notebooks](../notebooks.md).

## release.yml: publish and deploy

Releases are keyless: GitHub OIDC tokens are exchanged through Workload Identity Federation for two separate
service accounts, a publisher and a deployer.

1. **preflight** stops with a warning (and builds nothing) unless the `GCP_*` repository variables are set.
2. **publish** builds, scans and SBOMs the web, api and ai images and pushes them to Artifact Registry by digest.
3. **deploy** waits for approval of the `production` environment, runs the migrate job, rolls out the Cloud Run
   services by digest, runs the read-only deployed smoke (`pnpm smoke:deployed`) and shifts traffic back to the
   previous revision if the smoke fails.

The procedure, health checks and manual rollback are in the [deploy runbook](../../infrastructure/runbooks/deploy.md).

## Running the same checks locally

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration
pnpm --filter @folioverse/web run test:e2e
pnpm test:infra
pnpm --filter @folioverse/docs test && pnpm docs:build
```

Screenshots are not captured in CI: they need a running stack. Run `pnpm docs:shots` against `pnpm dev` and
commit the images in `docs/screenshots` together with their `manifest.json`.
