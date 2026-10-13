variable "project_id" {
  description = "GCP project id."
  type        = string
}

variable "region" {
  description = "Region of the snapshot policy."
  type        = string
}

variable "zone" {
  description = "Zone for the VM and its data disk."
  type        = string
}

variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "network_id" {
  description = "VPC id (firewall)."
  type        = string
}

variable "subnet_id" {
  description = "Subnet for the VM's private interface."
  type        = string
}

variable "subnet_cidr" {
  description = "Workload range allowed to reach the data ports."
  type        = string
}

variable "machine_type" {
  description = "VM size. e2-standard-2 fits the lean profile (Postgres, Redis and Qdrant together)."
  type        = string
  default     = "e2-standard-2"
}

variable "data_disk_gb" {
  description = "Size of the persistent data disk."
  type        = number
  default     = 50
}

variable "snapshot_retention_days" {
  description = "Days to keep daily disk snapshots."
  type        = number
  default     = 7
}

variable "run_postgres" {
  description = "Run Postgres on the VM (false when Cloud SQL is used)."
  type        = bool
  default     = true
}

variable "run_redis" {
  description = "Run Redis on the VM (false when Memorystore is used)."
  type        = bool
  default     = true
}

variable "postgres_password_secret" {
  description = "Secret Manager secret id holding the Postgres password."
  type        = string
}

variable "backup_bucket" {
  description = "Bucket for nightly logical backups."
  type        = string
}

variable "qdrant_collection" {
  description = "Qdrant collection to snapshot."
  type        = string
  default     = "fv_chunks_v1"
}
