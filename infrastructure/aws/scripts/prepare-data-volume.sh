#!/usr/bin/env bash
# Mounts the separately attached, encrypted EBS data volume for Postgres, Redis, Qdrant, Caddy certificates and
# local backup staging. Idempotent. It never formats a device that has a filesystem, partition table or any other
# signature, and it only formats a blank device when --format-blank-volume is given explicitly.
#
#   EC2 Linux:  sudo bash prepare-data-volume.sh --volume-id vol-0123456789abcdef0 [--mount /srv/folioverse-data]
#               sudo bash prepare-data-volume.sh --volume-id vol-0123... --format-blank-volume      # new, empty volume
#               sudo bash prepare-data-volume.sh --device /dev/nvme1n1 ...                         # by device path
#
# After mounting it writes /etc/fstab (by UUID, nofail) and a systemd drop-in so Docker starts only after the
# mount exists: if the volume is missing at boot, no container can write data to the root disk.
FV_SCRIPT=prepare-data-volume
. "$(dirname "$(readlink -f "$0")")/lib.sh"

VOLUME_ID=""
DEVICE=""
MOUNT=""
FORMAT=false
ADOPT=false
while [ $# -gt 0 ]; do
  case "$1" in
    --volume-id) VOLUME_ID=$2; shift 2 ;;
    --device) DEVICE=$2; shift 2 ;;
    --mount) MOUNT=$2; shift 2 ;;
    --format-blank-volume) FORMAT=true; shift ;;
    --adopt-existing-data) ADOPT=true; shift ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
require_root
if [ -z "$MOUNT" ] && [ -f "$FV_DEPLOY_ENV" ]; then
  read_env_file "$FV_DEPLOY_ENV"
  MOUNT=${FV_DATA_DIR:-}
fi
MOUNT=${MOUNT:-/srv/folioverse-data}
[[ $MOUNT == /* ]] && [ "$MOUNT" != / ] || die "--mount must be an absolute path other than /"

if [ -n "$VOLUME_ID" ]; then
  [[ $VOLUME_ID =~ ^vol-[0-9a-f]{8,17}$ ]] || die "--volume-id must look like vol-0123456789abcdef0"
  DEVICE=/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${VOLUME_ID/-/}
  for _ in $(seq 1 30); do [ -e "$DEVICE" ] && break; sleep 2; done
  [ -e "$DEVICE" ] || die "volume $VOLUME_ID is not attached to this instance ($DEVICE not found)"
fi
[ -n "$DEVICE" ] || die "pass --volume-id vol-... or --device /dev/..."
DEVICE=$(readlink -f "$DEVICE")
[ -b "$DEVICE" ] || die "$DEVICE is not a block device"

ROOT_DISK=$(lsblk -no PKNAME "$(findmnt -no SOURCE /)" 2>/dev/null || true)
[ "$(basename "$DEVICE")" != "$ROOT_DISK" ] || die "$DEVICE is the root disk"
[ -z "$(lsblk -no NAME "$DEVICE" | tail -n +2)" ] || die "$DEVICE has partitions; use a whole, unpartitioned EBS volume (nothing was changed)"
other_mount=$(findmnt -rno TARGET -S "$DEVICE" | grep -vx "$MOUNT" || true)
[ -z "$other_mount" ] || die "$DEVICE is already mounted at $other_mount"

FSTYPE=$(blkid -o value -s TYPE "$DEVICE" 2>/dev/null || true)
FORMATTED_NOW=false
if [ -z "$FSTYPE" ]; then
  if [ -n "$(wipefs --noheadings "$DEVICE" 2>/dev/null)" ]; then
    die "$DEVICE carries an unrecognised signature; refusing to format it (inspect with: wipefs $DEVICE)"
  fi
  $FORMAT || die "$DEVICE has no filesystem. If this is the new, empty FolioVerse data volume, re-run with --format-blank-volume (this creates ext4 on it)"
  log "formatting blank device $DEVICE as ext4 (label fvdata)"
  mkfs.ext4 -q -L fvdata "$DEVICE"
  FSTYPE=ext4
  FORMATTED_NOW=true
elif $FORMAT; then
  log "$DEVICE already has a $FSTYPE filesystem; --format-blank-volume ignored (existing data is kept)"
fi

UUID=$(blkid -o value -s UUID "$DEVICE")
[ -n "$UUID" ] || die "could not read the filesystem UUID of $DEVICE"
existing=$(awk -v m="$MOUNT" '$1 !~ /^#/ && $2 == m {print $1}' /etc/fstab)
if [ -z "$existing" ]; then
  cp /etc/fstab "/etc/fstab.bak.$(date -u +%Y%m%dT%H%M%SZ)"
  printf 'UUID=%s %s %s defaults,nofail,noatime,x-systemd.device-timeout=30s 0 2\n' "$UUID" "$MOUNT" "$FSTYPE" >>/etc/fstab
  log "added $MOUNT to /etc/fstab (UUID=$UUID)"
elif [ "$existing" != "UUID=$UUID" ]; then
  die "/etc/fstab already mounts $existing at $MOUNT; fix /etc/fstab by hand"
fi

if ! mountpoint -q "$MOUNT"; then
  install -d -m 0755 "$MOUNT"
  [ -z "$(ls -A "$MOUNT")" ] || die "$MOUNT is not empty on the root disk; move its contents away before mounting the volume"
  systemctl daemon-reload
  mount "$MOUNT"
fi
mountpoint -q "$MOUNT" || die "mounting $MOUNT failed"

if [ ! -f "$MOUNT/$FV_DATA_MARKER" ]; then
  contents=$(ls -A "$MOUNT" | grep -vx 'lost+found' || true)
  if [ -n "$contents" ] && ! $FORMATTED_NOW && ! $ADOPT; then
    die "$MOUNT already contains data but no $FV_DATA_MARKER marker. If it is FolioVerse data, re-run with --adopt-existing-data"
  fi
  printf 'FolioVerse data volume\nuuid=%s\ndevice=%s\nprepared=%s\n' "$UUID" "${VOLUME_ID:-$DEVICE}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$MOUNT/$FV_DATA_MARKER"
fi
for sub in "${FV_DATA_SUBDIRS[@]}"; do install -d -m 0750 "$MOUNT/$sub"; done
chmod 0755 "$MOUNT"

install -d /etc/systemd/system/docker.service.d
cat >/etc/systemd/system/docker.service.d/folioverse-data.conf <<EOF
# Written by prepare-data-volume.sh: Docker (and every FolioVerse container) starts only once the data volume is mounted.
[Unit]
RequiresMountsFor=$MOUNT
EOF
systemctl daemon-reload
log "data volume ready at $MOUNT ($FSTYPE, UUID=$UUID). Docker now requires this mount at boot."
log "EBS encryption is chosen when the volume is created; confirm 'Encrypted: Yes' for the volume in the EC2 console."
