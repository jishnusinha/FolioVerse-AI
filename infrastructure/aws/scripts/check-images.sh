#!/usr/bin/env bash
# Runtime checks for freshly built images, run in CodeBuild before anything is pushed (also usable locally):
#   all  non-root user, linux/amd64
#   api  the exact runtime entry points used by compose.yml exist (main, worker, seed, prisma CLI)
#   ai   isolated import of folioverse_ai.serve and folioverse_ml without network; both embedding models load
#        offline from the baked cache on a read-only filesystem
#   web  the Caddyfile validates
#
#   CodeBuild / Linux:  infrastructure/aws/scripts/check-images.sh <api-image> <ai-image> <web-image>
set -Eeuo pipefail
API=$1 AI=$2 WEB=$3
HARD=(--rm --network none --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges)

for img in "$API" "$AI" "$WEB"; do
  user=$(docker image inspect -f '{{.Config.User}}' "$img")
  arch=$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$img")
  case "$user" in "" | root | 0 | 0:* | root:*) echo "check-images: $img runs as root" >&2; exit 1 ;; esac
  [ "$arch" = linux/amd64 ] || { echo "check-images: $img is $arch, expected linux/amd64" >&2; exit 1; }
  echo "ok   $img user=$user $arch"
done

docker run "${HARD[@]}" --entrypoint node "$API" -e \
  "const fs=require('fs');const need=['dist/src/main.js','dist/src/worker.js','dist/prisma/seed.js','node_modules/.bin/prisma','prisma/schema.prisma'];const miss=need.filter(p=>!fs.existsSync(p));if(miss.length){console.error('missing: '+miss.join(', '));process.exit(1)}"
# Same form as the compose `migrate` command: the image entrypoint execs pnpm's /bin/sh shim.
docker run "${HARD[@]}" "$API" node_modules/.bin/prisma --version >/dev/null 2>&1
echo "ok   api entry points: dist/src/main.js, dist/src/worker.js, dist/prisma/seed.js, prisma CLI"

docker run "${HARD[@]}" -w / --entrypoint python "$AI" -I -c "import folioverse_ai.serve, folioverse_ml"
echo "ok   ai isolated import (folioverse_ai.serve, folioverse_ml)"
docker run "${HARD[@]}" --entrypoint python "$AI" -I -c "
from fastembed import TextEmbedding, SparseTextEmbedding
assert len(list(TextEmbedding('BAAI/bge-small-en-v1.5').embed(['ok']))[0]) == 384
list(SparseTextEmbedding('Qdrant/bm25').embed(['ok']))
" 2>/dev/null
echo "ok   ai embedding models load offline"

docker run "${HARD[@]}" -e FV_TRUSTED_PROXIES=10.250.250.0/24 --entrypoint caddy "$WEB" validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1
echo "ok   web Caddyfile validates"
