#!/usr/bin/env bash
# Runs every time the Codespace starts: API on :4000, web on :3000.
cd "$(dirname "$0")/.."
(cd backend && nohup npm run start:prod > /tmp/nexerp-api.log 2>&1 &)
(cd web && nohup npm run dev > /tmp/nexerp-web.log 2>&1 &)
echo "NEXERP starting: web http://localhost:3000, API docs http://localhost:4000/api/docs (logs: /tmp/nexerp-*.log)"
