// End-to-end smoke test of the web tier against RUNNING servers.
//   WEB_URL=http://localhost:3000 SMOKE_COMPANY=DEMO SMOKE_EMAIL=admin@demo.test SMOKE_PASSWORD=... node scripts/smoke.mjs
import assert from 'node:assert/strict';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const creds = { companyCode: process.env.SMOKE_COMPANY ?? 'DEMO', email: process.env.SMOKE_EMAIL ?? 'admin@demo.test', password: process.env.SMOKE_PASSWORD ?? 'Demo@12345678' };
let passed = 0;
async function check(name, fn) { try { await fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n      ', e.message); process.exitCode = 1; } }
const cookieOf = (res, name) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith(name + '='));

const login = await fetch(`${WEB}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(creds) });
const setCookies = login.headers.getSetCookie?.() ?? [];
const access = cookieOf(login, 'nx_access'), refresh = cookieOf(login, 'nx_refresh');
const cookie = [access, refresh].join('; ');

await check('unauthenticated visit to a protected page redirects to /login', async () => {
  const r = await fetch(`${WEB}/accounting/vouchers`, { redirect: 'manual' });
  assert.equal(r.status, 307); assert.match(r.headers.get('location'), /\/login$/);
});
await check('login proxy returns the user and sets httpOnly session cookies (no tokens in the body)', async () => {
  assert.equal(login.status, 200);
  const body = await login.json();
  assert.ok(body.data.user.email); assert.equal(body.data.accessToken, undefined); assert.equal(body.data.refreshToken, undefined);
  assert.ok(access && refresh);
  assert.ok(setCookies.every((c) => /HttpOnly/i.test(c) && /SameSite=lax/i.test(c)), 'cookies must be HttpOnly + SameSite=Lax');
});
await check('wrong password is rejected and sets no cookies', async () => {
  const r = await fetch(`${WEB}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...creds, password: 'Wrong-password-1' }) });
  assert.equal(r.status, 401); assert.equal((r.headers.getSetCookie?.() ?? []).length, 0);
});
await check('authenticated proxy call returns the session and permissions', async () => {
  const r = await fetch(`${WEB}/api/v1/auth/me`, { headers: { cookie } });
  const j = await r.json(); assert.equal(r.status, 200); assert.ok(j.data.permissions.includes('voucher:post'));
});
await check('proxy without a session gets 401', async () => { assert.equal((await fetch(`${WEB}/api/v1/auth/me`)).status, 401); });
await check('an expired access token is refreshed transparently and the cookies are rotated', async () => {
  await new Promise((r) => setTimeout(r, 1100)); // JWT iat has 1s resolution: guarantee a different token
  const r = await fetch(`${WEB}/api/v1/auth/me`, { headers: { cookie: ['nx_access=expired.invalid.token', refresh].join('; ') } });
  assert.equal(r.status, 200);
  assert.ok(cookieOf(r, 'nx_access') && cookieOf(r, 'nx_access') !== access, 'new access cookie issued');
  assert.ok(cookieOf(r, 'nx_refresh') && cookieOf(r, 'nx_refresh') !== refresh, 'refresh token rotated');
  // the old refresh token must now be dead (rotation + reuse detection)
  const again = await fetch(`${WEB}/api/v1/auth/me`, { headers: { cookie: ['nx_access=expired.invalid.token', refresh].join('; ') } });
  assert.equal(again.status, 401);
});
await check('public auth proxy only forwards the allow-listed endpoints', async () => {
  assert.equal((await fetch(`${WEB}/api/public/login`, { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await fetch(`${WEB}/api/public/../v1/users`, { method: 'POST', body: '{}' })).status, 404);
});
await check('reports export streams real files through the proxy', async () => {
  const fresh = await (await fetch(`${WEB}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(creds) }));
  const c2 = [cookieOf(fresh, 'nx_access'), cookieOf(fresh, 'nx_refresh')].join('; ');
  const pdf = await fetch(`${WEB}/api/v1/reports/run/trial-balance?format=pdf`, { headers: { cookie: c2 } });
  assert.equal(pdf.status, 200); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const xlsx = await fetch(`${WEB}/api/v1/reports/run/trial-balance?format=xlsx`, { headers: { cookie: c2 } });
  assert.equal(Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  globalThis.__cookie = c2;
});
const pages = ['/', '/accounting/chart', '/accounting/ledgers', '/accounting/vouchers', '/accounting/vouchers/new', '/accounting/opening-balances', '/accounting/periods', '/accounting/vat', '/sales/customers', '/sales/documents?type=INVOICE', '/sales/documents/new?type=INVOICE', '/sales/receipts', '/sales/recurring', '/purchases/suppliers', '/purchases/documents?type=INVOICE', '/purchases/payments', '/inventory/products', '/inventory/stock', '/inventory/warehouses', '/crm/leads', '/crm/activities', '/hr/employees', '/hr/attendance', '/hr/leave', '/hr/payroll', '/projects', '/expenses', '/assets', '/reports', '/reports/trial-balance', '/reports/profit-and-loss', '/settings/company', '/settings/users', '/settings/branches', '/settings/audit'];
await check(`all ${pages.length} application pages render (HTTP 200, app shell present)`, async () => {
  for (const p of pages) { const r = await fetch(`${WEB}${p}`, { headers: { cookie: globalThis.__cookie ?? cookie } }); assert.equal(r.status, 200, `${p} -> ${r.status}`); const t = await r.text(); assert.ok(t.includes('<html'), `${p} has no html`); }
});
await check('security headers are present', async () => {
  const r = await fetch(`${WEB}/login`); assert.equal(r.headers.get('x-frame-options'), 'DENY'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});
console.log(`\n${passed} checks passed${process.exitCode ? ' - WITH FAILURES' : ''}`);
