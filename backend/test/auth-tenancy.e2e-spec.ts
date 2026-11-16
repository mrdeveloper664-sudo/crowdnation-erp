import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { MailService } from '../src/common/mail.service';
import { PASSWORD, Tenant, accountMap, api, createApp, registerAndLogin, today, uniq } from './helpers';

describe('Auth & tenant isolation (e2e)', () => {
  let app: INestApplication; let mail: MailService; let A: Tenant; let B: Tenant;

  beforeAll(async () => {
    ({ app, mail } = await createApp());
    A = await registerAndLogin(app, 'Company A');
    B = await registerAndLogin(app, 'Company B');
  });
  afterAll(async () => { await app.close(); });

  it('registers a company with default roles, chart of accounts and a financial year', async () => {
    const me = await api(app, A.token).get('/auth/me').expect(200);
    expect(me.body.data.company.code).toBe(A.code);
    expect(me.body.data.roles[0].name).toBe('Company Administrator');
    expect(me.body.data.permissions).toContain('voucher:post');
    const roles = await api(app, A.token).get('/roles').expect(200);
    expect(roles.body.data.map((r: any) => r.name)).toEqual(expect.arrayContaining(['Accountant', 'Finance Manager', 'Sales Manager', 'Purchase Manager', 'HR Manager', 'Employee', 'Viewer']));
    const fy = await api(app, A.token).get('/accounting/financial-years').expect(200);
    expect(fy.body.data[0].periods).toHaveLength(12);
  });

  it('rejects duplicate company codes and weak passwords', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register-company').send({ companyName: 'Dup', companyCode: A.code, adminName: 'Xavier', adminEmail: 'x@x.test', password: PASSWORD }).expect(409);
    await request(app.getHttpServer()).post('/api/v1/auth/register-company').send({ companyName: 'Weak', companyCode: uniq('W'), adminName: 'Xavier', adminEmail: 'w@x.test', password: 'weak' }).expect(400);
  });

  it('login is company specific: same email, wrong company code fails', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ companyCode: B.code, email: A.email, password: PASSWORD }).expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ companyCode: A.code, email: A.email, password: 'Wrong-password1' }).expect(401);
  });

  it('protects endpoints without a token', async () => {
    await request(app.getHttpServer()).get('/api/v1/vouchers').expect(401);
    await request(app.getHttpServer()).get('/api/v1/vouchers').set('Authorization', 'Bearer garbage').expect(401);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const r1 = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: A.refresh }).expect(200);
    const second = r1.body.data.refreshToken;
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: A.refresh }).expect(401); // replay
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: second }).expect(401); // family revoked
  });

  it('verifies email, resets password and invalidates sessions', async () => {
    const verify = mail.outbox.filter((m) => m.kind === 'verify' && m.to === B.email).pop()!;
    await request(app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token: verify.token }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token: verify.token }).expect(400); // single use
    await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ companyCode: B.code, email: B.email }).expect(200);
    const reset = mail.outbox.filter((m) => m.kind === 'reset' && m.to === B.email).pop()!;
    await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({ token: reset.token, newPassword: 'N3wStrongPassword' }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ companyCode: B.code, email: B.email, password: PASSWORD }).expect(401);
    const ok = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ companyCode: B.code, email: B.email, password: 'N3wStrongPassword' }).expect(200);
    B.token = ok.body.data.accessToken;
    // unknown account answers identically (no enumeration)
    const r = await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ companyCode: B.code, email: 'nobody@x.test' }).expect(200);
    expect(r.body.data.message).toMatch(/If the account exists/);
  });

  it('locks the account after repeated failed logins', async () => {
    const t = await registerAndLogin(app, 'Lock Co');
    for (let i = 0; i < 5; i++) await request(app.getHttpServer()).post('/api/v1/auth/login').send({ companyCode: t.code, email: t.email, password: 'Bad-password-1' }).expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ companyCode: t.code, email: t.email, password: PASSWORD }).expect(403);
  });

  it("company B cannot see or touch company A's data through the API", async () => {
    const accA = await accountMap(app, A.token);
    const v = await api(app, A.token).post('/vouchers').send({
      type: 'JOURNAL', date: today(), lines: [{ accountId: accA['5207'], debit: '10.00' }, { accountId: accA['1111'], credit: '10.00' }],
    }).expect(201);
    const id = v.body.data.id;
    await api(app, B.token).get(`/vouchers/${id}`).expect(404);
    await api(app, B.token).post(`/vouchers/${id}/post`).expect(404);
    const listB = await api(app, B.token).get('/vouchers').expect(200);
    expect(listB.body.data).toHaveLength(0);
    await api(app, B.token).get(`/ledgers/${accA['1111']}`).expect(404);
    // B using A's account in its own voucher is rejected
    const accB = await accountMap(app, B.token);
    await api(app, B.token).post('/vouchers').send({
      type: 'JOURNAL', date: today(), lines: [{ accountId: accA['5207'], debit: '1.00' }, { accountId: accB['1111'], credit: '1.00' }],
    }).expect(400);
  });

  it('Row Level Security blocks cross-tenant access even with raw SQL as the application role', async () => {
    const raw = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    try {
      // no tenant context -> nothing visible
      expect(await raw.account.count()).toBe(0);
      expect(await raw.user.count()).toBe(0);
      // tenant context for B -> only B rows
      const rows = await raw.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${B.companyId}, true)`;
        return tx.account.findMany({ select: { companyId: true } });
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.companyId))).toEqual(new Set([B.companyId]));
      // cannot insert a row for another company
      await expect(raw.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${B.companyId}, true)`;
        await tx.branch.create({ data: { companyId: A.companyId, code: 'X', name: 'Evil' } });
      })).rejects.toThrow();
    } finally { await raw.$disconnect(); }
  });

  it('enforces permissions: a Viewer can read but not create vouchers', async () => {
    const roles = await api(app, A.token).get('/roles').expect(200);
    const viewer = roles.body.data.find((r: any) => r.name === 'Viewer').id;
    const email = `viewer@${A.code.toLowerCase()}.test`;
    await api(app, A.token).post('/users/invitations').send({ email, roleId: viewer }).expect(201);
    const inv = mail.outbox.filter((m) => m.kind === 'invite' && m.to === email).pop()!;
    await request(app.getHttpServer()).post('/api/v1/auth/accept-invite').send({ token: inv.token, name: 'Vera Viewer', password: PASSWORD }).expect(200);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ companyCode: A.code, email, password: PASSWORD }).expect(200);
    const vt = login.body.data.accessToken;
    await api(app, vt).get('/vouchers').expect(200);
    const acc = await accountMap(app, A.token);
    await api(app, vt).post('/vouchers').send({ type: 'JOURNAL', date: today(), lines: [{ accountId: acc['5207'], debit: '1.00' }, { accountId: acc['1111'], credit: '1.00' }] }).expect(403);
    await api(app, vt).get('/users').expect(403);
    await api(app, vt).post('/accounting/periods/00000000-0000-0000-0000-000000000000/lock').expect(403);
  });
});
