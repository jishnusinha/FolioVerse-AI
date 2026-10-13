output "service_urls" {
  description = "Cloud Run URLs (web and api-http accept load balancer traffic only when it is enabled)."
  value       = module.platform.service_urls
}

output "load_balancer_ip" {
  description = "Point the domain's A record here."
  value       = try(module.load_balancer[0].ip_address, null)
}

output "registry" {
  description = "Artifact Registry path (GitHub variable GCP_REGISTRY)."
  value       = module.platform.registry
}

output "migrate_job" {
  description = "Migrate job name."
  value       = module.platform.migrate_job
}

output "database_host" {
  description = "Postgres host for the DATABASE_URL secret."
  value       = coalesce(module.managed_data.sql_private_ip, module.data.internal_ip)
}

output "redis_host" {
  description = "Redis host for the REDIS_URL secret."
  value       = coalesce(module.managed_data.redis_host, module.data.internal_ip)
}

output "qdrant_host" {
  description = "Private address of the Qdrant VM."
  value       = module.data.internal_ip
}

output "secrets_to_populate" {
  description = "Secret ids that need a version before the first deploy (see runbooks/rotate-secrets.md)."
  value       = module.platform.secret_ids
}

output "github_variables" {
  description = "Repository/environment variables for .github/workflows/release.yml."
  value = {
    GCP_PROJECT_ID    = var.project_id
    GCP_REGION        = var.region
    GCP_REGISTRY      = module.platform.registry
    GCP_WIF_PROVIDER  = module.github.workload_identity_provider
    GCP_PUBLISHER_SA  = module.github.publisher_service_account
    GCP_DEPLOYER_SA   = module.github.deployer_service_account
    FV_SERVICE_PREFIX = "fv"
  }
}
