variable "project_id" {
  description = "GCP project id."
  type        = string
}

variable "region" {
  description = "Region for Cloud SQL and Memorystore."
  type        = string
}

variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "network_id" {
  description = "VPC id for private service access."
  type        = string
}

variable "enable_cloud_sql" {
  description = "Create Cloud SQL for PostgreSQL 16."
  type        = bool
  default     = true
}

variable "enable_memorystore" {
  description = "Create Memorystore for Redis."
  type        = bool
  default     = true
}

variable "sql_tier" {
  description = "Cloud SQL machine tier."
  type        = string
  default     = "db-custom-1-3840"
}

variable "sql_disk_gb" {
  description = "Initial Cloud SQL disk size (auto-resizes)."
  type        = number
  default     = 20
}

variable "sql_high_availability" {
  description = "Regional (HA) Cloud SQL instance."
  type        = bool
  default     = false
}

variable "sql_backup_retention" {
  description = "Number of automated Cloud SQL backups to keep."
  type        = number
  default     = 14
}

variable "redis_tier" {
  description = "Memorystore tier (BASIC or STANDARD_HA)."
  type        = string
  default     = "BASIC"
}

variable "redis_memory_gb" {
  description = "Memorystore size."
  type        = number
  default     = 1
}
