#!/usr/bin/env bash
# Read-only validation of the running FolioVerse release. Creates no accounts or documents.
#
#   EC2 Linux:  sudo /opt/folioverse/current/scripts/validate.sh [--release DIR]
#
# 1. every service is running and healthy (Docker health checks)
# 2. API readiness (database, Redis, S3, AI), worker readiness (Redis queues), both AI roles (/healthz role, /readyz)
# 3. only ports 80 and 443 are published on the host
# 4. HTTPS from outside the Docker network: certificate valid, HTTP redirects to HTTPS
# 5. smoke-deployed.mjs --require-https (security headers, HSTS, Secure cookies, auth boundary, SSE 401) run with
#    Node from the API image, so the host needs no Node installation
# Does not take the deployment lock (deploy.sh calls it while holding the lock).
FV_SCRIPT=validate
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
. "$SCRIPT_DIR/lib.sh"

RELEASE_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE_ARG=$2; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
require_root
load_deploy_env
FV_RELEASE_DIR=$(resolve_release "${RELEASE_ARG:-$(dirname "$SCRIPT_DIR")}")
load_release "$FV_RELEASE_DIR"
FAILURES=()
check() {
  local label=$1
  shift
  if "$@"; then log "ok   $label"; else
    log "FAIL $label"
    FAILURES+=("$label")
  fi
}

services_healthy() {
  compose ps --all --format json | python3 -c '
import json, sys
expected = set(sys.argv[1:])
text = sys.stdin.read().strip()
rows = json.loads(text) if text.startswith("[") else [json.loads(l) for l in text.splitlines() if l.strip()]
seen = {}
for r in rows:
    seen[r["Service"]] = (r.get("State", ""), r.get("Health", ""))
bad = []
for s in sorted(expected):
    state, health = seen.get(s, ("missing", ""))
    if state != "running" or health not in ("healthy", ""):
        bad.append(f"{s}={state}/{health or 'no-healthcheck'}")
print("  " + (", ".join(bad) if bad else "all running and healthy"), file=sys.stderr)
sys.exit(1 if bad else 0)
' "${FV_DATA_SERVICES[@]}" "${FV_APP_SERVICES[@]}"
}

api_ready() {
  compose exec -T api-http node -e "fetch('http://127.0.0.1:3000/api/ready').then(async r=>{const b=await r.json();console.error('  '+JSON.stringify(b.checks));process.exit(r.ok&&b.checks.aiService?0:1)},()=>process.exit(1))"
}

worker_ready() {
  compose exec -T api-worker node -e "fetch('http://127.0.0.1:3001/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
}

ai_role() {
  local service=$1 port=$2 role=$3
  compose exec -T "$service" python -c "
import json, sys, urllib.request as u
h = json.load(u.urlopen('http://127.0.0.1:$port/healthz', timeout=5))
try:
    r = u.urlopen('http://127.0.0.1:$port/readyz', timeout=8); ready = json.load(r)
except Exception as e:
    ready = {'status': 'unreachable', 'checks': getattr(e, 'code', str(type(e).__name__))}
print('  role=%s %s' % (h.get('role'), ready.get('checks')), file=sys.stderr)
sys.exit(0 if h.get('role') == '$role' and ready.get('status') == 'ready' else 1)
"
}

only_edge_ports_published() {
  local published
  published=$(docker ps --format '{{.Names}} {{.Ports}}' | grep -Eo '(0\.0\.0\.0|\[::\]|::):[0-9]+' | sed -E 's/.*:([0-9]+)$/\1/' | sort -u | tr '\n' ' ')
  log "  published host ports: ${published:-none}"
  [ -z "$(printf '%s' "$published" | tr ' ' '\n' | grep -Ev '^(80|443)?$')" ]
}

https_reachable() {
  local i
  # A first deployment may need a minute or two for Let's Encrypt to issue the certificate.
  for i in $(seq 1 30); do
    if curl -fsS -o /dev/null --max-time 10 "https://$FV_DOMAIN/healthz"; then return 0; fi
    sleep 10
  done
  return 1
}

http_redirects() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$FV_DOMAIN/")
  log "  http:// -> $code"
  [[ $code =~ ^30[178]$ ]]
}

smoke_deployed() {
  docker run --rm --read-only --network bridge --user 1000:1000 \
    -v "$FV_RELEASE_DIR/smoke:/smoke:ro" --entrypoint node "$FV_API_IMAGE" \
    /smoke/smoke-deployed.mjs --base "https://$FV_DOMAIN" --require-https
}

check "services running and healthy" services_healthy
check "api readiness (database, redis, storage, AI)" api_ready
check "worker readiness" worker_ready
check "ai-api role and readiness" ai_role ai-api 8000 api
check "ai-ingest role and readiness" ai_role ai-ingest 8001 ingest
check "only ports 80 and 443 published" only_edge_ports_published
check "https://$FV_DOMAIN/healthz" https_reachable
check "HTTP redirects to HTTPS" http_redirects
check "deployed smoke (read-only)" smoke_deployed

if [ ${#FAILURES[@]} -gt 0 ]; then
  record "validation FAILED: ${FAILURES[*]}"
  die "validation failed: ${FAILURES[*]} (diagnose: scripts/diagnose.sh)"
fi
record "validation ok"
log "release $FV_RELEASE_ID validated"
