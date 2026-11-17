#!/bin/sh
# Restore a backup into a (new, empty) database. Use a superuser / BYPASSRLS role (COPY into RLS-protected tables).
#   TARGET_URL=postgresql://owner:pw@host:5432/newdb ops/restore.sh backups/nexerp-XXXX.dump
# Run `npx prisma migrate deploy` afterwards only if the dump predates the latest migrations.
set -eu
: "${TARGET_URL:?set TARGET_URL}"
[ -f "${1:-}" ] || { echo "usage: restore.sh <dump file>"; exit 1; }
pg_restore --no-owner --role="${RESTORE_ROLE:-nexerp}" --dbname="$(printf '%s' "$TARGET_URL" | sed 's/?.*$//')" "$1"
echo "restored $1"
