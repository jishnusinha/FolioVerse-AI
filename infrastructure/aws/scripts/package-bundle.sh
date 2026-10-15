#!/usr/bin/env bash
# Assembles the CodeDeploy bundle: appspec.yml at the root, Compose file, edge Caddyfile, config examples, host
# scripts, hooks, the read-only smoke test and (when given) the resolved release manifest. Contains no secrets.
#
#   CodeBuild / Linux:  infrastructure/aws/scripts/package-bundle.sh --out deploy-bundle [--release-env release.env]
set -Eeuo pipefail
OUT=""
RELEASE_ENV=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT=$2; shift 2 ;;
    --release-env) RELEASE_ENV=$2; shift 2 ;;
    *) echo "package-bundle: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$OUT" ] || { echo "usage: package-bundle.sh --out DIR [--release-env FILE]" >&2; exit 2; }
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
AWS_DIR="$ROOT/infrastructure/aws"
mkdir -p "$OUT"
case "$(cd "$OUT" && pwd)" in
  / | "$ROOT" | "$ROOT/infrastructure" | "$AWS_DIR" | "$AWS_DIR"/*) echo "package-bundle: refusing --out $OUT" >&2; exit 2 ;;
esac

rm -rf "$OUT"
mkdir -p "$OUT/config" "$OUT/smoke"
cp "$AWS_DIR/appspec.yml" "$AWS_DIR/compose.yml" "$AWS_DIR/Caddyfile" "$AWS_DIR/README.md" "$OUT/"
cp "$AWS_DIR"/config/*.example* "$OUT/config/"
cp -R "$AWS_DIR/scripts" "$AWS_DIR/hooks" "$OUT/"
cp "$ROOT/infrastructure/scripts/smoke-deployed.mjs" "$OUT/smoke/"
[ -z "$RELEASE_ENV" ] || cp "$RELEASE_ENV" "$OUT/release.env"
find "$OUT" -type f \( -name '*.sh' -o -name '*.py' \) -exec chmod 0755 {} +

# Defense in depth: a bundle must never carry environment or secret files.
if find "$OUT" -type f \( -name '.env' -o -name '*.pem' -o -name 'app.env' -o -name 'postgres.env' -o -name 'redis.env' -o -name 'deploy.env' \) | grep -q .; then
  echo "package-bundle: refusing to package an env or key file" >&2
  exit 1
fi
echo "package-bundle: $(find "$OUT" -type f | wc -l) files in $OUT"
