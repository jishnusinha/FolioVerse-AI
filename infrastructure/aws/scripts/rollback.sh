#!/usr/bin/env bash
# Application rollback: starts the previous release's images again. Migrations are NOT run and NOT reversed;
# the database keeps the newer schema, which is why every migration must stay compatible with the previous release
# (expand/contract, infrastructure/runbooks/deploy.md). If a migration damaged data, restore a backup instead.
#
#   EC2 Linux:  sudo /opt/folioverse/current/scripts/rollback.sh [--to /opt/folioverse/releases/<RELEASE_ID>]
FV_SCRIPT=rollback
. "$(dirname "$(readlink -f "$0")")/lib.sh"

TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --to) TARGET=$2; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
require_root
if [ -z "$TARGET" ]; then
  [ -L "$FV_HOME/previous" ] || die "no previous release is recorded; pass --to /opt/folioverse/releases/<RELEASE_ID>"
  TARGET=$(readlink -f "$FV_HOME/previous")
fi
[ -x "$TARGET/scripts/deploy.sh" ] || die "$TARGET is not a staged release"
log "rolling back to $(basename "$TARGET") (no migrations are run or reversed)"
exec "$TARGET/scripts/deploy.sh" --release "$TARGET" --skip-migrations preflight secrets pull app promote validate
