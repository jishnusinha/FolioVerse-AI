#!/usr/bin/env bash
# Deploys one FolioVerse release on this EC2 host. Used for the manual first deployment and by the CodeDeploy hooks.
#
#   EC2 Linux:  sudo /opt/folioverse/releases/<RELEASE_ID>/scripts/deploy.sh [--release DIR] [--skip-migrations] STEP...
#
# Steps (run in the order given; `all` = the full sequence):
#   preflight  deploy.env, EBS data mount, Docker, release manifest pinned by digest
#   secrets    render /etc/folioverse/secrets/*.env from Secrets Manager (Compose needs them to load the project)
#   pull       validate the Compose project, ECR login (instance role), image pull, metadata reachability
#   data       start Postgres, Redis, Qdrant and wait until healthy
#   migrate    prisma migrate deploy (one-off container); records success for this release
#   seed       idempotent seed (model registry; DEMO catalog only when FV_DEMO_CATALOG=true)
#   app        start ai-api, ai-ingest, api-http, api-worker, web, edge; refuses if this release's migrations
#              have not succeeded
#   promote    point /opt/folioverse/current at this release and keep the old one as `previous`
#   validate   scripts/validate.sh
# The whole run holds /run/lock/folioverse-deploy.lock, so deployments, rollbacks and backups never overlap.
# Volumes are never removed: no step runs `down -v` or `docker volume rm`.
FV_SCRIPT=deploy
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
. "$SCRIPT_DIR/lib.sh"

RELEASE_ARG=""
SKIP_MIGRATIONS=false
STEPS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE_ARG=$2; shift 2 ;;
    --skip-migrations) SKIP_MIGRATIONS=true; shift ;;
    -h | --help) sed -n '2,22p' "$0"; exit 0 ;;
    all) STEPS+=(preflight secrets pull data migrate seed app promote validate); shift ;;
    preflight | secrets | pull | data | migrate | seed | app | promote | validate) STEPS+=("$1"); shift ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done
[ ${#STEPS[@]} -gt 0 ] || die "no step given (see --help)"

require_root
load_deploy_env
FV_RELEASE_DIR=$(resolve_release "${RELEASE_ARG:-$(dirname "$SCRIPT_DIR")}")
load_release "$FV_RELEASE_DIR"
export FV_RELEASE_DIR
MIGRATED_MARK="$FV_STATE_DIR/migrated/$FV_RELEASE_ID"
acquire_lock
trap 'record "FAILED during ${CURRENT_STEP:-startup}"; log "FAILED during ${CURRENT_STEP:-startup} (release $FV_RELEASE_ID)"' ERR

step_preflight() {
  check_data_mount
  systemctl is-active --quiet docker || die "docker is not running"
  docker compose version --short | grep -Eq '^v?2\.' || die "Docker Compose v2 is required"
  [ -s "$FV_RELEASE_DIR/Caddyfile" ] || die "$FV_RELEASE_DIR/Caddyfile is missing"
  log "preflight ok: release $FV_RELEASE_ID, data volume $FV_DATA_DIR"
}

step_pull() {
  compose config --quiet
  ecr_login
  compose --profile ops pull --quiet
  check_container_imds
  log "images pulled"
}

step_secrets() { "$SCRIPT_DIR/load-secrets.sh"; }

step_data() {
  compose up -d --wait --wait-timeout 300 "${FV_DATA_SERVICES[@]}"
  log "data services healthy"
}

step_migrate() {
  if $SKIP_MIGRATIONS; then
    log "migrations skipped (--skip-migrations)"
    return
  fi
  rm -f "$MIGRATED_MARK"
  compose --profile ops run --rm migrate
  mkdir -p "$(dirname "$MIGRATED_MARK")"
  date -u +%Y-%m-%dT%H:%M:%SZ >"$MIGRATED_MARK"
  record "migrations applied"
  log "migrations applied"
}

step_seed() {
  compose --profile ops run --rm seed
  log "seed done"
}

step_app() {
  [ -f "$MIGRATED_MARK" ] || die "migrations have not succeeded for release $FV_RELEASE_ID; refusing to start the application (run the migrate step)"
  compose up -d --wait --wait-timeout 900 --remove-orphans "${FV_APP_SERVICES[@]}"
  log "application services healthy"
}

step_promote() {
  local current=""
  [ -L "$FV_HOME/current" ] && current=$(readlink -f "$FV_HOME/current")
  if [ -n "$current" ] && [ "$current" != "$FV_RELEASE_DIR" ]; then
    ln -sfn "$current" "$FV_HOME/previous"
  fi
  ln -sfn "$FV_RELEASE_DIR" "$FV_HOME/current"
  record "promoted (api=$FV_API_IMAGE ai=$FV_AI_IMAGE web=$FV_WEB_IMAGE)"
  log "current -> $FV_RELEASE_DIR${current:+ (previous -> $current)}"
}

step_validate() { "$SCRIPT_DIR/validate.sh" --release "$FV_RELEASE_DIR"; }

for CURRENT_STEP in "${STEPS[@]}"; do
  log "== $CURRENT_STEP =="
  "step_$CURRENT_STEP"
done
record "ok: ${STEPS[*]}"
