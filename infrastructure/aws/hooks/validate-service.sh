#!/usr/bin/env bash
# CodeDeploy ValidateService: health of every service, both AI roles, the worker, HTTPS and the read-only smoke.
# A failure here fails the deployment; with automatic rollback enabled, CodeDeploy then redeploys the last
# successful revision (application images only; migrations are not reversed).
FV_SCRIPT=hook-validate
. "$(dirname "$(readlink -f "$0")")/../scripts/lib.sh"
require_root
REL=$(cat "$FV_STATE_DIR/deploying" 2>/dev/null) || die "AfterInstall did not record a release"
"$REL/scripts/validate.sh" --release "$REL"
rm -f "$FV_STATE_DIR/deploying"
