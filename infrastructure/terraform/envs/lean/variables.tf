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
  description = "Zone for the data VM."
  type        = string
  default     = "us-central1-a"
}

variable "app_origin" {
  description = "Public origin users open (the web service URL or a mapped domain)."
  type        = string
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
  default     = 30
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
    web        = 2
    api_http   = 2
    api_worker = 1
    ai_api     = 2
    ai_ingest  = 1
  }
}
