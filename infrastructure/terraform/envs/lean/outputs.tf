output "service_urls" {
  description = "Cloud Run URLs."
  value       = module.platform.service_urls
}

output "registry" {
  description = "Artifact Registry path (GitHub variable GCP_REGISTRY)."
  value       = module.platform.registry
}

output "migrate_job" {
  description = "Migrate job name."
  value       = module.platform.migrate_job
}

output "data_vm_ip" {
  description = "Private address of the data VM (host for DATABASE_URL and REDIS_URL secrets)."
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
