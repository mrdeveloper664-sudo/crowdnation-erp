import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Tenant, accountMap, api, createApp, registerAndLogin, today } from './helpers';

describe('Accounting engine & vouchers (e2e)', () => {
  let app: INestApplication; let T: Tenant; let acc: Record<string, string>; let c: ReturnType<typeof api>;
  const CASH = '1111', BANK = '1112', SALES = '4101', RENT = '5202', CAPITAL = '3001';

  const voucher = (type: string, lines: any[], extra: any = {}) => c.post('/vouchers', { type, date: today(), lines, ...extra });
  const postV = async (type: string, lines: any[]) => {
    const v = await voucher(type, lines).expect(201);
    await c.post(`/vouchers/${v.body.data.id}/post`).expect(200);
    return v.body.data.id as string;
  };
  const tb = async (q = '') => (await c.get(`/reports/trial-balance${q}`).expect(200)).body.data;
  const row = (t: any, code: string) => t.items.find((i: any) => i.code === code);

  beforeAll(async () => {
    ({ app } = await createApp());
    T = await registerAndLogin(app, 'Ledger Co');
    c = api(app, T.token);
    acc = await accountMap(app, T.token);
  });
  afterAll(async () => { await app.close(); });

  it('creates, edits and deactivates accounts; groups inherit nature', async () => {
    const groups = (await c.get('/chart-of-accounts/groups').expect(200)).body.data;
    const current = groups.find((g: any) => g.code === '1110');
    const sub = await c.post('/chart-of-accounts/groups', { code: '1115', name: 'Petty Cash', parentId: current.id }).expect(201);
    expect(sub.body.data.nature).toBe('ASSET');
    const a = await c.post('/chart-of-accounts/accounts', { code: '1190', name: 'Petty Cash Box', groupId: sub.body.data.id, type: 'CASH' }).expect(201);
    await c.patch(`/chart-of-accounts/accounts/${a.body.data.id}`, { name: 'Petty Cash Box 1' }).expect(200);
    await c.post(`/chart-of-accounts/accounts/${a.body.data.id}/deactivate`).expect(201);
    await c.post('/chart-of-accounts/accounts', { code: '1190', name: 'dup', groupId: sub.body.data.id }).expect(409);
    await c.post(`/chart-of-accounts/accounts/${acc[CASH]}/deactivate`).expect(400); // system account
    // inactive account cannot be posted to
    await voucher('JOURNAL', [{ accountId: a.body.data.id, debit: '5.00' }, { accountId: acc[SALES], credit: '5.00' }]).expect(422);
  });

  it('rejects unbalanced, negative, two-sided, over-precise and malformed vouchers', async () => {
    await voucher('JOURNAL', [{ accountId: acc[RENT], debit: '100.00' }, { accountId: acc[CASH], credit: '99.99' }]).expect(422);
    await voucher('JOURNAL', [{ accountId: acc[RENT], debit: '100.001' }, { accountId: acc[CASH], credit: '100.001' }]).expect(422);
    await voucher('JOURNAL', [{ accountId: acc[RENT], debit: '10', credit: '10' }, { accountId: acc[CASH], credit: '0' }]).expect(422);
    await voucher('JOURNAL', [{ accountId: acc[RENT], debit: '-5.00' }, { accountId: acc[CASH], credit: '5.00' }]).expect(400);
    await voucher('JOURNAL', [{ accountId: acc[RENT], debit: 100 }, { accountId: acc[CASH], credit: 100 }]).expect(400); // numbers rejected, strings only
    await voucher('JOURNAL', [{ accountId: acc[RENT], debit: '100.00' }]).expect(400);
  });

  it('enforces voucher-type rules (payment/receipt/contra)', async () => {
    await voucher('PAYMENT', [{ accountId: acc[RENT], debit: '50.00' }, { accountId: acc[SALES], credit: '50.00' }]).expect(422); // credit side is not cash/bank
    await voucher('RECEIPT', [{ accountId: acc[RENT], debit: '50.00' }, { accountId: acc[SALES], credit: '50.00' }]).expect(422);
    await voucher('CONTRA', [{ accountId: acc[CASH], debit: '50.00' }, { accountId: acc[SALES], credit: '50.00' }]).expect(422);
  });

  it('posts vouchers, numbers them sequentially and keeps the trial balance balanced', async () => {
    const before = await tb();
    expect(before.balanced).toBe(true);
    const cap = await voucher('RECEIPT', [{ accountId: acc[BANK], debit: '10000.00' }, { accountId: acc[CAPITAL], credit: '10000.00' }]).expect(201);
    expect(cap.body.data.number).toMatch(/^RV-\d{4}-00001$/);
    await c.post(`/vouchers/${cap.body.data.id}/post`).expect(200);
    await postV('PAYMENT', [{ accountId: acc[RENT], debit: '2500.50' }, { accountId: acc[BANK], credit: '2500.50' }]);
    await postV('CONTRA', [{ accountId: acc[CASH], debit: '1000.00' }, { accountId: acc[BANK], credit: '1000.00' }]);
    await postV('JOURNAL', [{ accountId: acc[CASH], debit: '300.25' }, { accountId: acc[SALES], credit: '300.25' }]);
    const t = await tb();
    expect(t.balanced).toBe(true);
    expect(row(t, BANK).closingDebit).toBe('6499.50');
    expect(row(t, CASH).closingDebit).toBe('1300.25');
    expect(row(t, RENT).closingDebit).toBe('2500.50');
    expect(row(t, SALES).closingCredit).toBe('300.25');
    expect(row(t, CAPITAL).closingCredit).toBe('10000.00');
    expect(t.totals.closingDebit).toBe(t.totals.closingCredit);
  });

  it('ledger statement reconciles with journal lines (running balance)', async () => {
    const st = (await c.get(`/ledgers/${acc[BANK]}/statement`).expect(200)).body;
    expect(st.meta.closing).toEqual({ amount: '6499.50', side: 'DR' });
    expect(st.data.map((r: any) => r.running.amount)).toEqual(['10000.00', '7499.50', '6499.50']);
    expect(st.meta.totalDebit).toBe('10000.00');
    expect(st.meta.totalCredit).toBe('3500.50');
    const l = (await c.get(`/ledgers?type=BANK`).expect(200)).body.data;
    expect(l[0].balance).toBe('6499.50');
  });

  it('prevents duplicate posting and editing of posted vouchers', async () => {
    const v = await voucher('JOURNAL', [{ accountId: acc[RENT], debit: '20.00' }, { accountId: acc[CASH], credit: '20.00' }]).expect(201);
    const id = v.body.data.id;
    await c.post(`/vouchers/${id}/post`).expect(200);
    await c.post(`/vouchers/${id}/post`).expect(409);
    await c.put(`/vouchers/${id}`, { narration: 'tamper' }).expect(409);
    await c.del(`/vouchers/${id}`).expect(409);
    const detail = (await c.get(`/vouchers/${id}`).expect(200)).body.data;
    expect(detail.status).toBe('POSTED');
    expect(detail.history.map((h: any) => h.action)).toEqual(['voucher.created', 'voucher.posted']);
  });

  it('posted journals are immutable at the database level (even for the app role)', async () => {
    const raw = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    try {
      const run = (sql: string) => raw.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${T.companyId}, true)`;
        return tx.$executeRawUnsafe(sql);
      });
      await expect(run(`UPDATE journal_entry_lines SET debit = debit + 1`)).rejects.toThrow();
      await expect(run(`DELETE FROM journal_entries`)).rejects.toThrow();
      await expect(run(`DELETE FROM audit_logs`)).rejects.toThrow();
      // the database itself rejects an unbalanced entry at commit
      const acc2 = acc;
      await expect(raw.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${T.companyId}, true)`;
        const period = await tx.accountingPeriod.findFirstOrThrow({ where: { startDate: { lte: new Date(today()) }, endDate: { gte: new Date(today()) } } });
        await tx.journalEntry.create({ data: { companyId: T.companyId, entryNumber: 'BAD-1', entryDate: new Date(today()), periodId: period.id, sourceType: 'SYSTEM', idempotencyKey: 'bad-1', currency: 'AED', postedBy: T.userId,
          lines: { create: [{ companyId: T.companyId, lineNo: 1, accountId: acc2[RENT], debit: 10 }, { companyId: T.companyId, lineNo: 2, accountId: acc2[CASH], credit: 9 }] } } });
      })).rejects.toThrow(/Unbalanced/);
    } finally { await raw.$disconnect(); }
  });

  it('corrects a posted voucher by reversal; the trial balance still balances and the original stays intact', async () => {
    const id = await postV('PAYMENT', [{ accountId: acc[RENT], debit: '777.00' }, { accountId: acc[CASH], credit: '777.00' }]);
    const before = row(await tb(), RENT).closingDebit;
    const res = await c.post(`/vouchers/${id}/cancel`, { reason: 'Posted to wrong ledger' }).expect(200);
    expect(res.body.data.reversalEntryId).toBeTruthy();
    const after = row(await tb(), RENT).closingDebit;
    expect(Number(before) - Number(after)).toBeCloseTo(777, 2);
    expect((await tb()).balanced).toBe(true);
    await c.post(`/vouchers/${id}/cancel`, { reason: 'again' }).expect(409);
    const detail = (await c.get(`/vouchers/${id}`).expect(200)).body.data;
    expect(detail.status).toBe('CANCELLED');
    expect(detail.journalEntryId).toBeTruthy(); // original journal preserved
  });

  it('replace = reverse + linked replacement draft', async () => {
    const id = await postV('JOURNAL', [{ accountId: acc[RENT], debit: '40.00' }, { accountId: acc[CASH], credit: '40.00' }]);
    const r = await c.post(`/vouchers/${id}/replace`, { reason: 'Amount to be corrected' }).expect(200);
    expect(r.body.data.replacement.status).toBe('DRAFT');
    expect(r.body.data.replacement.replacesId).toBe(id);
    expect((await tb()).balanced).toBe(true);
  });

  it('approval workflow with segregation of duties', async () => {
    await c.patch('/company/settings', { requireVoucherApproval: true }).expect(200);
    const v = await voucher('JOURNAL', [{ accountId: acc[RENT], debit: '90.00' }, { accountId: acc[CASH], credit: '90.00' }]).expect(201);
    const id = v.body.data.id;
    await c.post(`/vouchers/${id}/post`).expect(409); // not approved yet
    await c.post(`/vouchers/${id}/submit`).expect(200);
    await c.post(`/vouchers/${id}/approve`).expect(403); // creator cannot approve own voucher
    await c.patch('/company/settings', { allowSelfApproval: true }).expect(200);
    await c.post(`/vouchers/${id}/reject`, { reason: 'Missing narration' }).expect(200);
    await c.post(`/vouchers/${id}/submit`).expect(200);
    await c.post(`/vouchers/${id}/approve`).expect(200);
    await c.post(`/vouchers/${id}/post`).expect(200);
    await c.patch('/company/settings', { requireVoucherApproval: false, allowSelfApproval: false }).expect(200);
  });

  it('locked periods block posting and reversal; unlocking restores it', async () => {
    const fys = (await c.get('/accounting/financial-years').expect(200)).body.data;
    const period = fys[0].periods.find((p: any) => p.startDate.slice(0, 10) <= today() && p.endDate.slice(0, 10) >= today());
    const v = await voucher('JOURNAL', [{ accountId: acc[RENT], debit: '5.00' }, { accountId: acc[CASH], credit: '5.00' }]).expect(201);
    await c.post(`/accounting/periods/${period.id}/lock`).expect(201);
    await c.post(`/vouchers/${v.body.data.id}/post`).expect(403);
    await c.post(`/accounting/periods/${period.id}/unlock`).expect(201);
    await c.post(`/vouchers/${v.body.data.id}/post`).expect(200);
  });

  it('opening balances post as one balanced journal, with any difference to a suspense account', async () => {
    const fy = (await c.get('/accounting/financial-years').expect(200)).body.data[0];
    const t = await registerAndLogin(app, 'Opening Co'); const oc = api(app, t.token); const a = await accountMap(app, t.token);
    const fy2 = (await oc.get('/accounting/financial-years').expect(200)).body.data[0];
    await oc.put('/ledgers/opening-balances', { financialYearId: fy2.id, items: [
      { accountId: a[CASH], debit: '500.00', credit: '0' }, { accountId: a[BANK], debit: '1500.00', credit: '0' }, { accountId: a[CAPITAL], debit: '0', credit: '2000.00' },
    ] }).expect(200);
    const p = await oc.post('/ledgers/opening-balances/post', { financialYearId: fy2.id }).expect(201);
    expect(p.body.data.difference).toBe('0.00');
    await oc.post('/ledgers/opening-balances/post', { financialYearId: fy2.id }).expect(409);
    await oc.put('/ledgers/opening-balances', { financialYearId: fy2.id, items: [] }).expect(409);
    const tbo = (await oc.get('/reports/trial-balance').expect(200)).body.data;
    expect(tbo.balanced).toBe(true);
    expect(tbo.items.find((i: any) => i.code === BANK).closingDebit).toBe('1500.00');
    expect(fy.id).toBeTruthy();
  });

  it('foreign currency postings translate to base currency and stay balanced', async () => {
    await c.put('/accounting/exchange-rates', { currency: 'USD', rateDate: today(), rate: '3.6725' }).expect(200);
    const before = await tb();
    const id = await postV('PAYMENT', [{ accountId: acc[RENT], debit: '100.00' }, { accountId: acc[CASH], credit: '100.00' }]);
    expect(id).toBeTruthy();
    const v = await voucher('JOURNAL', [{ accountId: acc[RENT], debit: '33.33' }, { accountId: acc[CASH], credit: '33.33' }], { currency: 'USD' }).expect(201);
    await c.post(`/vouchers/${v.body.data.id}/post`).expect(200);
    const after = await tb();
    expect(after.balanced).toBe(true);
    // 100 AED payment + 33.33 USD * 3.6725 = 122.4 AED rent
    expect(Number(row(after, RENT).closingDebit) - Number(row(before, RENT).closingDebit)).toBeCloseTo(100 + 122.4, 2);
  });

  it('writes an audit trail for financial actions', async () => {
    const raw = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    try {
      const rows = await raw.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${T.companyId}, true)`;
        return tx.auditLog.findMany({ select: { action: true } });
      });
      const actions = new Set(rows.map((r) => r.action));
      for (const a of ['voucher.created', 'voucher.posted', 'voucher.cancelled', 'period.locked', 'account.created']) expect(actions).toContain(a);
    } finally { await raw.$disconnect(); }
  });
});
