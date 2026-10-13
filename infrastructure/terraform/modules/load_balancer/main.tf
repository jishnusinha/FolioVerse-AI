# Global external HTTPS load balancer in front of Cloud Run: /api/* goes straight to api-http,
# everything else to web. Google-managed certificate for var.domain; HTTP redirects to HTTPS.

resource "google_compute_global_address" "lb" {
  project = var.project_id
  name    = "${var.name_prefix}-lb"
}

resource "google_compute_region_network_endpoint_group" "neg" {
  for_each              = { web = var.web_service, api = var.api_service }
  project               = var.project_id
  name                  = "${var.name_prefix}-${each.key}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = each.value
  }
}

resource "google_compute_backend_service" "backend" {
  for_each              = google_compute_region_network_endpoint_group.neg
  project               = var.project_id
  name                  = "${var.name_prefix}-${each.key}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  security_policy       = var.security_policy

  backend {
    group = each.value.id
  }

  log_config {
    enable      = true
    sample_rate = 0.2
  }
}

resource "google_compute_url_map" "https" {
  project         = var.project_id
  name            = "${var.name_prefix}-https"
  default_service = google_compute_backend_service.backend["web"].id

  host_rule {
    hosts        = [var.domain]
    path_matcher = "app"
  }

  path_matcher {
    name            = "app"
    default_service = google_compute_backend_service.backend["web"].id

    path_rule {
      paths   = ["/api", "/api/*"]
      service = google_compute_backend_service.backend["api"].id
    }
  }
}

resource "google_compute_managed_ssl_certificate" "cert" {
  project = var.project_id
  name    = "${var.name_prefix}-cert"

  managed {
    domains = [var.domain]
  }
}

resource "google_compute_target_https_proxy" "https" {
  project          = var.project_id
  name             = "${var.name_prefix}-https"
  url_map          = google_compute_url_map.https.id
  ssl_certificates = [google_compute_managed_ssl_certificate.cert.id]
}

resource "google_compute_global_forwarding_rule" "https" {
  project               = var.project_id
  name                  = "${var.name_prefix}-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.lb.id
  port_range            = "443"
  target                = google_compute_target_https_proxy.https.id
}

resource "google_compute_url_map" "redirect" {
  project = var.project_id
  name    = "${var.name_prefix}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  project = var.project_id
  name    = "${var.name_prefix}-http-redirect"
  url_map = google_compute_url_map.redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  project               = var.project_id
  name                  = "${var.name_prefix}-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.lb.id
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect.id
}
