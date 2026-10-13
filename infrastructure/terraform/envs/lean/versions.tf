terraform {
  required_version = ">= 1.6"

  # State lives in a versioned GCS bucket created once by hand:
  #   terraform init -backend-config="bucket=<state-bucket>" -backend-config="prefix=folioverse/lean"
  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.10, < 7.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
