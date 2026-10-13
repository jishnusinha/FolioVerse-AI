variable "project_id" {
  description = "GCP project id."
  type        = string
}

variable "region" {
  description = "Artifact Registry region."
  type        = string
}

variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "github_repository" {
  description = "GitHub repository allowed to federate, as owner/name."
  type        = string
}

variable "artifact_repository" {
  description = "Artifact Registry repository id the publisher pushes to."
  type        = string
}

variable "runtime_service_accounts" {
  description = "Runtime service account emails the deployer may deploy as."
  type        = list(string)
}
