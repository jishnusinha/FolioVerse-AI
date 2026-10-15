#!/usr/bin/env bash
# CodeDeploy AfterInstall: copy the installed bundle (/opt/folioverse/staging) to its release directory, then run
# the preflight, secrets and pull steps from there. Later hooks only use stable absolute paths.
FV_SCRIPT=hook-after-install
. "$(dirname "$(readlink -f "$0")")/../scripts/lib.sh"
require_root
install -d -m 0750 "$FV_STATE_DIR"
REL=$(bash "$FV_HOME/staging/scripts/stage-release.sh" --bundle "$FV_HOME/staging" | tail -n 1)
"$REL/scripts/deploy.sh" --release "$REL" preflight secrets pull
printf '%s\n' "$REL" >"$FV_STATE_DIR/deploying"
