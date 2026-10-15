#!/usr/bin/env bash
# Fills <PLACEHOLDER> tokens in the IAM / CI/CD JSON templates from environment variables of the same name and
# writes the results to OUT_DIR. Fails if a template still contains an unset placeholder. Prints file names only.
#
#   AWS CloudShell:  export ACCOUNT_ID=... REGION=... ; bash scripts/render-templates.sh rendered iam/*.json cicd/*.json
set -Eeuo pipefail
[ $# -ge 2 ] || { echo "usage: render-templates.sh OUT_DIR TEMPLATE..." >&2; exit 2; }
OUT=$1
shift
mkdir -p "$OUT"
status=0
for tpl in "$@"; do
  content=$(sed 's/\r$//' "$tpl")
  for name in $(grep -o '<[A-Z][A-Z0-9_]*>' <<<"$content" | tr -d '<>' | sort -u); do
    value=${!name-}
    if [ -z "$value" ]; then
      echo "render-templates: $(basename "$tpl"): $name is not set" >&2
      status=1
      continue
    fi
    [[ $value != *'|'* && $value != *'\'* && $value != *'&'* ]] || { echo "render-templates: $name contains | \\ or &" >&2; exit 2; }
    content=$(sed "s|<$name>|$value|g" <<<"$content")
  done
  printf '%s\n' "$content" >"$OUT/$(basename "$tpl")"
  python3 -m json.tool "$OUT/$(basename "$tpl")" >/dev/null || { echo "render-templates: $(basename "$tpl") is not valid JSON" >&2; status=1; }
  echo "rendered $OUT/$(basename "$tpl")"
done
exit $status
