#!/bin/bash
# Postgres custom-format dump + Qdrant collection snapshot, uploaded to GCS with the VM's
# service account. Mirrors infrastructure/scripts/backup.mjs (local) and is restored with
# infrastructure/runbooks/restore-backup.md.
set -euo pipefail
: "$FV_BACKUP_BUCKET" "$FV_QDRANT_COLLECTION"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DAY=$(date -u +%Y/%m/%d)
WORK=/mnt/disks/data/backups
TOKEN=$(curl -sf -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | sed -E 's/.*"access_token":"([^"]+)".*/\1/')

upload() {
  curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/octet-stream' \
    --data-binary "@$1" "https://storage.googleapis.com/upload/storage/v1/b/$FV_BACKUP_BUCKET/o?uploadType=media&name=$2" >/dev/null
  echo "uploaded gs://$FV_BACKUP_BUCKET/$2 ($(stat -c %s "$1") bytes)"
}

if [ "${FV_BACKUP_POSTGRES:-true}" = "true" ]; then
  docker exec fv-postgres pg_dump -U folioverse -d folioverse -Fc > "$WORK/postgres-$STAMP.dump"
  upload "$WORK/postgres-$STAMP.dump" "postgres/$DAY/postgres-$STAMP.dump"
fi

SNAP=$(curl -sf -X POST "http://127.0.0.1:6333/collections/$FV_QDRANT_COLLECTION/snapshots?wait=true" | sed -E 's/.*"name":"([^"]+)".*/\1/')
curl -sf -o "$WORK/qdrant-$STAMP.snapshot" "http://127.0.0.1:6333/collections/$FV_QDRANT_COLLECTION/snapshots/$SNAP"
upload "$WORK/qdrant-$STAMP.snapshot" "qdrant/$DAY/$FV_QDRANT_COLLECTION-$STAMP.snapshot"
curl -sf -X DELETE "http://127.0.0.1:6333/collections/$FV_QDRANT_COLLECTION/snapshots/$SNAP" >/dev/null

find "$WORK" -type f -mtime +2 -delete
