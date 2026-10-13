# Standard profile: the lean platform plus Cloud SQL, Memorystore and a global HTTPS load balancer,
# each toggled by a variable. Qdrant stays on a small private VM (no managed Qdrant on GCP).
# Validated in CI; never applied by CI.

locals {
  name_prefix = "fv"
  origin      = var.app_origin != "" ? var.app_origin : "https://${var.domain}"
  apis = concat(
    [
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
    ],
    var.enable_cloud_sql || var.enable_memorystore ? ["servicenetworking.googleapis.com"] : [],
    var.enable_cloud_sql ? ["sqladmin.googleapis.com"] : [],
    var.enable_memorystore ? ["redis.googleapis.com"] : [],
  )
}

check "load_balancer_needs_domain" {
  assert {
    condition     = !var.enable_load_balancer || var.domain != ""
    error_message = "Set domain when enable_load_balancer is true."
  }
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

module "managed_data" {
  source                = "../../modules/managed_data"
  project_id            = var.project_id
  region                = var.region
  name_prefix           = local.name_prefix
  network_id            = module.network.network_id
  enable_cloud_sql      = var.enable_cloud_sql
  enable_memorystore    = var.enable_memorystore
  sql_tier              = var.sql_tier
  sql_high_availability = var.sql_high_availability
  depends_on            = [google_project_service.apis]
}

module "platform" {
  source               = "../../modules/platform"
  project_id           = var.project_id
  region               = var.region
  name_prefix          = local.name_prefix
  environment          = "standard"
  app_origin           = local.origin
  images               = var.images
  network_id           = module.network.network_id
  subnet_id            = module.network.subnet_id
  behind_load_balancer = var.enable_load_balancer
  max_instances        = var.max_instances
  enable_openai        = var.enable_openai

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

# Qdrant always; Postgres/Redis only when their managed replacements are switched off.
module "data" {
  source                   = "../../modules/data_vm"
  project_id               = var.project_id
  region                   = var.region
  zone                     = var.zone
  name_prefix              = local.name_prefix
  network_id               = module.network.network_id
  subnet_id                = module.network.subnet_id
  subnet_cidr              = module.network.subnet_cidr
  machine_type             = var.enable_cloud_sql && var.enable_memorystore ? "e2-medium" : "e2-standard-2"
  run_postgres             = !var.enable_cloud_sql
  run_redis                = !var.enable_memorystore
  postgres_password_secret = module.platform.postgres_password_secret
  backup_bucket            = module.platform.backups_bucket
}

module "load_balancer" {
  source      = "../../modules/load_balancer"
  count       = var.enable_load_balancer ? 1 : 0
  project_id  = var.project_id
  region      = var.region
  name_prefix = local.name_prefix
  domain      = var.domain
  web_service = module.platform.web_service_name
  api_service = module.platform.api_service_name
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
