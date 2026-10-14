#!/usr/bin/env bash
# Restore the SQLite database from a backup made by backup.sh.
#
#   deploy/restore.sh <file.sqlite3.gz | s3://bucket/prefix/file.sqlite3.gz>          # verify only
#   deploy/restore.sh <file.sqlite3.gz | s3://bucket/prefix/file.sqlite3.gz> --yes    # verify + replace
#
# The current database is never deleted: it is moved to
# $DATA_DIR/pre-restore-<UTC>/ before the restored file is put in place.
set -euo pipefail

APP_DIR=${APP_DIR:-/srv/hoang-nhat/app}
DATA_DIR=${SCM_DATA_DIR:-/srv/hoang-nhat/data}
SOURCE=${1:?Usage: restore.sh <backup.sqlite3.gz | s3://...> [--yes]}
CONFIRM=${2:-}
DB=hoang-nhat.sqlite3

cd "$APP_DIR"
work=$(mktemp -d "$DATA_DIR/.restore-XXXXXX")
trap 'rm -rf "$work"' EXIT
name=$(basename "$SOURCE")
if [[ "$SOURCE" == s3://* ]]; then
  aws s3 cp "$SOURCE" "$work/$name" --only-show-errors
  aws s3 cp "$SOURCE.sha256" "$work/$name.sha256" --only-show-errors
else
  cp "$SOURCE" "$SOURCE.sha256" "$work/"
fi
chown -R 1000:1000 "$work" 2>/dev/null || true

# Checksum, gunzip, PRAGMA integrity_check — in a throwaway app container.
docker compose run --rm --no-deps -v "$work:/restore" app \
  node --disable-warning=ExperimentalWarning scripts/backup.mjs extract "/restore/$name" "/restore/$DB"

if [ "$CONFIRM" != "--yes" ]; then
  echo "Backup verified. Nothing changed. Re-run with --yes to replace the live database."
  exit 0
fi

docker compose stop app
if ls "$DATA_DIR/$DB"* >/dev/null 2>&1; then
  aside="$DATA_DIR/pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$aside"
  mv "$DATA_DIR/$DB"* "$aside/"
  echo "previous database moved to $aside"
fi
mv "$work/$DB" "$DATA_DIR/$DB"
chown 1000:1000 "$DATA_DIR/$DB" 2>/dev/null || true
# A backup from an older release may need newer migrations (never destructive).
docker compose run --rm --no-deps app node scripts/prisma.mjs migrate deploy
docker compose up -d app
for _ in $(seq 1 30); do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null || true)
  [ "$status" = healthy ] && { echo "restore complete, app healthy"; exit 0; }
  sleep 2
done
echo "app did not become healthy; check: docker compose logs app" >&2
exit 1
