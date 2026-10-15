#!/usr/bin/env bash
# Shared helpers for the FolioVerse AWS host scripts. Sourced, never executed directly.
# Nothing here prints secret values: secrets are only ever piped between processes or written to 0600 files.

set -Eeuo pipefail
umask 027

FV_ETC_DIR=${FV_ETC_DIR:-/etc/folioverse}
FV_HOME=${FV_HOME:-/opt/folioverse}
FV_DEPLOY_ENV=${FV_DEPLOY_ENV:-$FV_ETC_DIR/deploy.env}
FV_SECRETS_DIR="$FV_ETC_DIR/secrets"
FV_STATE_DIR=${FV_STATE_DIR:-/var/lib/folioverse}
FV_LOG_DIR=${FV_LOG_DIR:-/var/log/folioverse}
FV_LOCK_FILE=${FV_LOCK_FILE:-/run/lock/folioverse-deploy.lock}
FV_DATA_MARKER=.folioverse-data-volume
FV_PROJECT=folioverse
FV_APP_SERVICES=(ai-api ai-ingest api-http api-worker web edge)
FV_DATA_SERVICES=(postgres redis qdrant)
FV_DATA_SUBDIRS=(postgres redis qdrant qdrant-snapshots caddy/data caddy/config backups)

log() { printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${FV_SCRIPT:-folioverse}" "$*" >&2; }
die() {
  log "ERROR: $*"
  exit 1
}
require_root() { [ "$(id -u)" -eq 0 ] || die "run as root (sudo $0 ...)"; }

# Reads KEY=value lines (no shell evaluation, so values may contain spaces, <, >, $) and exports them.
# Surrounding single or double quotes are removed. Lines starting with # are comments.
read_env_file() {
  local file=$1 line key value
  local kv_re='^([A-Za-z_][A-Za-z0-9_]*)=(.*)$' sq_re="^'(.*)'$" dq_re='^"(.*)"$'
  [ -r "$file" ] || die "cannot read $file"
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    [[ $line =~ $kv_re ]] || die "$file: malformed line (expected KEY=value)"
    key=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]}
    if [[ $value =~ $sq_re || $value =~ $dq_re ]]; then value=${BASH_REMATCH[1]}; fi
    export "$key=$value"
  done <"$file"
}

# Loads /etc/folioverse/deploy.env and checks the settings every step needs.
load_deploy_env() {
  [ -f "$FV_DEPLOY_ENV" ] || die "$FV_DEPLOY_ENV is missing; run scripts/bootstrap-ec2.sh and edit it"
  read_env_file "$FV_DEPLOY_ENV"
  local k missing=()
  for k in AWS_REGION FV_ECR_REGISTRY FV_SECRET_ID FV_DOCUMENTS_BUCKET FV_DATA_DIR FV_DOMAIN FV_ACME_EMAIL; do
    if [ -z "${!k:-}" ] || [[ ${!k} == *"<"*">"* ]]; then missing+=("$k"); fi
  done
  [ ${#missing[@]} -eq 0 ] || die "$FV_DEPLOY_ENV: set ${missing[*]} (placeholders like <DOMAIN> are not values)"
  [[ $FV_ECR_REGISTRY =~ ^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com$ ]] || die "FV_ECR_REGISTRY must look like <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com"
  export AWS_DEFAULT_REGION=$AWS_REGION
}

# The data directory must be a mounted filesystem other than / and carry the marker written by
# prepare-data-volume.sh; otherwise Postgres/Redis/Qdrant would write to the root disk.
check_data_mount() {
  local dir=${FV_DATA_DIR:?} sub
  mountpoint -q "$dir" || die "$dir is not a mount point; attach and mount the EBS data volume (scripts/prepare-data-volume.sh)"
  [ "$(findmnt -no SOURCE --target "$dir")" != "$(findmnt -no SOURCE /)" ] || die "$dir is on the root filesystem"
  [ -f "$dir/$FV_DATA_MARKER" ] || die "$dir has no $FV_DATA_MARKER marker; run scripts/prepare-data-volume.sh"
  for sub in "${FV_DATA_SUBDIRS[@]}"; do
    [ -d "$dir/$sub" ] || die "$dir/$sub is missing; run scripts/prepare-data-volume.sh"
  done
}

# Resolves a release directory: explicit path, else the `current` pointer.
resolve_release() {
  local rel=${1:-}
  if [ -z "$rel" ]; then
    [ -L "$FV_HOME/current" ] || die "no release given and $FV_HOME/current does not exist"
    rel=$(readlink -f "$FV_HOME/current")
  fi
  rel=$(readlink -f "$rel")
  [ -f "$rel/compose.yml" ] || die "$rel/compose.yml not found"
  [ -f "$rel/release.env" ] || die "$rel/release.env not found"
  printf '%s\n' "$rel"
}

# Loads and validates a release manifest: immutable image references only.
load_release() {
  local rel=$1 k
  read_env_file "$rel/release.env"
  for k in FV_RELEASE_ID FV_API_IMAGE FV_AI_IMAGE FV_WEB_IMAGE; do
    [ -n "${!k:-}" ] || die "$rel/release.env: $k is missing"
  done
  [[ $FV_RELEASE_ID =~ ^[A-Za-z0-9._-]+$ ]] || die "FV_RELEASE_ID may only contain A-Z a-z 0-9 . _ -"
  for k in FV_API_IMAGE FV_AI_IMAGE FV_WEB_IMAGE; do
    [[ ${!k} =~ @sha256:[0-9a-f]{64}$ ]] || die "$k must be pinned by digest (repo@sha256:...), not a mutable tag"
    [[ ${!k} == "$FV_ECR_REGISTRY/"* ]] || die "$k is not in $FV_ECR_REGISTRY"
  done
}

compose() {
  docker compose --project-name "$FV_PROJECT" -f "$FV_RELEASE_DIR/compose.yml" \
    --env-file "$FV_DEPLOY_ENV" --env-file "$FV_RELEASE_DIR/release.env" "$@"
}

# Serializes deployments, rollbacks, backups and restores on this host.
acquire_lock() {
  mkdir -p "$(dirname "$FV_LOCK_FILE")"
  exec 9>"$FV_LOCK_FILE"
  flock -w "${FV_LOCK_WAIT:-1800}" 9 || die "another deployment, rollback or backup holds $FV_LOCK_FILE"
}

ecr_login() {
  aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$FV_ECR_REGISTRY" >/dev/null
  log "logged in to $FV_ECR_REGISTRY"
}

# IMDSv2 token from inside a container proves the instance role is reachable (needs hop limit >= 2).
check_container_imds() {
  docker run --rm --network bridge --entrypoint node "$FV_API_IMAGE" -e \
    "fetch('http://169.254.169.254/latest/api/token',{method:'PUT',headers:{'X-aws-ec2-metadata-token-ttl-seconds':'60'},signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" \
    || die "containers cannot reach the instance metadata service; set the IMDSv2 hop limit to 2 (see README, 'Instance metadata')"
  log "containers can reach IMDSv2 (instance-role credentials available to the S3 client)"
}

record() {
  mkdir -p "$FV_LOG_DIR"
  printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${FV_RELEASE_ID:-?}" "$*" >>"$FV_LOG_DIR/releases.log"
}
