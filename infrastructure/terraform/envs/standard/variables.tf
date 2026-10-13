variable "project_id" {
  description = "GCP project id."
  type        = string
}

variable "region" {
  description = "Region for all regional resources."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "Zone for the Qdrant VM."
  type        = string
  default     = "us-central1-a"
}

variable "domain" {
  description = "Public hostname served by the load balancer (required when enable_load_balancer)."
  type        = string
  default     = ""
}

variable "app_origin" {
  description = "Public origin when the load balancer is disabled (defaults to https://<domain>)."
  type        = string
  default     = ""
}

variable "enable_cloud_sql" {
  description = "Use Cloud SQL for PostgreSQL instead of Postgres on the data VM."
  type        = bool
  default     = true
}

variable "enable_memorystore" {
  description = "Use Memorystore for Redis instead of Redis on the data VM."
  type        = bool
  default     = true
}

variable "enable_load_balancer" {
  description = "Front web and api-http with a global HTTPS load balancer and managed certificate."
  type        = bool
  default     = true
}

variable "sql_tier" {
  description = "Cloud SQL tier."
  type        = string
  default     = "db-custom-1-3840"
}

variable "sql_high_availability" {
  description = "Regional (HA) Cloud SQL."
  type        = bool
  default     = false
}

variable "images" {
  description = "Initial images (pushed by the release workflow before the first apply)."
  type = object({
    web = string
    api = string
    ai  = string
  })
}

variable "github_repository" {
  description = "GitHub repository (owner/name) allowed to publish and deploy."
  type        = string
}

variable "billing_account" {
  description = "Billing account id for the budget alert; empty skips it."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Monthly project budget in USD."
  type        = number
  default     = 150
}

variable "alert_email" {
  description = "Email for alerts; empty disables the email channel."
  type        = string
  default     = ""
}

variable "enable_openai" {
  description = "Mount the openai-api-key secret (add a version first)."
  type        = bool
  default     = false
}

variable "openai_model" {
  description = "Exact OpenAI model id you are entitled to use (never defaulted)."
  type        = string
  default     = ""
}

variable "mail_from" {
  description = "From address for transactional email."
  type        = string
  default     = ""
}

variable "max_instances" {
  description = "Per-service Cloud Run instance caps."
  type = object({
    web        = number
    api_http   = number
    api_worker = number
    ai_api     = number
    ai_ingest  = number
  })
  default = {
    web        = 4
    api_http   = 6
    api_worker = 3
    ai_api     = 4
    ai_ingest  = 3
  }
}
