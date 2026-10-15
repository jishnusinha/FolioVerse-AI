#!/usr/bin/env bash
# Copies a deployment bundle into /opt/folioverse/releases/<RELEASE_ID> (a stable path that does not depend on a
# Git checkout) and prints that path. The bundle is either a CodeBuild artifact (it already contains release.env with
# image digests) or the infrastructure/aws directory uploaded by hand, in which case --tag resolves the ECR image
# tag of all three repositories to immutable digests.
#
#   EC2 Linux:  sudo bash /tmp/fv-bundle/scripts/stage-release.sh --bundle /tmp/fv-bundle [--tag <IMAGE_TAG>]
#
# Keeps the newest 5 releases plus `current` and `previous`. Never touches data or running containers.
FV_SCRIPT=stage-release
. "$(dirname "$(readlink -f "$0")")/lib.sh"

BUNDLE=""
TAG=""
REPO_PREFIX=${FV_ECR_REPO_PREFIX:-folioverse}
while [ $# -gt 0 ]; do
  case "$1" in
    --bundle) BUNDLE=$2; shift 2 ;;
    --tag) TAG=$2; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
require_root
[ -n "$BUNDLE" ] && [ -d "$BUNDLE" ] || die "usage: stage-release.sh --bundle DIR [--tag IMAGE_TAG]"
BUNDLE=$(readlink -f "$BUNDLE")
for f in compose.yml Caddyfile scripts/lib.sh scripts/deploy.sh smoke/smoke-deployed.mjs; do
  [ -f "$BUNDLE/$f" ] || die "bundle is incomplete: $f is missing"
done
load_deploy_env

WORK=$(mktemp -d "$FV_HOME/.stage-XXXXXX")
trap 'rm -rf "$WORK"' EXIT
cp -a "$BUNDLE/." "$WORK/"
# Bundles uploaded from Windows may carry CRLF line endings; the shell and Compose need LF.
find "$WORK" -type f \( -name '*.sh' -o -name '*.py' -o -name '*.env' -o -name '*.yml' -o -name 'Caddyfile' \) -exec sed -i 's/\r$//' {} +

if [ -n "$TAG" ]; then
  [[ $TAG =~ ^[A-Za-z0-9._-]+$ ]] || die "--tag may only contain A-Z a-z 0-9 . _ -"
  digest() {
    aws ecr describe-images --region "$AWS_REGION" --repository-name "$REPO_PREFIX/$1" --image-ids "imageTag=$TAG" \
      --query 'imageDetails[0].imageDigest' --output text
  }
  {
    echo "# Release manifest staged by stage-release.sh from ECR tag $TAG."
    echo "FV_RELEASE_ID=$TAG"
    echo "FV_GIT_COMMIT=unknown"
    for s in api ai web; do
      d=$(digest "$s") || die "image $REPO_PREFIX/$s:$TAG not found in ECR"
      [[ $d =~ ^sha256:[0-9a-f]{64}$ ]] || die "image $REPO_PREFIX/$s:$TAG has no digest"
      printf 'FV_%s_IMAGE=%s/%s/%s@%s\n' "${s^^}" "$FV_ECR_REGISTRY" "$REPO_PREFIX" "$s" "$d"
    done
  } >"$WORK/release.env"
fi
[ -f "$WORK/release.env" ] || die "the bundle has no release.env; pass --tag <IMAGE_TAG>"
load_release "$WORK"

acquire_lock
mkdir -p "$FV_HOME/releases"
DEST="$FV_HOME/releases/$FV_RELEASE_ID"
CURRENT=$([ -L "$FV_HOME/current" ] && readlink -f "$FV_HOME/current" || true)
if [ -d "$DEST" ]; then
  if [ "$DEST" = "$CURRENT" ] && ! diff -rq "$DEST" "$WORK" >/dev/null; then
    die "release $FV_RELEASE_ID is running and the new bundle differs; build a new release id instead"
  fi
  rm -rf "$DEST"
fi
mv "$WORK" "$DEST"
trap - EXIT
chown -R root:root "$DEST"
chmod -R go-w "$DEST"
find "$DEST" -name '*.sh' -exec chmod 0755 {} +

# Prune old releases (never current or previous).
PREVIOUS=$([ -L "$FV_HOME/previous" ] && readlink -f "$FV_HOME/previous" || true)
ls -1dt "$FV_HOME"/releases/*/ 2>/dev/null | sed 's:/$::' | tail -n +6 | while read -r old; do
  [ "$old" = "$CURRENT" ] || [ "$old" = "$PREVIOUS" ] || [ "$old" = "$DEST" ] || rm -rf "$old"
done

log "staged release $FV_RELEASE_ID"
printf '%s\n' "$DEST"
