#!/usr/bin/env bash
# Hourly SQLite backup -> S3. Run by deploy/systemd/hoang-nhat-backup.timer.
# Needs: docker, AWS CLI v2, and the EC2 instance role from deploy/aws/
# (no AWS keys on disk, in the repo or in the image).
set -euo pipefail

APP_DIR=${APP_DIR:-/srv/hoang-nhat/app}
DATA_DIR=${SCM_DATA_DIR:-/srv/hoang-nhat/data}
BUCKET=${SCM_BACKUP_BUCKET:?Set SCM_BACKUP_BUCKET}
DAILY_HOUR_UTC=${DAILY_HOUR_UTC:-19}   # 02:00 Vietnam time
KEEP_LOCAL_DAYS=${KEEP_LOCAL_DAYS:-3}

cd "$APP_DIR"
# VACUUM INTO inside the running app container: consistent while the app writes.
result=$(docker compose exec -T app node --disable-warning=ExperimentalWarning scripts/backup.mjs create /data/backups)
echo "$result"
name=$(basename "$(printf '%s' "$result" | sed -n 's/.*"backup":"\([^"]*\)".*/\1/p')")
[ -n "$name" ] || { echo "backup produced no file" >&2; exit 1; }
file="$DATA_DIR/backups/$name"

prefixes=(hourly)
[ "$(date -u +%H)" = "$DAILY_HOUR_UTC" ] && prefixes+=(daily)
for prefix in "${prefixes[@]}"; do
  aws s3 cp "$file" "s3://$BUCKET/$prefix/$name" --only-show-errors
  aws s3 cp "$file.sha256" "s3://$BUCKET/$prefix/$name.sha256" --only-show-errors
done
echo "uploaded $name to ${prefixes[*]}"

# Local copies are only a convenience; S3 is the backup of record.
find "$DATA_DIR/backups" -maxdepth 1 -name 'hoang-nhat-*.sqlite3.gz*' -mtime "+$KEEP_LOCAL_DAYS" -delete
