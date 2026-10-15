#!/usr/bin/env bash
# Restore drill (non-destructive): downloads one backup from S3, verifies checksums, restores Postgres into a
# throwaway container and each Qdrant snapshot into a throwaway Qdrant, and prints row/point counts.
# The running stack is not touched. The full, destructive restore is a manual procedure (README, "Restore").
#
#   EC2 Linux:  sudo /opt/folioverse/current/scripts/restore-check.sh [--stamp <UTC timestamp>]   # default: newest
FV_SCRIPT=restore-check
. "$(dirname "$(readlink -f "$0")")/lib.sh"

STAMP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --stamp) STAMP=$2; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
require_root
load_deploy_env
check_data_mount
FV_RELEASE_DIR=$(resolve_release "")
load_release "$FV_RELEASE_DIR"
PREFIX="s3://$FV_BACKUP_BUCKET/folioverse/"
if [ -z "$STAMP" ]; then
  STAMP=$(aws s3 ls "$PREFIX" | awk '/PRE/ {print $2}' | tr -d / | sort | tail -n 1)
  [ -n "$STAMP" ] || die "no backups under $PREFIX"
fi
WORK=$(mktemp -d "$FV_DATA_DIR/backups/.drill-XXXXXX")
NET="fv-restore-drill-$$"
cleanup() {
  docker rm -f "$NET-pg" "$NET-qdrant" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

aws s3 cp "$PREFIX$STAMP/" "$WORK/" --recursive --only-show-errors
(cd "$WORK" && sha256sum --quiet -c SHA256SUMS) || die "checksum mismatch in backup $STAMP"
log "backup $STAMP downloaded, checksums ok"

docker network create --internal "$NET" >/dev/null
docker run -d --name "$NET-pg" --network "$NET" --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=folioverse \
  -e POSTGRES_DB=folioverse -e POSTGRES_PASSWORD=drill-only-not-a-secret postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$NET-pg" pg_isready -U folioverse -d folioverse >/dev/null 2>&1 && break; sleep 2; done
docker exec -i "$NET-pg" pg_restore -U folioverse -d folioverse --no-owner --exit-on-error <"$WORK/postgres.dump"
log "postgres restored into a scratch container; row counts:"
docker exec "$NET-pg" psql -U folioverse -d folioverse -At -F ' ' -c "
  select 'users', count(*) from app.users union all
  select 'workspaces', count(*) from app.workspaces union all
  select 'sources', count(*) from app.sources union all
  select 'source_versions', count(*) from app.source_versions union all
  select 'ai_runs', count(*) from app.ai_runs union all
  select 'cost_entries', count(*) from app.cost_entries" | sed 's/^/  /'

if compgen -G "$WORK/qdrant/*.snapshot" >/dev/null; then
  args=()
  for f in "$WORK"/qdrant/*.snapshot; do args+=(--snapshot "/snapshots/$(basename "$f"):$(basename "$f" .snapshot)"); done
  docker run -d --name "$NET-qdrant" --network "$NET" -v "$WORK/qdrant:/snapshots:ro" qdrant/qdrant:v1.12.4 \
    ./qdrant "${args[@]}" >/dev/null
  docker run --rm --network "$NET" --entrypoint python "$FV_AI_IMAGE" -c "
import json, time, urllib.request as u
base = 'http://$NET-qdrant:6333'
for _ in range(60):
    try:
        names = [c['name'] for c in json.load(u.urlopen(base + '/collections', timeout=3))['result']['collections']]
        break
    except Exception:
        time.sleep(2)
else:
    raise SystemExit('qdrant did not start')
for n in names:
    info = json.load(u.urlopen(f'{base}/collections/{n}', timeout=10))['result']
    print(f'  qdrant {n}: {info.get(\"points_count\")} points')
"
else
  log "no Qdrant snapshots in this backup"
fi
log "restore drill passed for backup $STAMP (nothing in the running stack was changed)"
