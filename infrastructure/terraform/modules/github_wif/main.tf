# Keyless GitHub Actions access through Workload Identity Federation (no JSON keys).
#  - publisher: any workflow run in the repository may push images to Artifact Registry.
#  - deployer:  only jobs running in the protected `production` environment (manual approval)
#               may roll out Cloud Run revisions and execute the migrate job.

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "${var.name_prefix}-github"
  display_name              = "GitHub Actions"
}

# trivy:ignore:AVD-GCP-0068 the repository condition below is set; the scanner cannot resolve the variable.
resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"
  attribute_condition                = "assertion.repository == \"${var.github_repository}\""

  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.repository"  = "assertion.repository"
    "attribute.environment" = "assertion.environment"
    "attribute.ref"         = "assertion.ref"
  }

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "publisher" {
  project      = var.project_id
  account_id   = "${var.name_prefix}-gh-publisher"
  display_name = "GitHub Actions image publisher"
}

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "${var.name_prefix}-gh-deployer"
  display_name = "GitHub Actions production deployer"
}

resource "google_service_account_iam_member" "publisher_wif" {
  service_account_id = google_service_account.publisher.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.environment/production"
}

resource "google_artifact_registry_repository_iam_member" "publisher" {
  project    = var.project_id
  location   = var.region
  repository = var.artifact_repository
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.publisher.member
}

resource "google_artifact_registry_repository_iam_member" "deployer_read" {
  project    = var.project_id
  location   = var.region
  repository = var.artifact_repository
  role       = "roles/artifactregistry.reader"
  member     = google_service_account.deployer.member
}

resource "google_project_iam_member" "deployer_run" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = google_service_account.deployer.member
}

# Deploying a revision that runs as a runtime identity requires actAs on that identity.
resource "google_service_account_iam_member" "deployer_act_as" {
  for_each           = toset(var.runtime_service_accounts)
  service_account_id = "projects/${var.project_id}/serviceAccounts/${each.value}"
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deployer.member
}
