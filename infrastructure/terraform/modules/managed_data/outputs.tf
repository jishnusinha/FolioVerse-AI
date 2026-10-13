output "sql_private_ip" {
  description = "Cloud SQL private address (DATABASE_URL host); null when Cloud SQL is disabled."
  value       = try(google_sql_database_instance.postgres[0].private_ip_address, null)
}

output "sql_instance" {
  description = "Cloud SQL instance name."
  value       = try(google_sql_database_instance.postgres[0].name, null)
}

output "redis_host" {
  description = "Memorystore address (REDIS_URL host); null when Memorystore is disabled."
  value       = try(google_redis_instance.cache[0].host, null)
}
