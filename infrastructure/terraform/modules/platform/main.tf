# Shared application platform: registry, runtime identities, secret containers, buckets.
# Secret *values* are never managed here (they would land in state); operators add versions with
# `gcloud secrets versions add` as described in infrastructure/runbooks/rotate-secrets.md.

data "google_project" "this" {
  project_id = var.project_id
}

locals {
  labels = {
    app         = "folioverse"
    environment = var.environment
    managed-by  = "terraform"
  }

  # Environment variable name => Secret Manager secret id (without prefix).
  secret_ids = {
    DATABASE_URL                = "database-url"
    REDIS_URL                   = "redis-url"
    FV_JWT_SECRET               = "jwt-secret"
    FV_INTERNAL_JWT_PRIVATE_KEY = "internal-jwt-private-key"
    FV_INTERNAL_JWT_PUBLIC_KEY  = "internal-jwt-public-key"
    STORAGE_ACCESS_KEY          = "storage-access-key"
    STORAGE_SECRET_KEY          = "storage-secret-key"
    SMTP_URL                    = "smtp-url"
    OPENAI_API_KEY              = "openai-api-key"
    OPENAI_ADMIN_KEY            = "openai-admin-key"
    POSTGRES_PASSWORD           = "postgres-password"
  }

  api_secret_envs = concat(
    ["DATABASE_URL", "REDIS_URL", "FV_JWT_SECRET", "FV_INTERNAL_JWT_PRIVATE_KEY", "FV_INTERNAL_JWT_PUBLIC_KEY", "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY", "SMTP_URL"],
    var.enable_openai_admin ? ["OPENAI_ADMIN_KEY"] : [],
  )
  ai_secret_envs = concat(
    ["DATABASE_URL", "FV_INTERNAL_JWT_PUBLIC_KEY"],
    var.enable_openai ? ["OPENAI_API_KEY"] : [],
  )
}

resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = "folioverse"
  format        = "DOCKER"
  description   = "FolioVerse container images (web, api, ai)."
  labels        = local.labels

  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }
  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "1209600s"
    }
  }
}

resource "google_service_account" "runtime" {
  for_each     = toset(["web", "api", "ai"])
  project      = var.project_id
  account_id   = "${var.name_prefix}-run-${each.key}"
  display_name = "FolioVerse ${each.key} runtime"
}

resource "google_secret_manager_secret" "app" {
  for_each  = local.secret_ids
  project   = var.project_id
  secret_id = "${var.name_prefix}-${each.value}"
  labels    = local.labels

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "api" {
  for_each  = toset(local.api_secret_envs)
  project   = var.project_id
  secret_id = google_secret_manager_secret.app[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.runtime["api"].member
}

resource "google_secret_manager_secret_iam_member" "ai" {
  for_each  = toset(local.ai_secret_envs)
  project   = var.project_id
  secret_id = google_secret_manager_secret.app[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.runtime["ai"].member
}

# Uploaded sources and exports. The API reaches it through the S3-compatible XML API with an
# HMAC key owned by the api runtime account (created by an operator, stored as secrets).
resource "google_storage_bucket" "uploads" {
  project                     = var.project_id
  name                        = "${var.project_id}-${var.name_prefix}-uploads"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = !var.deletion_protection
  labels                      = local.labels

  cors {
    origin          = [var.app_origin]
    method          = ["GET", "PUT", "HEAD"]
    response_header = ["Content-Type", "ETag"]
    max_age_seconds = 3600
  }
}

resource "google_storage_bucket_iam_member" "uploads_api" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectAdmin"
  member = google_service_account.runtime["api"].member
}

resource "google_storage_bucket" "backups" {
  project                     = var.project_id
  name                        = "${var.project_id}-${var.name_prefix}-backups"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = !var.deletion_protection
  labels                      = local.labels

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = var.backup_retention_days
    }
    action {
      type = "Delete"
    }
  }

  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 7
    }
    action {
      type = "Delete"
    }
  }
}

# Runtime identities write traces/metrics/logs to Cloud Ops.
resource "google_project_iam_member" "runtime_telemetry" {
  for_each = {
    for pair in setproduct(keys(google_service_account.runtime), ["roles/cloudtrace.agent", "roles/monitoring.metricWriter", "roles/logging.logWriter"]) :
    "${pair[0]}-${pair[1]}" => { sa = pair[0], role = pair[1] }
  }
  project = var.project_id
  role    = each.value.role
  member  = google_service_account.runtime[each.value.sa].member
}
