#!/usr/bin/env bash
# One-command local setup + start for macOS / Linux (on Windows run it inside WSL).
#   ./ops/local-setup.sh            set everything up (safe to re-run), then start API :4000 and web :3000
#   CROWD_ADMIN_PASSWORD='...' ./ops/local-setup.sh   non-interactive (otherwise you are asked for the password)
# Requires: Node 20+, PostgreSQL 16 running locally. Everything stays on this computer.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

say "Checking requirements"
command -v node >/dev/null || die "Node.js is not installed (need 20+): https://nodejs.org"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Node 20 or newer is required (found $(node -v))"
command -v psql >/dev/null || die "PostgreSQL client (psql) not found. Install PostgreSQL 16: macOS 'brew install postgresql@16 && brew services start postgresql@16', Ubuntu 'sudo apt install postgresql-16'"

# find a way to run psql as a superuser
if psql postgres -tAc 'select 1' >/dev/null 2>&1; then PSQL="psql"
elif sudo -n -u postgres psql -tAc 'select 1' >/dev/null 2>&1 || (sudo -u postgres psql -tAc 'select 1' >/dev/null 2>&1); then PSQL="sudo -u postgres psql"
else die "Cannot connect to PostgreSQL as a superuser. Make sure PostgreSQL is running (macOS: brew services start postgresql@16; Linux: sudo systemctl start postgresql)."; fi

say "Creating database roles and databases (nexerp_dev, nexerp_test)"
PSQL="$PSQL" bash ops/setup-dev-db.sh

say "Backend: install, configure, migrate"
cd "$ROOT/backend"
[ -f .env ] || cp .env.example .env
[ -d node_modules ] || npm install
npx prisma migrate deploy

say "Creating the Crowd Nation company (company code CROWD)"
if [ -z "${CROWD_ADMIN_PASSWORD:-}" ]; then
  while true; do
    read -rsp "Choose an admin password (10+ chars, upper, lower, digit): " CROWD_ADMIN_PASSWORD; echo
    [[ ${#CROWD_ADMIN_PASSWORD} -ge 10 && $CROWD_ADMIN_PASSWORD =~ [a-z] && $CROWD_ADMIN_PASSWORD =~ [A-Z] && $CROWD_ADMIN_PASSWORD =~ [0-9] ]] && break
    echo "Password does not meet the policy, try again."
  done
fi
export CROWD_ADMIN_PASSWORD
npm run --silent db:seed:crowdnation

say "Web: install and configure"
cd "$ROOT/web"
[ -f .env.local ] || cp .env.example .env.local
[ -d node_modules ] || npm install

say "Starting the ERP (press Ctrl+C to stop)"
cd "$ROOT/backend" && npm run start:dev > "$ROOT/.api.log" 2>&1 &
API_PID=$!
cd "$ROOT/web" && npm run dev > "$ROOT/.web.log" 2>&1 &
WEB_PID=$!
trap 'kill $API_PID $WEB_PID 2>/dev/null || true' EXIT INT TERM
printf '\n  Web:      http://localhost:3000\n  API docs: http://localhost:4000/api/docs\n  Login:    company CROWD, email admin@crowdnation.test, the password you chose\n  Logs:     %s/.api.log and %s/.web.log\n\n' "$ROOT" "$ROOT"
wait
