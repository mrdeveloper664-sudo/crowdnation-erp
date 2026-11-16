import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Tenant, accountMap, api, createApp, registerAndLogin, today } from './helpers';

describe('Financial reports (e2e)', () => {
  let app: INestApplication; let T: Tenant; let acc: Record<string, string>; let c: ReturnType<typeof api>;
  const run = async (name: string, q = '') => (await c.get(`/reports/run/${name}?${q}`).expect(200)).body.data;
  const post = async (type: string, lines: any[], date = today()) => {
    const v = await c.post('/vouchers', { type, date, lines }).expect(201);
    await c.post(`/vouchers/${v.body.data.id}/post`).expect(200);
  };
  const row = (r: any, text: string) => r.rows.find((x: any) => (x.particulars ?? x.name ?? '').includes(text));

  beforeAll(async () => {
    ({ app } = await createApp());
    T = await registerAndLogin(app, 'Report Co'); c = api(app, T.token); acc = await accountMap(app, T.token);
    // capital 20000 in bank; buy fixed asset 6000 (bank); sales 5000 on credit; purchases 2000 on credit; rent 800 cash-paid; customer receipt 3000; depreciation 100
    await post('RECEIPT', [{ accountId: acc['1112'], debit: '20000.00' }, { accountId: acc['3001'], credit: '20000.00' }]);
    await post('PAYMENT', [{ accountId: acc['1201'], debit: '6000.00' }, { accountId: acc['1112'], credit: '6000.00' }]);
    await post('SALES', [{ accountId: acc['1121'], debit: '5000.00' }, { accountId: acc['4101'], credit: '5000.00' }]);
    await post('PURCHASE', [{ accountId: acc['5101'], debit: '2000.00' }, { accountId: acc['2111'], credit: '2000.00' }]);
    await post('CONTRA', [{ accountId: acc['1111'], debit: '1000.00' }, { accountId: acc['1112'], credit: '1000.00' }]);
    await post('PAYMENT', [{ accountId: acc['5202'], debit: '800.00' }, { accountId: acc['1111'], credit: '800.00' }]);
    await post('RECEIPT', [{ accountId: acc['1112'], debit: '3000.00' }, { accountId: acc['1121'], credit: '3000.00' }]);
    await post('JOURNAL', [{ accountId: acc['5204'], debit: '100.00' }, { accountId: acc['1202'], credit: '100.00' }]);
  });
  afterAll(async () => { await app.close(); });

  it('lists the report catalog', async () => {
    const cat = (await c.get('/reports/catalog').expect(200)).body.data;
    expect(cat.map((r: any) => r.name)).toEqual(expect.arrayContaining(['trial-balance', 'profit-and-loss', 'balance-sheet', 'cash-flow', 'general-ledger', 'day-book', 'cash-book', 'bank-book', 'ledger-statement', 'customer-outstanding', 'supplier-outstanding', 'accounts-receivable', 'accounts-payable', 'vat', 'expense-report', 'income-report']));
  });

  it('trial balance balances', async () => {
    const r = await run('trial-balance');
    expect(r.meta.balanced).toBe(true);
    const total = r.rows.find((x: any) => x._kind === 'total');
    expect(total.closingDebit).toBe(total.closingCredit);
  });

  it('P&L reconciles to the journal: income 5000, expenses 2900, profit 2100', async () => {
    const r = await run('profit-and-loss');
    expect(r.meta).toMatchObject({ income: '5000.00', expenses: '2900.00', netProfit: '2100.00' });
    expect(row(r, 'Sales').amount).toBe('5000.00');
  });

  it('balance sheet: assets = liabilities + equity', async () => {
    const r = await run('balance-sheet');
    expect(r.meta.balanced).toBe(true);
    expect(r.meta).toMatchObject({ assets: '24100.00', liabilities: '2000.00', equity: '22100.00' });
  });

  it('cash flow reconciles to cash and bank movement', async () => {
    const r = await run('cash-flow');
    expect(r.meta.reconciled).toBe(true);
    expect(r.meta.closingCash).toBe('16200.00'); // bank 16000 + cash 200
    expect(r.meta.investing).toBe('-6000.00');
    expect(r.meta.financing).toBe('20000.00');
  });

  it('bank book / cash book / ledger statement show running balances', async () => {
    const bank = await run('bank-book');
    expect(row(bank, 'Closing balance').balance).toBe('16000.00 Dr');
    const cash = await run('cash-book');
    expect(row(cash, 'Closing balance').balance).toBe('200.00 Dr');
    const st = await run('ledger-statement', `accountId=${acc['1121']}`);
    expect(row(st, 'Closing balance').balance).toBe('2000.00 Dr');
  });

  it('customer outstanding / receivable ageing / supplier payable', async () => {
    const cu = await run('customer-outstanding');
    expect(cu.meta.total).toBe('2000.00');
    const ar = await run('accounts-receivable');
    expect(ar.rows[0]).toMatchObject({ outstanding: '2000.00', current: '2000.00' });
    expect((await run('supplier-outstanding')).meta.total).toBe('2000.00');
    expect((await run('accounts-payable')).rows[0].current).toBe('2000.00');
  });

  it('day book, GL, expense and income reports; drill-down ids present', async () => {
    const d = await run('day-book');
    expect(d.rows.length).toBeGreaterThan(10);
    expect(d.rows[0]._drill).toBeTruthy();
    expect(Number(d.summary[0].value.replace(/,/g, ''))).toBe(Number(d.summary[1].value.replace(/,/g, '')));
    expect((await run('general-ledger')).rows.length).toBeGreaterThan(10);
    expect((await run('expense-report')).summary[0].value).toBe('2900.00');
    expect((await run('income-report')).summary[0].value).toBe('5000.00');
    expect((await run('day-book', 'voucherType=SALES')).rows.length).toBe(2);
  });

  it('date range and financial-year filters', async () => {
    const fy = (await c.get('/accounting/financial-years').expect(200)).body.data[0];
    expect((await run('profit-and-loss', `financialYearId=${fy.id}`)).meta.netProfit).toBe('2100.00');
    expect((await run('profit-and-loss', 'from=1999-01-01&to=1999-12-31')).meta.netProfit).toBe('0.00');
    await c.get('/reports/run/nope').expect(404);
  });

  it('exports to xlsx, pdf, csv and print html', async () => {
    const get = (f: string) => request(app.getHttpServer()).get(`/api/v1/reports/run/trial-balance?format=${f}`).set('Authorization', `Bearer ${T.token}`).buffer(true).parse((res, cb) => { const d: Buffer[] = []; res.on('data', (x) => d.push(x)); res.on('end', () => cb(null, Buffer.concat(d))); });
    const x = await get('xlsx').expect(200); expect(x.body.slice(0, 2).toString()).toBe('PK');
    const p = await get('pdf').expect(200); expect(p.body.slice(0, 4).toString()).toBe('%PDF');
    const csv = await get('csv').expect(200); expect(csv.body.toString()).toContain('Account');
    const h = await get('html').expect(200); expect(h.body.toString()).toContain('<table>');
  });

  it('export requires the export permission (Viewer role has no export)', async () => {
    const roles = (await c.get('/roles').expect(200)).body.data;
    const accountant = roles.find((r: any) => r.name === 'Viewer');
    expect(accountant.permissions).not.toContain('report:export');
  });
});
