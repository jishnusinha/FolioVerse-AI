output "workload_identity_provider" {
  description = "Value for the GCP_WIF_PROVIDER GitHub variable."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "publisher_service_account" {
  description = "Value for the GCP_PUBLISHER_SA GitHub variable."
  value       = google_service_account.publisher.email
}

output "deployer_service_account" {
  description = "Value for the GCP_DEPLOYER_SA GitHub variable (production environment)."
  value       = google_service_account.deployer.email
}
