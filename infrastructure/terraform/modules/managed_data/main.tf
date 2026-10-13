# Standard profile data tier: Cloud SQL for PostgreSQL 16 and Memorystore for Redis, both on
# private service access. The database user's password is set by an operator (runbook), so it
# never appears in Terraform state.

resource "google_compute_global_address" "private_services" {
  count         = var.enable_cloud_sql || var.enable_memorystore ? 1 : 0
  project       = var.project_id
  name          = "${var.name_prefix}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = var.network_id
}

resource "google_service_networking_connection" "private_services" {
  count                   = var.enable_cloud_sql || var.enable_memorystore ? 1 : 0
  network                 = var.network_id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services[0].name]
}

# trivy:ignore:AVD-GCP-0015 TLS is enforced by ssl_mode = ENCRYPTED_ONLY (successor of require_ssl).
resource "google_sql_database_instance" "postgres" {
  count               = var.enable_cloud_sql ? 1 : 0
  project             = var.project_id
  name                = "${var.name_prefix}-postgres"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = true

  settings {
    tier              = var.sql_tier
    edition           = "ENTERPRISE"
    availability_type = var.sql_high_availability ? "REGIONAL" : "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = var.sql_disk_gb
    disk_autoresize   = true
    user_labels       = { app = "folioverse" }

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.network_id
      enable_private_path_for_google_cloud_services = true
      ssl_mode                                      = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "02:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = var.sql_backup_retention
      }
    }

    maintenance_window {
      day          = 7
      hour         = 3
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled  = true
      record_application_tags = false
      record_client_address   = false
    }

    database_flags {
      name  = "log_min_duration_statement"
      value = "1000"
    }
  }

  depends_on = [google_service_networking_connection.private_services]
}

resource "google_sql_database" "app" {
  count    = var.enable_cloud_sql ? 1 : 0
  project  = var.project_id
  instance = google_sql_database_instance.postgres[0].name
  name     = "folioverse"
}

resource "google_redis_instance" "cache" {
  count                   = var.enable_memorystore ? 1 : 0
  project                 = var.project_id
  name                    = "${var.name_prefix}-redis"
  region                  = var.region
  tier                    = var.redis_tier
  memory_size_gb          = var.redis_memory_gb
  redis_version           = "REDIS_7_2"
  authorized_network      = var.network_id
  connect_mode            = "PRIVATE_SERVICE_ACCESS"
  transit_encryption_mode = "DISABLED"
  labels                  = { app = "folioverse" }

  # BullMQ requires that keys are never evicted.
  redis_configs = {
    maxmemory-policy = "noeviction"
  }

  depends_on = [google_service_networking_connection.private_services]
}
