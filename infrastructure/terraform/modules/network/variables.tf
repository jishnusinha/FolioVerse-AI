variable "project_id" {
  description = "GCP project id."
  type        = string
}

variable "region" {
  description = "Region for the subnet, router and NAT."
  type        = string
}

variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
}

variable "subnet_cidr" {
  description = "Primary range of the workload subnet (Cloud Run Direct VPC egress and data VMs)."
  type        = string
  default     = "10.20.0.0/20"
}
