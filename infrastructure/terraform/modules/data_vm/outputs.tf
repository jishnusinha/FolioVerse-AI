output "internal_ip" {
  description = "Private address of the data VM (DATABASE_URL, REDIS_URL and QDRANT_URL host)."
  value       = google_compute_instance.data.network_interface[0].network_ip
}

output "instance_name" {
  description = "VM name (for IAP SSH: gcloud compute ssh <name> --tunnel-through-iap)."
  value       = google_compute_instance.data.name
}
