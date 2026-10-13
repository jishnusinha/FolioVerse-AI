# Self-hosted data tier on one private VM: Postgres + Redis + Qdrant (lean), or Qdrant only
# (standard, where Cloud SQL and Memorystore take over). No external IP; reachable from the
# workload subnet only; SSH through IAP. Data lives on a separate persistent disk with daily
# snapshots, plus nightly logical backups to the backup bucket.

resource "google_service_account" "vm" {
  project      = var.project_id
  account_id   = "${var.name_prefix}-data-vm"
  display_name = "FolioVerse data VM"
}

resource "google_secret_manager_secret_iam_member" "postgres_password" {
  count     = var.run_postgres ? 1 : 0
  project   = var.project_id
  secret_id = var.postgres_password_secret
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.vm.member
}

resource "google_storage_bucket_iam_member" "backups_writer" {
  bucket = var.backup_bucket
  role   = "roles/storage.objectCreator"
  member = google_service_account.vm.member
}

resource "google_project_iam_member" "vm_telemetry" {
  for_each = toset(["roles/logging.logWriter", "roles/monitoring.metricWriter"])
  project  = var.project_id
  role     = each.value
  member   = google_service_account.vm.member
}

resource "google_compute_resource_policy" "daily_snapshot" {
  project = var.project_id
  name    = "${var.name_prefix}-data-daily"
  region  = var.region

  snapshot_schedule_policy {
    schedule {
      daily_schedule {
        days_in_cycle = 1
        start_time    = "03:00"
      }
    }
    retention_policy {
      max_retention_days    = var.snapshot_retention_days
      on_source_disk_delete = "KEEP_AUTO_SNAPSHOTS"
    }
    snapshot_properties {
      labels = { app = "folioverse" }
    }
  }
}

resource "google_compute_disk" "data" {
  project = var.project_id
  name    = "${var.name_prefix}-data"
  zone    = var.zone
  type    = "pd-balanced"
  size    = var.data_disk_gb
  labels  = { app = "folioverse" }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_disk_resource_policy_attachment" "data" {
  project = var.project_id
  name    = google_compute_resource_policy.daily_snapshot.name
  disk    = google_compute_disk.data.name
  zone    = var.zone
}

resource "google_compute_instance" "data" {
  project                   = var.project_id
  name                      = "${var.name_prefix}-data"
  zone                      = var.zone
  machine_type              = var.machine_type
  tags                      = ["fv-data"]
  labels                    = { app = "folioverse" }
  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = "cos-cloud/cos-stable"
      size  = 20
      type  = "pd-balanced"
    }
  }

  attached_disk {
    source      = google_compute_disk.data.id
    device_name = "data"
  }

  network_interface {
    subnetwork = var.subnet_id
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  service_account {
    email  = google_service_account.vm.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    enable-oslogin            = "TRUE"
    block-project-ssh-keys    = "TRUE"
    google-logging-enabled    = "true"
    google-monitoring-enabled = "true"
    startup-script = templatefile("${path.module}/startup.sh.tftpl", {
      project_id               = var.project_id
      run_postgres             = var.run_postgres
      run_redis                = var.run_redis
      postgres_password_secret = var.postgres_password_secret
      backup_bucket            = var.backup_bucket
      qdrant_collection        = var.qdrant_collection
      backup_script            = file("${path.module}/backup.sh")
    })
  }
}

resource "google_compute_firewall" "data_from_workloads" {
  project       = var.project_id
  name          = "${var.name_prefix}-allow-data-from-workloads"
  network       = var.network_id
  direction     = "INGRESS"
  source_ranges = [var.subnet_cidr]
  target_tags   = ["fv-data"]

  allow {
    protocol = "tcp"
    ports    = concat(var.run_postgres ? ["5432"] : [], var.run_redis ? ["6379"] : [], ["6333"])
  }
}
