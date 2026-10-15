#!/usr/bin/env bash
# CodeDeploy BeforeInstall: the host must be bootstrapped and the EBS data volume mounted before files are copied.
FV_SCRIPT=hook-before-install
. "$(dirname "$(readlink -f "$0")")/../scripts/lib.sh"
require_root
load_deploy_env
check_data_mount
systemctl is-active --quiet docker || die "docker is not running"
install -d -m 0755 "$FV_HOME/staging" "$FV_HOME/releases"
log "host ready for deployment ${DEPLOYMENT_ID:-manual} (group ${DEPLOYMENT_GROUP_NAME:-n/a})"
