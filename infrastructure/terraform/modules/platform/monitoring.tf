# Cloud Ops guardrails: uptime, error-rate and worker-down alerts, and a project budget.

resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email == "" ? 0 : 1
  project      = var.project_id
  display_name = "FolioVerse on-call (${var.environment})"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
}

locals {
  channels = google_monitoring_notification_channel.email[*].id
}

resource "google_monitoring_uptime_check_config" "web" {
  project      = var.project_id
  display_name = "${var.name_prefix}-web /healthz"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/healthz"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = trimprefix(local.url["web"], "https://")
    }
  }
}

resource "google_monitoring_alert_policy" "api_5xx" {
  project               = var.project_id
  display_name          = "${var.name_prefix}-api-http 5xx responses"
  combiner              = "OR"
  notification_channels = local.channels

  conditions {
    display_name = "5xx rate above 1 per minute for 5 minutes"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${var.name_prefix}-api-http\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  documentation {
    content   = "api-http is returning server errors. See infrastructure/runbooks/deploy.md (health checks, rollback)."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "worker_down" {
  project               = var.project_id
  display_name          = "${var.name_prefix}-api-worker has no running instance"
  combiner              = "OR"
  notification_channels = local.channels

  conditions {
    display_name = "No worker instance for 5 minutes"
    condition_absent {
      filter   = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${var.name_prefix}-api-worker\" AND metric.type = \"run.googleapis.com/container/instance_count\""
      duration = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MAX"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  documentation {
    content   = "Runs, ingestion and ledger settlement stop without the worker. See infrastructure/runbooks/deploy.md."
    mime_type = "text/markdown"
  }
}

resource "google_billing_budget" "project" {
  count           = var.billing_account == "" ? 0 : 1
  billing_account = var.billing_account
  display_name    = "FolioVerse ${var.environment} monthly budget"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  dynamic "all_updates_rule" {
    for_each = length(local.channels) > 0 ? [1] : []
    content {
      monitoring_notification_channels = local.channels
      disable_default_iam_recipients   = false
    }
  }
}
