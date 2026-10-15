#!/usr/bin/env bash
# Fetches the FolioVerse JSON secret (FV_SECRET_ID) from AWS Secrets Manager with the instance role and renders
# /etc/folioverse/secrets/{app,postgres,redis}.env (root-only, 0600) outside any release directory.
# The secret value only travels through a pipe; this script prints key names, never values.
# It never generates or changes secrets (see init-secrets.sh for the one-time initialization).
#
# EC2 Linux:  sudo /opt/folioverse/current/scripts/load-secrets.sh
FV_SCRIPT=load-secrets
. "$(dirname "$(readlink -f "$0")")/lib.sh"

require_root
load_deploy_env
install -d -m 0700 -o root -g root "$FV_SECRETS_DIR"

aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$FV_SECRET_ID" \
  --query SecretString --output text 2>"$FV_SECRETS_DIR/.aws-error" \
  | python3 "$(dirname "$(readlink -f "$0")")/render-secrets.py" --out-dir "$FV_SECRETS_DIR" --mail-enabled "${FV_MAIL_ENABLED:-false}" \
  || {
    # AWS CLI errors name the secret and the denied action, never its value.
    [ -s "$FV_SECRETS_DIR/.aws-error" ] && log "aws: $(tr '\n' ' ' <"$FV_SECRETS_DIR/.aws-error")"
    rm -f "$FV_SECRETS_DIR/.aws-error"
    die "could not load secret $FV_SECRET_ID (check the instance role's secretsmanager:GetSecretValue permission and the secret name)"
  }
rm -f "$FV_SECRETS_DIR/.aws-error"
chmod 0600 "$FV_SECRETS_DIR"/*.env
log "secrets rendered to $FV_SECRETS_DIR (values not shown)"
