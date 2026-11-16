import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Tenant, accountMap, api, createApp, registerAndLogin, today } from './helpers';

describe('Sales & purchases (e2e)', () => {
  let app: INestApplication; let T: Tenant; let acc: Record<string, string>; let c: ReturnType<typeof api>; let cust: any; let supp: any;
  const tb = async () => (await c.get('/reports/run/trial-balance').expect(200)).body.data;
  const vatRet = async () => (await c.get(`/vat/return?from=${today().slice(0, 4)}-01-01&to=${today().slice(0, 4)}-12-31`).expect(200)).body.data;
  const bal = async (id: string) => (await c.get(`/ledgers/${id}`).expect(200)).body.data;

  beforeAll(async () => {
    ({ app } = await createApp());
    T = await registerAndLogin(app, 'Trade Co'); c = api(app, T.token); acc = await accountMap(app, T.token);
    await c.post('/vouchers', { type: 'RECEIPT', date: today(), lines: [{ accountId: acc['1112'], debit: '50000.00' }, { accountId: acc['3001'], credit: '50000.00' }] }).then(async (r) => c.post(`/vouchers/${r.body.data.id}/post`).expect(200));
    cust = (await c.post('/customers', { name: 'Al Noor Trading', trn: '100234567890003', email: 'ap@alnoor.test', creditLimit: '20000.00' }).expect(201)).body.data;
    supp = (await c.post('/suppliers', { name: 'Gulf Supplies LLC' }).expect(201)).body.data;
  });
  afterAll(async () => { await app.close(); });

  const invoice = async (lines: any[], extra: any = {}) => {
    const d = (await c.post('/sales/documents', { type: 'INVOICE', partyId: cust.id, date: today(), lines, ...extra }).expect(201)).body.data;
    return d;
  };

  it('creating a customer creates its ledger account', async () => {
    expect(cust.code).toBe('C00001');
    const l = await bal(cust.accountId);
    expect(l.type).toBe('CUSTOMER');
    expect((await c.get('/customers').expect(200)).body.data).toHaveLength(1);
    expect((await c.get('/suppliers').expect(200)).body.data).toHaveLength(1);
  });

  it('calculates invoice totals with line VAT (exclusive) and with inclusive pricing', async () => {
    const d = await invoice([
      { description: 'Widget', quantity: '10', unitPrice: '25.00', discountPct: '10' },
      { description: 'Zero-rated export', quantity: '1', unitPrice: '100.00', taxCode: 'ZERO' },
    ]);
    expect(d.lines[0]).toMatchObject({ net: '225.00', vat: '11.25', gross: '236.25' });
    expect([d.net, d.vat, d.total]).toEqual(['325.00', '11.25', '336.25']);
    expect(d.number).toMatch(/^INV-\d{4}-00001$/);
    const inc = await invoice([{ description: 'Service', quantity: '1', unitPrice: '105.00' }], { pricesIncludeVat: true });
    expect([inc.net, inc.vat, inc.total]).toEqual(['100.00', '5.00', '105.00']);
    await c.del(`/sales/documents/${d.id}`).expect(200); await c.del(`/sales/documents/${inc.id}`).expect(200);
  });

  let inv: any;
  it('posting an invoice creates balanced journal + output VAT automatically', async () => {
    inv = await invoice([{ description: 'Consulting', quantity: '2', unitPrice: '1000.00' }, { description: 'Export goods', quantity: '1', unitPrice: '500.00', taxCode: 'ZERO' }]);
    expect(inv.total).toBe('2600.00');
    await c.put(`/sales/documents/${inv.id}`, { notes: 'edited while draft' }).expect(200);
    const posted = (await c.post(`/sales/documents/${inv.id}/post`).expect(200)).body.data;
    expect(posted.status).toBe('POSTED'); expect(posted.outstanding).toBe('2600.00'); expect(posted.voucher.number).toMatch(/^SV-/);
    await c.post(`/sales/documents/${inv.id}/post`).expect(409);
    await c.put(`/sales/documents/${inv.id}`, { notes: 'x' }).expect(409);
    expect((await bal(cust.accountId))).toMatchObject({ balance: '2600.00', balanceSide: 'DR' });
    expect((await bal(acc['2121']))).toMatchObject({ balance: '100.00', balanceSide: 'CR' });
    expect((await bal(acc['4101']))).toMatchObject({ balance: '2500.00', balanceSide: 'CR' });
    const r = await vatRet();
    expect(r.outputs.find((b: any) => b.box === '1b')).toMatchObject({ amount: '2000.00', vat: '100.00' });
    expect(r.outputs.find((b: any) => b.box === '4').amount).toBe('500.00');
    expect((await tb()).meta.balanced).toBe(true);
  });

  it('enforces the customer credit limit', async () => {
    const big = await invoice([{ description: 'Huge order', quantity: '1', unitPrice: '30000.00' }]);
    await c.post(`/sales/documents/${big.id}/post`).expect(422);
    await c.del(`/sales/documents/${big.id}`).expect(200);
  });

  it('receipts allocate to invoices; over-allocation is rejected', async () => {
    await c.post('/sales/receipts', { partyId: cust.id, date: today(), amount: '1000.00', accountId: acc['1112'], allocations: [{ documentId: inv.id, amount: '3000.00' }] }).expect(422);
    const r = (await c.post('/sales/receipts', { partyId: cust.id, date: today(), amount: '1000.00', accountId: acc['1112'], reference: 'CHQ-77', allocations: [{ documentId: inv.id, amount: '900.00' }] }).expect(201)).body.data;
    expect(r.number).toMatch(/^RCT-/); expect(r.unallocated).toBe('100.00');
    expect((await c.get(`/sales/documents/${inv.id}`).expect(200)).body.data).toMatchObject({ paid: '900.00', outstanding: '1700.00' });
    expect((await bal(cust.accountId))).toMatchObject({ balance: '1600.00', balanceSide: 'DR' }); // 2600 - 1000 (100 on account)
    const open = (await c.get('/sales/documents?outstanding=true').expect(200)).body.data;
    expect(open.map((d: any) => d.id)).toContain(inv.id);
    expect((await tb()).meta.balanced).toBe(true);
  });

  it('credit note reduces VAT and can be applied to the invoice', async () => {
    const cn = (await c.post('/sales/documents', { type: 'CREDIT_NOTE', partyId: cust.id, date: today(), reference: inv.number, lines: [{ description: 'Returned consulting day', quantity: '1', unitPrice: '200.00' }] }).expect(201)).body.data;
    const posted = (await c.post(`/sales/documents/${cn.id}/post`).expect(200)).body.data;
    expect(posted.voucher.number).toMatch(/^CN-/);
    expect((await vatRet()).summary.totalVatDue).toBe('90.00'); // 100 - 10
    await c.post(`/sales/documents/${cn.id}/apply`, { invoiceId: inv.id, amount: '210.00' }).expect(200);
    await c.post(`/sales/documents/${cn.id}/apply`, { invoiceId: inv.id, amount: '1.00' }).expect(422); // fully applied
    expect((await c.get(`/sales/documents/${inv.id}`).expect(200)).body.data.outstanding).toBe('1490.00');
    await c.post(`/sales/documents/${inv.id}/cancel`, { reason: 'mistake' }).expect(409); // has payments
  });

  it('quotation -> order -> invoice conversion keeps the chain', async () => {
    const q = (await c.post('/sales/documents', { type: 'QUOTATION', partyId: cust.id, date: today(), lines: [{ description: 'Setup', quantity: '1', unitPrice: '300.00' }] }).expect(201)).body.data;
    await c.post(`/sales/documents/${q.id}/post`).expect(400);
    const o = (await c.post(`/sales/documents/${q.id}/convert`, { to: 'ORDER' }).expect(200)).body.data;
    expect(o.sourceDocId).toBe(q.id);
    await c.post(`/sales/documents/${o.id}/convert`, { to: 'INVOICE' }).expect(409); // order must be confirmed
    await c.post(`/sales/documents/${o.id}/confirm`).expect(200);
    const i = (await c.post(`/sales/documents/${o.id}/convert`, { to: 'INVOICE' }).expect(200)).body.data;
    expect(i.type).toBe('INVOICE'); expect(i.total).toBe('315.00');
    expect((await c.get(`/sales/documents/${q.id}`).expect(200)).body.data.status).toBe('CONVERTED');
    await c.post(`/sales/documents/${i.id}/post`).expect(200);
    await c.post(`/sales/documents/${i.id}/cancel`, { reason: 'customer withdrew' }).expect(200); // reversal, VAT reversed
    expect((await c.get(`/sales/documents/${i.id}`).expect(200)).body.data.status).toBe('CANCELLED');
    expect((await vatRet()).summary.totalVatDue).toBe('90.00');
    expect((await tb()).meta.balanced).toBe(true);
  });

  it('purchase invoice posts expense + input VAT; supplier payment settles it', async () => {
    const pi = (await c.post('/purchases/documents', { type: 'INVOICE', partyId: supp.id, date: today(), reference: 'SUP-INV-9', lines: [{ description: 'Office rent Q1', quantity: '1', unitPrice: '2000.00', accountId: acc['5202'] }] }).expect(201)).body.data;
    expect(pi.number).toMatch(/^PINV-/);
    expect((await c.post(`/purchases/documents/${pi.id}/post`).expect(200)).body.data.voucher.number).toMatch(/^PU-/);
    expect((await bal(supp.accountId))).toMatchObject({ balance: '2100.00', balanceSide: 'CR' });
    expect((await vatRet()).summary.recoverableVat).toBe('100.00');
    const pay = (await c.post('/purchases/payments', { partyId: supp.id, date: today(), amount: '2100.00', accountId: acc['1112'], allocations: [{ documentId: pi.id, amount: '2100.00' }] }).expect(201)).body.data;
    expect(pay.number).toMatch(/^PAY-/);
    expect((await c.get(`/purchases/documents/${pi.id}`).expect(200)).body.data.outstanding).toBe('0.00');
    expect((await bal(supp.accountId)).balance).toBe('0.00');
    await c.post(`/purchases/payments/${pay.id}/cancel`, { reason: 'bounced' }).expect(200);
    expect((await c.get(`/purchases/documents/${pi.id}`).expect(200)).body.data.outstanding).toBe('2100.00');
    expect((await tb()).meta.balanced).toBe(true);
  });

  it('customer vs supplier documents cannot be mixed', async () => {
    await c.post('/purchases/documents', { type: 'INVOICE', partyId: cust.id, date: today(), lines: [{ description: 'x', quantity: '1', unitPrice: '1' }] }).expect(400);
    await c.post('/sales/documents', { type: 'ORDER', partyId: supp.id, date: today(), lines: [{ description: 'x', quantity: '1', unitPrice: '1' }] }).expect(400);
    await c.post('/sales/documents', { type: 'GRN', partyId: cust.id, date: today(), lines: [{ description: 'x', quantity: '1', unitPrice: '1' }] }).expect(400);
  });

  it('recurring invoices are generated (and posted) for each missed period', async () => {
    const start = new Date(); start.setUTCDate(1); start.setUTCMonth(start.getUTCMonth() - 1);
    const startDate = start.toISOString().slice(0, 10);
    await c.post('/sales/recurring', { partyId: cust.id, frequency: 'MONTHLY', startDate, autoPost: true, lines: [{ description: 'Monthly retainer', quantity: '1', unitPrice: '100.00' }] }).expect(201);
    const r = (await c.post('/sales/recurring/run', { asOf: today() }).expect(200)).body.data;
    expect(r.generated).toBe(2);
    expect((await c.post('/sales/recurring/run', { asOf: today() }).expect(200)).body.data.generated).toBe(0);
    expect((await tb()).meta.balanced).toBe(true);
  });

  it('statement of a customer ties to the ledger; reports see the debtors', async () => {
    const st = (await c.get(`/customers/${cust.id}/statement`).expect(200)).body.data;
    expect(st.rows.some((r: any) => r.particulars === 'Closing balance')).toBe(true);
    const ar = (await c.get('/reports/run/customer-outstanding').expect(200)).body.data;
    expect(ar.rows[0].name).toBe('Al Noor Trading');
  });

  it('views customers/suppliers/sales_invoices exist and respect tenant isolation', async () => {
    const raw = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    try {
      expect(Number((await raw.$queryRawUnsafe<any[]>('SELECT count(*)::int AS n FROM customers'))[0].n)).toBe(0); // no tenant -> none
      const n = await raw.$transaction(async (tx) => { await tx.$executeRaw`SELECT set_config('app.current_company_id', ${T.companyId}, true)`; return (await tx.$queryRawUnsafe<any[]>('SELECT (SELECT count(*) FROM customers)::int AS c, (SELECT count(*) FROM suppliers)::int AS s, (SELECT count(*) FROM sales_invoices)::int AS i, (SELECT count(*) FROM receipts)::int AS r, (SELECT count(*) FROM payments)::int AS p'))[0]; });
      expect(n).toMatchObject({ c: 1, s: 1 }); expect(n.i).toBeGreaterThan(0);
    } finally { await raw.$disconnect(); }
  });
});
