output "ip_address" {
  description = "Load balancer address for the domain's A record."
  value       = google_compute_global_address.lb.address
}
