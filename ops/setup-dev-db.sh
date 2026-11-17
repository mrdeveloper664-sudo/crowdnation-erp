#!/usr/bin/env bash
# One-time local/CI database setup (roles + databases as in README.md). Run as a PostgreSQL superuser:
#   sudo -u postgres ops/setup-dev-db.sh        (or: PSQL="psql -h localhost -U postgres" ops/setup-dev-db.sh)
# Dev-only passwords - change them for anything that is not a throw-away machine.
set -euo pipefail
PSQL=${PSQL:-psql}
$PSQL -v ON_ERROR_STOP=1 postgres <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nexerp') THEN CREATE ROLE nexerp LOGIN PASSWORD 'nexerp_pw' CREATEDB; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nexerp_app') THEN CREATE ROLE nexerp_app LOGIN PASSWORD 'nexerp_app_pw' NOSUPERUSER NOBYPASSRLS; END IF;
END $$;
SQL
for db in nexerp_dev nexerp_test; do
  $PSQL -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" postgres | grep -q 1 || $PSQL -c "CREATE DATABASE $db OWNER nexerp" postgres
done
echo "roles and databases ready; now: cd backend && npx prisma migrate deploy"
