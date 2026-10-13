variable "project_id" {
  description = "GCP project id."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Artifact Registry and buckets."
  type        = string
}

variable "name_prefix" {
  description = "Prefix for resource names (Cloud Run services become <prefix>-web, <prefix>-api-http, ...)."
  type        = string
  default     = "fv"
}

variable "environment" {
  description = "Environment label (lean or standard)."
  type        = string
}

variable "app_origin" {
  description = "Public origin of the web app (cookies, CORS, links in emails), e.g. https://folioverse.example.com."
  type        = string
}

variable "images" {
  description = "Initial container images. Releases deploy new revisions with gcloud; Terraform ignores later image changes."
  type = object({
    web = string
    api = string
    ai  = string
  })
}

variable "network_id" {
  description = "VPC id for Direct VPC egress."
  type        = string
}

variable "subnet_id" {
  description = "Subnet id for Direct VPC egress."
  type        = string
}

variable "behind_load_balancer" {
  description = "When true, web and api-http accept traffic only from the internal network and the HTTPS load balancer."
  type        = bool
  default     = false
}

variable "max_instances" {
  description = "Hard caps on Cloud Run instances per service (cost guardrail)."
  type = object({
    web        = number
    api_http   = number
    api_worker = number
    ai_api     = number
    ai_ingest  = number
  })
  default = {
    web        = 3
    api_http   = 4
    api_worker = 2
    ai_api     = 3
    ai_ingest  = 2
  }
}

variable "worker_min_instances" {
  description = "The BullMQ worker needs an always-on instance with CPU always allocated."
  type        = number
  default     = 1
}

variable "plain_env" {
  description = "Non-secret environment shared by the API and AI services (QDRANT_URL, STORAGE_ENDPOINT, model ids, ...)."
  type        = map(string)
  default     = {}
}

variable "enable_openai" {
  description = "Mount the openai-api-key secret into the AI services. Add a secret version before enabling."
  type        = bool
  default     = false
}

variable "enable_openai_admin" {
  description = "Mount the openai-admin-key secret (Costs API reconciliation) into the API. Add a version first."
  type        = bool
  default     = false
}

variable "otel_endpoint" {
  description = "OTLP/HTTP endpoint of a collector reachable from Cloud Run; empty disables tracing."
  type        = string
  default     = ""
}

variable "backup_retention_days" {
  description = "Days to keep database and vector backups in the backup bucket."
  type        = number
  default     = 30
}

variable "billing_account" {
  description = "Billing account id for the budget alert; empty skips the budget."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Monthly GCP budget for the project (alerts at 50%, 90% and 100%, and on forecast)."
  type        = number
  default     = 50
}

variable "alert_email" {
  description = "Email for monitoring and budget notifications; empty sends budget alerts to billing admins only."
  type        = string
  default     = ""
}

variable "deletion_protection" {
  description = "Protect buckets and services from accidental destroy."
  type        = bool
  default     = true
}
