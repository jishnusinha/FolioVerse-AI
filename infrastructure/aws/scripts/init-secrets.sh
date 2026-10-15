#!/usr/bin/env bash
# One-time, explicit initialization of the FolioVerse Secrets Manager JSON secret. Run in AWS CloudShell as an
# administrator (the EC2 instance role can only read the secret).
#
#   AWS CloudShell:  bash init-secrets.sh --secret-id folioverse/staging/app --region ap-south-1 [--kms-key-id <KEY_ARN>]
#
# - Creates the secret if it does not exist, with freshly generated required keys.
# - If it exists, adds only required keys that are missing. Existing values are never replaced or regenerated,
#   so database passwords and signing keys stay stable across deployments.
# - Generated values are never printed; temporary files live in a 0700 directory that is removed on exit.
# Needs: aws CLI v2, openssl, python3 (all present in CloudShell).
set -Eeuo pipefail
umask 077

SECRET_ID=""
REGION=${AWS_REGION:-}
KMS_KEY_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --secret-id) SECRET_ID=$2; shift 2 ;;
    --region) REGION=$2; shift 2 ;;
    --kms-key-id) KMS_KEY_ID=$2; shift 2 ;;
    -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "init-secrets: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$SECRET_ID" ] && [ -n "$REGION" ] || { echo "usage: init-secrets.sh --secret-id NAME --region REGION [--kms-key-id KEY]" >&2; exit 2; }
for bin in aws openssl python3; do command -v "$bin" >/dev/null || { echo "init-secrets: $bin is required" >&2; exit 1; }; done

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

exists=false
if aws secretsmanager describe-secret --region "$REGION" --secret-id "$SECRET_ID" >/dev/null 2>"$WORK/describe.err"; then
  exists=true
elif ! grep -q ResourceNotFoundException "$WORK/describe.err"; then
  cat "$WORK/describe.err" >&2
  exit 1
fi

echo '{}' >"$WORK/current.json"
if $exists; then
  # A secret created in the console without a value has no AWSCURRENT version yet.
  if ! aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET_ID" \
    --query SecretString --output text >"$WORK/current.json" 2>"$WORK/get.err"; then
    grep -q ResourceNotFoundException "$WORK/get.err" || { cat "$WORK/get.err" >&2; exit 1; }
    echo '{}' >"$WORK/current.json"
  fi
fi

openssl rand -hex 24 >"$WORK/POSTGRES_PASSWORD"
openssl rand -hex 24 >"$WORK/REDIS_PASSWORD"
openssl rand -hex 32 >"$WORK/FV_JWT_SECRET"
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$WORK/FV_INTERNAL_JWT_PRIVATE_KEY" 2>/dev/null
openssl pkey -in "$WORK/FV_INTERNAL_JWT_PRIVATE_KEY" -pubout -out "$WORK/FV_INTERNAL_JWT_PUBLIC_KEY" 2>/dev/null

python3 - "$WORK" <<'PY'
import json, os, sys
work = sys.argv[1]
with open(os.path.join(work, "current.json"), encoding="utf-8") as f:
    raw = f.read().strip() or "{}"
try:
    current = json.loads(raw)
except json.JSONDecodeError:
    sys.exit("init-secrets: the existing secret value is not JSON; fix it in the console (nothing was changed)")
if not isinstance(current, dict):
    sys.exit("init-secrets: the existing secret value must be a JSON object (nothing was changed)")

def generated(name):
    with open(os.path.join(work, name), encoding="utf-8") as f:
        return f.read().strip()

has = lambda k: isinstance(current.get(k), str) and current[k].strip() != ""
added = []
for key in ("POSTGRES_PASSWORD", "REDIS_PASSWORD", "FV_JWT_SECRET"):
    if not has(key):
        current[key] = generated(key)
        added.append(key)
pair = ("FV_INTERNAL_JWT_PRIVATE_KEY", "FV_INTERNAL_JWT_PUBLIC_KEY")
if has(pair[0]) != has(pair[1]):
    sys.exit("init-secrets: only one of the internal JWT keys exists; restore its partner or remove both (nothing was changed)")
if not has(pair[0]):
    for key in pair:
        current[key] = generated(key)
        added.append(key)

with open(os.path.join(work, "added"), "w", encoding="utf-8") as f:
    f.write(" ".join(added))
with open(os.path.join(work, "next.json"), "w", encoding="utf-8") as f:
    json.dump(current, f)
PY

added=$(cat "$WORK/added")
if $exists && [ -z "$added" ]; then
  echo "init-secrets: $SECRET_ID already has every required key; nothing changed"
  exit 0
fi

if $exists; then
  aws secretsmanager put-secret-value --region "$REGION" --secret-id "$SECRET_ID" \
    --secret-string "file://$WORK/next.json" >/dev/null
  echo "init-secrets: added $added to $SECRET_ID (values not shown)"
else
  kms=()
  [ -n "$KMS_KEY_ID" ] && kms=(--kms-key-id "$KMS_KEY_ID")
  arn=$(aws secretsmanager create-secret --region "$REGION" --name "$SECRET_ID" ${kms[@]+"${kms[@]}"} \
    --description "FolioVerse staging application secrets (JSON)" \
    --secret-string "file://$WORK/next.json" --query ARN --output text)
  echo "init-secrets: created $arn with $added (values not shown)"
  echo "init-secrets: use this ARN in infrastructure/aws/iam/ec2-instance-role-policy.json"
fi
