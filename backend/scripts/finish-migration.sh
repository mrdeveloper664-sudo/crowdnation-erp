#!/bin/sh
# usage: scripts/finish-migration.sh <migration-dir-name> [extra.sql]
# Appends RLS (+ optional extra SQL) to a freshly generated migration, then applies it to dev and test DBs.
set -e
cd "$(dirname "$0")/.."
M=prisma/migrations/$1/migration.sql
[ -n "$2" ] && cat "$2" >> "$M"
cat scripts/rls-snippet.sql >> "$M"
npx prisma migrate deploy 2>&1 | tail -3
DATABASE_URL=postgresql://nexerp:nexerp_pw@localhost:5432/nexerp_test DIRECT_DATABASE_URL=postgresql://nexerp:nexerp_pw@localhost:5432/nexerp_test npx prisma migrate deploy 2>&1 | tail -2
npx prisma generate 2>&1 | grep -E "Generated|rror"
