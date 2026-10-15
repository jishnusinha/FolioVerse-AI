#!/usr/bin/env bash
# Read-only diagnostics. Never prints environment variables or secrets (no `docker inspect` of Config.Env).
#
#   EC2 Linux:  sudo /opt/folioverse/current/scripts/diagnose.sh                 # overview
#               sudo /opt/folioverse/current/scripts/diagnose.sh api-http --lines 300
# Services: postgres redis qdrant api-http api-worker ai-api ai-ingest web edge
FV_SCRIPT=diagnose
. "$(dirname "$(readlink -f "$0")")/lib.sh"

SERVICE=""
LINES=100
while [ $# -gt 0 ]; do
  case "$1" in
    --lines) LINES=$2; shift 2 ;;
    -*) die "unknown option: $1" ;;
    *) SERVICE=$1; shift ;;
  esac
done
require_root
load_deploy_env
FV_RELEASE_DIR=$(resolve_release "")
load_release "$FV_RELEASE_DIR"

section() { printf '\n==== %s ====\n' "$*"; }

if [ -n "$SERVICE" ]; then
  section "$SERVICE: state and health"
  cid=$(compose ps -q "$SERVICE" || true)
  [ -n "$cid" ] || die "service $SERVICE has no container"
  docker inspect --format '{{.Name}} state={{.State.Status}} restarts={{.RestartCount}} started={{.State.StartedAt}} image={{.Config.Image}}' "$cid"
  docker inspect --format '{{if .State.Health}}{{range .State.Health.Log}}{{.End}} exit={{.ExitCode}} {{.Output}}{{end}}{{else}}no health check{{end}}' "$cid" | tail -n 5
  section "$SERVICE: last $LINES log lines"
  compose logs --no-color --timestamps --tail "$LINES" "$SERVICE"
  exit 0
fi

section "release"
echo "current:  $(readlink -f "$FV_HOME/current" 2>/dev/null || echo none)"
echo "previous: $(readlink -f "$FV_HOME/previous" 2>/dev/null || echo none)"
tail -n 15 "$FV_LOG_DIR/releases.log" 2>/dev/null || true

section "host"
uptime
free -m
df -h / "$FV_DATA_DIR" 2>/dev/null || true
if mountpoint -q "$FV_DATA_DIR"; then echo "data volume: mounted at $FV_DATA_DIR ($(findmnt -no SOURCE --target "$FV_DATA_DIR"))"; else echo "data volume: NOT MOUNTED at $FV_DATA_DIR"; fi
for unit in docker codedeploy-agent snap.amazon-ssm-agent.amazon-ssm-agent amazon-ssm-agent; do
  systemctl cat "$unit.service" >/dev/null 2>&1 && printf '%-45s %s\n' "$unit" "$(systemctl is-active "$unit" 2>/dev/null || true)"
done

section "containers"
compose ps --all --format 'table {{.Service}}\t{{.State}}\t{{.Health}}\t{{.Status}}'

section "recent errors (last 200 lines per application service)"
for s in "${FV_APP_SERVICES[@]}"; do
  n=$(compose logs --no-color --tail 200 "$s" 2>/dev/null | grep -Eci '"level":(50|60)|\b(error|fatal|traceback)\b' || true)
  printf '%-12s %s matching lines\n' "$s" "${n:-0}"
done

section "CodeDeploy agent (last 20 lines)"
tail -n 20 /var/log/aws/codedeploy-agent/codedeploy-agent.log 2>/dev/null || echo "no agent log"

echo
echo "Next: diagnose.sh <service> --lines 300; validate.sh; storage-selftest.sh"
