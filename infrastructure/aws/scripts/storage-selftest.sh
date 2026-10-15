#!/usr/bin/env bash
# End-to-end check of S3 document storage with the instance role, using the release's own images:
#   1. API image: streamed upload, head, download, Range read, multipart assembly, signed GET, delete
#   2. AI ingest image: downloads a signed internal GET URL with the ingestion pipeline's downloader
# Writes only under s3://<FV_DOCUMENTS_BUCKET>/_selftest/ and deletes what it wrote. The signed URL is passed
# through a pipe and never displayed.
#
#   EC2 Linux:  sudo /opt/folioverse/current/scripts/storage-selftest.sh
FV_SCRIPT=storage-selftest
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
. "$SCRIPT_DIR/lib.sh"

require_root
load_deploy_env
FV_RELEASE_DIR=$(resolve_release "")
load_release "$FV_RELEASE_DIR"
JS="$SCRIPT_DIR/storage-selftest.cjs"
run_api() { compose run --rm --no-deps -T -e "FV_SELFTEST_MODE=$1" ${2:+-e "FV_SELFTEST_KEY=$2"} api-http node - <"$JS"; }

log "API storage operations against s3://$FV_DOCUMENTS_BUCKET"
run_api full

log "AI ingestion download through a signed internal GET URL"
prepared=$(run_api prepare)
key=$(printf '%s' "$prepared" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["key"])')
status=0
printf '%s' "$prepared" | compose run --rm --no-deps -T ai-ingest python -c '
import asyncio, hashlib, json, sys
from folioverse_ai.ingestion.pipeline import download
req = json.loads(sys.stdin.read())
data = asyncio.run(download(req["url"], 10 * 1024 * 1024))
assert hashlib.sha256(data).hexdigest() == req["sha256"], "checksum mismatch"
print("ok   ai-ingest downloaded %d bytes, checksum matches" % len(data), file=sys.stderr)
' || status=$?
run_api cleanup "$key"
[ "$status" -eq 0 ] || die "AI ingestion download failed"
log "storage self-test passed"
