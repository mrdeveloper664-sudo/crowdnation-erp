#!/bin/sh
# Database backup with retention and a restore check.
#   BACKUP_DATABASE_URL=postgresql://nexerp_backup:pw@host:5432/db  BACKUP_DIR=/var/backups/nexerp  KEEP_DAYS=14  ops/backup.sh
# The backup role needs BYPASSRLS + pg_read_all_data (row level security is FORCEd, so even the owner sees no rows).
# Schedule from cron, e.g.  15 1 * * * /opt/nexerp/ops/backup.sh >> /var/log/nexerp-backup.log 2>&1
# Ship $BACKUP_DIR to off-site storage (S3 / another region); a backup on the same disk is not a backup.
set -eu
: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL (role with BYPASSRLS, see backend/docker/init-roles.sql)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$BACKUP_DIR/nexerp-$STAMP.dump"
URL=$(printf '%s' "$BACKUP_DATABASE_URL" | sed 's/?.*$//')   # pg_dump does not accept ?schema=
pg_dump --format=custom --no-owner --file="$FILE" "$URL"
# verify the archive is readable and non-trivial before trusting it
pg_restore --list "$FILE" > /dev/null
TABLES=$(pg_restore --list "$FILE" | grep -c "TABLE DATA" || true)
[ "$TABLES" -gt 10 ] || { echo "backup looks empty ($TABLES tables)"; rm -f "$FILE"; exit 1; }
find "$BACKUP_DIR" -name 'nexerp-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1), $TABLES tables with data)"
