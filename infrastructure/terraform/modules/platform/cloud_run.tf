# Five Cloud Run services and the migrate job. Releases (.github/workflows/release.yml) roll out
# new images with gcloud, so Terraform owns the shape (scaling caps, identity, network, secrets)
# and ignores the image of the running revision.

locals {
  run_host = "${data.google_project.this.number}.${var.region}.run.app"
  # Cloud Run's deterministic service URLs, so services can reference each other without a cycle.
  url = { for s in ["web", "api-http", "api-worker", "ai-api", "ai-ingest"] : s => "https://${var.name_prefix}-${s}-${local.run_host}" }

  public_ingress = var.behind_load_balancer ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"

  shared_env = merge(var.plain_env, {
    NODE_ENV                    = "production"
    APP_ORIGIN                  = var.app_origin
    COOKIE_SECURE               = "true"
    FV_LAB_FAULTS               = "false"
    FV_DEMO_CATALOG             = "false"
    FV_AI_API_URL               = local.url["ai-api"]
    FV_AI_INGEST_URL            = local.url["ai-ingest"]
    STORAGE_BUCKET              = google_storage_bucket.uploads.name
    OTEL_EXPORTER_OTLP_ENDPOINT = var.otel_endpoint
  })

  services = {
    web = {
      sa       = "web", image = var.images.web, min = 0, max = var.max_instances.web, cpu = "1", memory = "512Mi"
      cpu_idle = true, concurrency = 200, timeout = "3600s", ingress = local.public_ingress, public = true
      health   = "/healthz", vpc = false, command = [], args = []
      env      = { FV_API_UPSTREAM = local.url["api-http"] }
      secrets  = []
    }
    api-http = {
      sa       = "api", image = var.images.api, min = 0, max = var.max_instances.api_http, cpu = "1", memory = "1Gi"
      cpu_idle = true, concurrency = 80, timeout = "3600s", ingress = local.public_ingress, public = true
      health   = "/api/live", vpc = true, command = ["node"], args = ["dist/src/main.js"]
      env      = merge(local.shared_env, { FV_SERVICE_NAME = "api-http", OTEL_SERVICE_NAME = "folioverse-api" })
      secrets  = local.api_secret_envs
    }
    api-worker = {
      sa       = "api", image = var.images.api, min = var.worker_min_instances, max = var.max_instances.api_worker, cpu = "1", memory = "1Gi"
      cpu_idle = false, concurrency = 10, timeout = "300s", ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY", public = false
      health   = "/live", vpc = true, command = ["node"], args = ["dist/src/worker.js"]
      env      = merge(local.shared_env, { FV_SERVICE_NAME = "api-worker", OTEL_SERVICE_NAME = "folioverse-api-worker", FV_WORKER_HEALTH_PORT = "8080" })
      secrets  = local.api_secret_envs
    }
    # AI services accept requests only from inside the VPC; every call also carries a signed
    # internal token checked by the service, so the network allowance is not the only control.
    ai-api = {
      sa       = "ai", image = var.images.ai, min = 0, max = var.max_instances.ai_api, cpu = "2", memory = "2Gi"
      cpu_idle = true, concurrency = 20, timeout = "900s", ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY", public = true
      health   = "/healthz", vpc = true, command = ["python"], args = ["-m", "folioverse_ai.serve"]
      env      = merge(local.shared_env, { ROLE = "api", FV_CHECKPOINTER = "postgres", FV_EMBEDDER = "fastembed" })
      secrets  = local.ai_secret_envs
    }
    ai-ingest = {
      sa       = "ai", image = var.images.ai, min = 0, max = var.max_instances.ai_ingest, cpu = "2", memory = "2Gi"
      cpu_idle = true, concurrency = 4, timeout = "900s", ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY", public = true
      health   = "/healthz", vpc = true, command = ["python"], args = ["-m", "folioverse_ai.serve"]
      env      = merge(local.shared_env, { ROLE = "ingest", FV_EMBEDDER = "fastembed" })
      secrets  = local.ai_secret_envs
    }
  }
}

resource "google_cloud_run_v2_service" "svc" {
  for_each            = local.services
  project             = var.project_id
  name                = "${var.name_prefix}-${each.key}"
  location            = var.region
  ingress             = each.value.ingress
  deletion_protection = var.deletion_protection
  labels              = local.labels

  template {
    service_account                  = google_service_account.runtime[each.value.sa].email
    timeout                          = each.value.timeout
    max_instance_request_concurrency = each.value.concurrency

    scaling {
      min_instance_count = each.value.min
      max_instance_count = each.value.max
    }

    dynamic "vpc_access" {
      for_each = each.value.vpc ? [1] : []
      content {
        egress = "ALL_TRAFFIC"
        network_interfaces {
          network    = var.network_id
          subnetwork = var.subnet_id
        }
      }
    }

    containers {
      image   = each.value.image
      command = length(each.value.command) > 0 ? each.value.command : null
      args    = length(each.value.args) > 0 ? each.value.args : null

      ports {
        container_port = 8080
      }

      resources {
        limits            = { cpu = each.value.cpu, memory = each.value.memory }
        cpu_idle          = each.value.cpu_idle
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = { for k, v in each.value.env : k => v if v != "" }
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = toset(each.value.secrets)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        initial_delay_seconds = 0
        period_seconds        = 5
        timeout_seconds       = 3
        failure_threshold     = 24
        http_get {
          path = each.value.health
        }
      }

      liveness_probe {
        period_seconds    = 30
        timeout_seconds   = 3
        failure_threshold = 3
        http_get {
          path = each.value.health
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].revision,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_secret_manager_secret_iam_member.api,
    google_secret_manager_secret_iam_member.ai,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = { for k, v in local.services : k => v if v.public }
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.svc[each.key].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Applies Prisma migrations, then the idempotent seed (model registry). Executed by the release
# workflow before traffic moves to new revisions.
resource "google_cloud_run_v2_job" "migrate" {
  project             = var.project_id
  name                = "${var.name_prefix}-migrate"
  location            = var.region
  deletion_protection = var.deletion_protection
  labels              = local.labels

  template {
    task_count = 1
    template {
      service_account = google_service_account.runtime["api"].email
      timeout         = "900s"
      max_retries     = 0

      vpc_access {
        egress = "ALL_TRAFFIC"
        network_interfaces {
          network    = var.network_id
          subnetwork = var.subnet_id
        }
      }

      containers {
        image   = var.images.api
        command = ["sh", "-c"]
        args    = ["node_modules/.bin/prisma migrate deploy && node dist/prisma/seed.js"]

        resources {
          limits = { cpu = "1", memory = "1Gi" }
        }

        dynamic "env" {
          for_each = { for k, v in local.shared_env : k => v if v != "" }
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "env" {
          for_each = toset(local.api_secret_envs)
          content {
            name = env.value
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.app[env.value].secret_id
                version = "latest"
              }
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_secret_manager_secret_iam_member.api]
}
