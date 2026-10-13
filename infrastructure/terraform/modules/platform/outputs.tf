output "service_urls" {
  description = "Cloud Run service URLs."
  value       = { for k, s in google_cloud_run_v2_service.svc : k => s.uri }
}

output "service_names" {
  description = "Cloud Run service names, keyed by role."
  value       = { for k, s in google_cloud_run_v2_service.svc : k => s.name }
}

output "migrate_job" {
  description = "Cloud Run job that applies migrations."
  value       = google_cloud_run_v2_job.migrate.name
}

output "registry" {
  description = "Artifact Registry path for images (<region>-docker.pkg.dev/<project>/folioverse)."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "runtime_service_accounts" {
  description = "Runtime service account emails, keyed by role (web, api, ai)."
  value       = { for k, sa in google_service_account.runtime : k => sa.email }
}

output "secret_ids" {
  description = "Secret Manager secret ids to populate, keyed by environment variable."
  value       = { for k, s in google_secret_manager_secret.app : k => s.secret_id }
}

output "uploads_bucket" {
  description = "Bucket for uploads and exports."
  value       = google_storage_bucket.uploads.name
}

output "backups_bucket" {
  description = "Bucket for database and vector backups."
  value       = google_storage_bucket.backups.name
}

output "postgres_password_secret" {
  description = "Secret id holding the self-hosted Postgres password (lean data VM)."
  value       = google_secret_manager_secret.app["POSTGRES_PASSWORD"].secret_id
}

output "web_service_name" {
  description = "web service name (load balancer backend)."
  value       = google_cloud_run_v2_service.svc["web"].name
}

output "api_service_name" {
  description = "api-http service name (load balancer backend)."
  value       = google_cloud_run_v2_service.svc["api-http"].name
}
