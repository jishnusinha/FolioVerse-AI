# Lean profile: five Cloud Run services + one private e2-standard-2 VM running Postgres, Redis and
# Qdrant, a GCS bucket for uploads and one for backups, Secret Manager, Artifact Registry, Cloud
# Ops alerts and a budget. Validated in CI (`terraform validate`, `tflint`); never applied by CI.

locals {
  name_prefix = "fv"
  apis = [
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudtrace.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sts.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

module "network" {
  source      = "../../modules/network"
  project_id  = var.project_id
  region      = var.region
  name_prefix = local.name_prefix
  depends_on  = [google_project_service.apis]
}

module "platform" {
  source        = "../../modules/platform"
  project_id    = var.project_id
  region        = var.region
  name_prefix   = local.name_prefix
  environment   = "lean"
  app_origin    = var.app_origin
  images        = var.images
  network_id    = module.network.network_id
  subnet_id     = module.network.subnet_id
  max_instances = var.max_instances
  enable_openai = var.enable_openai

  plain_env = {
    QDRANT_URL               = "http://${module.data.internal_ip}:6333"
    STORAGE_ENDPOINT         = "https://storage.googleapis.com"
    STORAGE_PUBLIC_ENDPOINT  = "https://storage.googleapis.com"
    STORAGE_REGION           = "auto"
    STORAGE_FORCE_PATH_STYLE = "true"
    FV_UPLOAD_MODE           = "proxy"
    FV_OPENAI_MODEL          = var.openai_model
    MAIL_FROM                = var.mail_from
  }

  billing_account    = var.billing_account
  monthly_budget_usd = var.monthly_budget_usd
  alert_email        = var.alert_email
  depends_on         = [google_project_service.apis]
}

module "data" {
  source                   = "../../modules/data_vm"
  project_id               = var.project_id
  region                   = var.region
  zone                     = var.zone
  name_prefix              = local.name_prefix
  network_id               = module.network.network_id
  subnet_id                = module.network.subnet_id
  subnet_cidr              = module.network.subnet_cidr
  machine_type             = "e2-standard-2"
  run_postgres             = true
  run_redis                = true
  postgres_password_secret = module.platform.postgres_password_secret
  backup_bucket            = module.platform.backups_bucket
}

module "github" {
  source                   = "../../modules/github_wif"
  project_id               = var.project_id
  region                   = var.region
  name_prefix              = local.name_prefix
  github_repository        = var.github_repository
  artifact_repository      = "folioverse"
  runtime_service_accounts = values(module.platform.runtime_service_accounts)
  depends_on               = [module.platform]
}
