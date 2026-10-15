#!/usr/bin/env bash
# Logical backup to the private S3 bucket FV_BACKUP_BUCKET (instance role, server-side encryption):
#   postgres.dump        pg_dump custom format, checked with pg_restore --list before upload
#   qdrant/<c>.snapshot  one snapshot per Qdrant collection
#   redis.rdb            Redis snapshot (queues and rate limits only; usually not needed for a restore)
#   SHA256SUMS, manifest.txt
# Destination: s3://<FV_BACKUP_BUCKET>/folioverse/<UTC timestamp>/. Retention is the bucket's lifecycle rule.
# Runs nightly from folioverse-backup.timer (bootstrap-ec2.sh) and holds the deployment lock while it runs.
#
#   EC2 Linux:  sudo /opt/folioverse/current/scripts/backup.sh
FV_SCRIPT=backup
. "$(dirname "$(readlink -f "$0")")/lib.sh"

require_root
load_deploy_env
[ -n "${FV_BACKUP_BUCKET:-}" ] && [[ $FV_BACKUP_BUCKET != *"<"* ]] || die "FV_BACKUP_BUCKET is not set in $FV_DEPLOY_ENV"
check_data_mount
FV_RELEASE_DIR=$(resolve_release "")
load_release "$FV_RELEASE_DIR"
FV_LOCK_WAIT=3600 acquire_lock

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK="$FV_DATA_DIR/backups/$STAMP"
mkdir -p "$WORK/qdrant"
chmod 0700 "$WORK"

log "postgres: pg_dump"
compose exec -T postgres pg_dump -U folioverse -d folioverse -Fc >"$WORK/postgres.dump"
compose exec -T postgres pg_restore --list <"$WORK/postgres.dump" >/dev/null || die "pg_dump output is not a readable archive"

log "qdrant: collection snapshots"
# Qdrant is only reachable on the internal data network; a one-off AI container creates the snapshots, which land
# in FV_DATA_DIR/qdrant-snapshots on this host.
compose run --rm --no-deps -T ai-api python -c '
import json, sys, urllib.request as u
base = "http://qdrant:6333"
def call(method, path):
    req = u.Request(base + path, method=method)
    return json.load(u.urlopen(req, timeout=600))
names = [c["name"] for c in call("GET", "/collections")["result"]["collections"]]
for c in names:
    snap = call("POST", f"/collections/{c}/snapshots?wait=true")["result"]["name"]
    print(f"{c}\t{snap}")
' >"$WORK/qdrant/created.tsv"
while IFS=$'\t' read -r collection snapshot; do
  [ -n "$collection" ] || continue
  src="$FV_DATA_DIR/qdrant-snapshots/$collection/$snapshot"
  [ -s "$src" ] || die "qdrant snapshot $src not found"
  mv "$src" "$WORK/qdrant/$collection.snapshot"
  rm -f "$src.checksum"
  log "  $collection"
done <"$WORK/qdrant/created.tsv"
rm -f "$WORK/qdrant/created.tsv"

log "redis: BGSAVE"
redis_cli() { compose exec -T redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli "$@"' redis-cli "$@"; }
before=$(redis_cli LASTSAVE | tr -dc '0-9')
redis_cli BGSAVE >/dev/null
for _ in $(seq 1 60); do
  [ "$(redis_cli LASTSAVE | tr -dc '0-9')" != "$before" ] && break
  sleep 2
done
cp "$FV_DATA_DIR/redis/dump.rdb" "$WORK/redis.rdb" 2>/dev/null || log "  no dump.rdb yet (empty Redis); skipped"

{
  echo "created=$STAMP"
  echo "release=$FV_RELEASE_ID"
  echo "api_image=$FV_API_IMAGE"
  echo "postgres_image=postgres:16-alpine"
  echo "qdrant_image=qdrant/qdrant:v1.12.4"
} >"$WORK/manifest.txt"
(cd "$WORK" && find . -type f ! -name SHA256SUMS -printf '%P\n' | sort | xargs sha256sum >SHA256SUMS)

DEST="s3://$FV_BACKUP_BUCKET/folioverse/$STAMP/"
aws s3 cp "$WORK" "$DEST" --recursive --only-show-errors --sse AES256
log "uploaded $(du -sh "$WORK" | cut -f1) to $DEST"

# Keep the two newest local copies on the data volume.
ls -1dt "$FV_DATA_DIR"/backups/*/ 2>/dev/null | tail -n +3 | xargs -r rm -rf
record "backup $DEST"
