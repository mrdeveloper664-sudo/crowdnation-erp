# NEXERP

Multi-company ERP, accounting-first (Tally Prime / Zoho Books style), UAE VAT aware.

| Part | Stack | State |
|---|---|---|
| `backend/` | NestJS, Prisma, PostgreSQL (RLS), JWT | complete for all phases; 24 unit + 92 e2e tests pass |
| `web/` | Next.js 15, React 19, Tailwind | ~60 pages, production build passes, 8 Playwright browser tests + smoke test |
| `mobile/` | Flutter, Provider, Dio, GoRouter | 25 tests pass, analyzer clean, **iOS build failed here, never run on a device** |
| `docs/` | | checklist, accounting rules, DB design, API, deployment, security |

**Not production-ready.** Read [docs/IMPLEMENTATION_CHECKLIST.md](docs/IMPLEMENTATION_CHECKLIST.md) (what is verified vs. not) and [docs/SECURITY.md](docs/SECURITY.md) first.

## Run locally
Requires Node 20+, PostgreSQL 16, (Flutter for mobile).
```bash
# 1. database (one-time) - or: sudo -u postgres ops/setup-dev-db.sh
psql postgres -c "CREATE ROLE nexerp LOGIN PASSWORD 'nexerp_pw' CREATEDB" -c "CREATE ROLE nexerp_app LOGIN PASSWORD 'nexerp_app_pw' NOSUPERUSER NOBYPASSRLS" -c "CREATE DATABASE nexerp_dev OWNER nexerp" -c "CREATE DATABASE nexerp_test OWNER nexerp"

# 2. backend  -> http://localhost:4000/api/docs
cd backend && npm install && cp .env.example .env
npx prisma migrate deploy && npm run db:seed && npm run start:dev

# 3. web (new terminal) -> http://localhost:3000
cd web && npm install && cp .env.example .env.local && npm run dev

# 4. mobile (new terminal)
cd mobile && flutter pub get && flutter run --dart-define=API_URL=http://localhost:4000/api/v1
```
Demo login: company `DEMO`, `admin@demo.test`, `Demo@12345678`.

## Tests
```bash
cd backend
DATABASE_URL=postgresql://nexerp:nexerp_pw@localhost:5432/nexerp_test DIRECT_DATABASE_URL=postgresql://nexerp:nexerp_pw@localhost:5432/nexerp_test npx prisma migrate deploy  # once
npm run test:unit && npm run test:e2e
cd ../web && npm run typecheck && npm test && npm run build
# browser tests (need `npm run build` in backend/ and web/ first; start the servers themselves; Chromium via `npx playwright install chromium` if missing)
npm run test:e2e
cd ../mobile && flutter analyze && flutter test
```
