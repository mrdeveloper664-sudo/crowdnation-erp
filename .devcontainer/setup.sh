#!/usr/bin/env bash
# Runs once when the Codespace / dev container is created.
set -euo pipefail
cd "$(dirname "$0")/.."
export PGPASSWORD=postgres
sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client openssl >/dev/null
until pg_isready -h db -U postgres >/dev/null 2>&1; do echo "waiting for postgres..."; sleep 2; done
PSQL="psql -h db -U postgres" bash ops/setup-dev-db.sh

cd backend
[ -f .env ] || sed -e 's/@localhost:/@db:/g' -e "s/^JWT_ACCESS_SECRET=.*/JWT_ACCESS_SECRET=\"$(openssl rand -hex 32)\"/" .env.example > .env
npm ci
npx prisma migrate deploy
# Creates the Crowd Nation company; the generated admin password is printed once below (or set CROWD_ADMIN_PASSWORD as a Codespaces secret).
npm run db:seed:crowdnation
npm run build

cd ../web
[ -f .env.local ] || cp .env.example .env.local
npm ci
