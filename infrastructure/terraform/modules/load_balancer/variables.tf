variable "project_id" {
  description = "GCP project id."
  type        = string
}

variable "region" {
  description = "Region of the Cloud Run services."
  type        = string
}

variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "domain" {
  description = "Public hostname; point its A record at the load balancer address."
  type        = string
}

variable "web_service" {
  description = "Cloud Run service serving the SPA."
  type        = string
}

variable "api_service" {
  description = "Cloud Run service serving /api."
  type        = string
}

variable "security_policy" {
  description = "Optional Cloud Armor policy id attached to both backends."
  type        = string
  default     = null
}
