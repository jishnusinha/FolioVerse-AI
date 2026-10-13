output "network_id" {
  description = "VPC id."
  value       = google_compute_network.vpc.id
}

output "network_name" {
  description = "VPC name."
  value       = google_compute_network.vpc.name
}

output "subnet_id" {
  description = "Workload subnet id."
  value       = google_compute_subnetwork.main.id
}

output "subnet_name" {
  description = "Workload subnet name."
  value       = google_compute_subnetwork.main.name
}

output "subnet_cidr" {
  description = "Workload subnet range (firewall source for the data tier)."
  value       = google_compute_subnetwork.main.ip_cidr_range
}
