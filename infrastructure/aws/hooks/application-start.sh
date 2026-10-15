#!/usr/bin/env bash
# CodeDeploy ApplicationStart: data services, migrations, seed, then the application. A failed migration stops
# here, before any application container of the new release starts.
FV_SCRIPT=hook-application-start
. "$(dirname "$(readlink -f "$0")")/../scripts/lib.sh"
require_root
REL=$(cat "$FV_STATE_DIR/deploying" 2>/dev/null) || die "AfterInstall did not record a release"
"$REL/scripts/deploy.sh" --release "$REL" data migrate seed app promote
