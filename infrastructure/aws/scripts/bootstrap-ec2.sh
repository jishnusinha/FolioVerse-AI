#!/usr/bin/env bash
# Idempotent host setup for the FolioVerse staging server (Ubuntu 22.04 LTS, x86_64). Safe to re-run.
#
#   EC2 Linux:  sudo bash /tmp/fv-bundle/scripts/bootstrap-ec2.sh
#
# Installs or verifies: Docker Engine + Compose v2 (Docker's apt repository), bounded json-file logs, AWS CLI v2,
# Amazon SSM Agent, AWS CodeDeploy agent, python3. Creates /etc/folioverse (deploy.env from the example on first
# run), /opt/folioverse, /var/lib/folioverse, and the nightly backup timer. Verifies IMDSv2 and the instance role.
# Does not touch disks (prepare-data-volume.sh does), secrets or containers.
FV_SCRIPT=bootstrap
SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
BUNDLE_DIR=$(dirname "$SCRIPT_DIR")
. "$SCRIPT_DIR/lib.sh"
export DEBIAN_FRONTEND=noninteractive

require_root
. /etc/os-release
[ "$ID" = ubuntu ] && [ "$VERSION_ID" = "22.04" ] || die "Ubuntu 22.04 LTS is required (found $PRETTY_NAME)"
[ "$(uname -m)" = x86_64 ] || die "x86_64 is required (found $(uname -m))"

imds() {
  local token
  token=$(curl -sf -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' http://169.254.169.254/latest/api/token) || return 1
  curl -sf -H "X-aws-ec2-metadata-token: $token" "http://169.254.169.254/latest/$1"
}
REGION=$(imds meta-data/placement/region) || die "instance metadata (IMDSv2) is unreachable"

log "packages"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg unzip python3 ruby-full wget util-linux >/dev/null

if ! docker compose version >/dev/null 2>&1; then
  log "installing Docker Engine and Compose v2 from download.docker.com"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi

# Bounded container logs and live-restore (containers keep running while dockerd restarts). Existing keys are kept.
changed=$(python3 - <<'PY'
import json, os
path = "/etc/docker/daemon.json"
cfg = json.load(open(path)) if os.path.exists(path) else {}
want = {"log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "5"}, "live-restore": True}
new = {**cfg, **{k: v for k, v in want.items() if k not in cfg}}
if new != cfg:
    os.makedirs("/etc/docker", exist_ok=True)
    json.dump(new, open(path, "w"), indent=2)
    print("yes")
PY
)
systemctl enable --now docker >/dev/null 2>&1
[ "$changed" = yes ] && systemctl restart docker && log "updated /etc/docker/daemon.json"

if ! aws --version 2>&1 | grep -q '^aws-cli/2'; then
  log "installing AWS CLI v2"
  tmp=$(mktemp -d)
  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o "$tmp/awscliv2.zip"
  unzip -q "$tmp/awscliv2.zip" -d "$tmp"
  "$tmp/aws/install" --update >/dev/null
  rm -rf "$tmp"
fi

unit_exists() { systemctl cat "$1" >/dev/null 2>&1; }
# Ubuntu AMIs ship the SSM Agent as a snap.
SSM_UNIT=snap.amazon-ssm-agent.amazon-ssm-agent.service
if ! unit_exists "$SSM_UNIT" && ! unit_exists amazon-ssm-agent.service; then
  log "installing Amazon SSM Agent (snap)"
  snap install amazon-ssm-agent --classic >/dev/null
fi
unit_exists "$SSM_UNIT" || SSM_UNIT=amazon-ssm-agent.service
systemctl enable --now "$SSM_UNIT" >/dev/null 2>&1

if ! unit_exists codedeploy-agent.service; then
  log "installing AWS CodeDeploy agent for $REGION"
  tmp=$(mktemp -d)
  curl -fsSL "https://aws-codedeploy-$REGION.s3.$REGION.amazonaws.com/latest/install" -o "$tmp/install"
  chmod +x "$tmp/install"
  "$tmp/install" auto >/dev/null
  rm -rf "$tmp"
fi
systemctl enable --now codedeploy-agent >/dev/null 2>&1

log "directories"
install -d -m 0750 -o root -g root "$FV_ETC_DIR"
install -d -m 0700 -o root -g root "$FV_SECRETS_DIR"
install -d -m 0755 "$FV_HOME" "$FV_HOME/releases" "$FV_HOME/staging"
install -d -m 0750 "$FV_STATE_DIR" "$FV_LOG_DIR"
if [ ! -f "$FV_DEPLOY_ENV" ]; then
  install -m 0640 "$BUNDLE_DIR/config/deploy.env.example" "$FV_DEPLOY_ENV"
  sed -i "s/^AWS_REGION=.*/AWS_REGION=$REGION/" "$FV_DEPLOY_ENV"
  log "created $FV_DEPLOY_ENV from the example: edit the <PLACEHOLDERS> before deploying"
fi

log "backup timer"
cat >/etc/systemd/system/folioverse-backup.service <<'EOF'
[Unit]
Description=FolioVerse backup to S3 (Postgres, Qdrant, Redis)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/opt/folioverse/current/scripts/backup.sh
EOF
cat >/etc/systemd/system/folioverse-backup.timer <<'EOF'
[Unit]
Description=Nightly FolioVerse backup

[Timer]
OnCalendar=*-*-* 20:30:00 UTC
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
backup_bucket=$(awk -F= '$1=="FV_BACKUP_BUCKET"{print $2}' "$FV_DEPLOY_ENV" 2>/dev/null || true)
if [ -n "$backup_bucket" ] && [[ $backup_bucket != *"<"* ]]; then
  systemctl enable --now folioverse-backup.timer >/dev/null 2>&1
  backup_state="enabled (s3://$backup_bucket)"
else
  systemctl disable --now folioverse-backup.timer >/dev/null 2>&1 || true
  backup_state="disabled (set FV_BACKUP_BUCKET and re-run)"
fi

# ---- verification ----
FAIL=0
report() {
  if [ "$2" = ok ]; then printf '  %-34s ok  %s\n' "$1" "${3:-}"; else
    printf '  %-34s FAIL %s\n' "$1" "${3:-}"
    FAIL=1
  fi
}
echo
echo "FolioVerse host verification"
systemctl is-active --quiet docker && report "Docker Engine" ok "$(docker version --format '{{.Server.Version}}')" || report "Docker Engine" fail
docker compose version --short 2>/dev/null | grep -Eq '^v?2\.' && report "Docker Compose v2" ok "$(docker compose version --short)" || report "Docker Compose v2" fail
aws --version 2>&1 | grep -q '^aws-cli/2' && report "AWS CLI v2" ok "$(aws --version 2>&1 | cut -d' ' -f1)" || report "AWS CLI v2" fail
systemctl is-active --quiet "$SSM_UNIT" && report "SSM Agent" ok "$SSM_UNIT" || report "SSM Agent" fail
systemctl is-active --quiet codedeploy-agent && report "CodeDeploy agent" ok || report "CodeDeploy agent" fail
code=$(curl -s -o /dev/null -w '%{http_code}' http://169.254.169.254/latest/meta-data/ || true)
[ "$code" = 401 ] && report "IMDSv2 required (v1 disabled)" ok || report "IMDSv2 required (v1 disabled)" fail "IMDSv1 answered $code; set HttpTokens=required"
role=$(imds meta-data/iam/security-credentials/ || true)
[ -n "$role" ] && report "instance profile role" ok "$role" || report "instance profile role" fail "attach the FolioVerse instance profile"
if [ -n "$role" ]; then
  aws sts get-caller-identity --query Arn --output text >/dev/null 2>&1 && report "role credentials (STS)" ok || report "role credentials (STS)" fail
fi
data_dir=$(awk -F= '$1=="FV_DATA_DIR"{print $2}' "$FV_DEPLOY_ENV" 2>/dev/null || true)
data_dir=${data_dir:-/srv/folioverse-data}
if mountpoint -q "$data_dir" && [ -f "$data_dir/$FV_DATA_MARKER" ]; then report "EBS data volume" ok "$data_dir"; else
  report "EBS data volume" fail "not prepared yet: run scripts/prepare-data-volume.sh"
fi
printf '  %-34s %s\n' "nightly backup timer" "$backup_state"
echo "  Container access to the role also needs the metadata hop limit set to 2 (checked by deploy.sh pull)."
exit $FAIL
