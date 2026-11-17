import { defineConfig } from '@playwright/test';

/**
 * Browser tests against the REAL backend (PostgreSQL) and the BUILT web app.
 *   cd backend && npx prisma migrate deploy && npm run build     (once)
 *   cd web && npx next build && npm run test:e2e
 * Servers are started here unless already running (reuseExistingServer).
 * Ports: API 4100, web 3100 (override with E2E_API_PORT / E2E_WEB_PORT).
 * The backend uses the DATABASE_URL from backend/.env (a dev/test database - the tests
 * register their own throw-away company, so they never touch existing companies).
 */
const API_PORT = process.env.E2E_API_PORT ?? '4100';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '3100';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'off', screenshot: 'only-on-failure', acceptDownloads: true },
  webServer: [
    {
      command: 'node dist/main.js', cwd: '../backend', url: `http://localhost:${API_PORT}/api/docs`, reuseExistingServer: true, timeout: 60_000,
      env: { PORT: API_PORT, AUTH_RATE_LIMIT: '1000' },
    },
    {
      command: `npx next start -p ${WEB_PORT}`, url: `http://localhost:${WEB_PORT}/login`, reuseExistingServer: true, timeout: 60_000,
      env: { API_URL: `http://localhost:${API_PORT}/api/v1`, COOKIE_SECURE: 'false' },
    },
  ],
});
