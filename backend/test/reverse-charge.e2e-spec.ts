import { INestApplication } from '@nestjs/common';
import { Tenant, accountMap, api, createApp, registerAndLogin, today } from './helpers';

/** UAE VAT reverse charge on purchases: input and output VAT recorded together, VAT 201 boxes 3 and 10. */
describe('VAT reverse charge (e2e)', () => {
  let app: INestApplication; let T: Tenant; let acc: Record<string, string>; let c: ReturnType<typeof api>; let supp: any; let cust: any; let rc: any;
  const VIN = '1141', VOUT = '2121';
  const tb = async () => (await c.get('/reports/run/trial-balance').expect(200)).body.data;
  const bal = async (id: string) => (await c.get(`/ledgers/${id}`).expect(200)).body.data;
  const ret = async () => (await c.get(`/vat/return?from=${today().slice(0, 4)}-01-01&to=${today().slice(0, 4)}-12-31`).expect(200)).body.data;
  const box = (r: any, n: string) => [...r.outputs, ...r.inputs].find((b: any) => b.box === n);
  const rcInvoice = async (price: string, extra: any = {}) => {
    const d = (await c.post('/purchases/documents', { type: 'INVOICE', partyId: supp.id, date: today(), lines: [{ description: 'Overseas consulting', quantity: '1', unitPrice: price, taxCode: 'RC', accountId: acc['5202'], ...extra }] }).expect(201)).body.data;
    return d;
  };

  beforeAll(async () => {
    ({ app } = await createApp());
    T = await registerAndLogin(app, 'RC Co'); c = api(app, T.token); acc = await accountMap(app, T.token);
    supp = (await c.post('/suppliers', { name: 'Overseas Consulting Ltd' }).expect(201)).body.data;
    cust = (await c.post('/customers', { name: 'Local Customer' }).expect(201)).body.data;
  });
  afterAll(async () => { await app.close(); });

  it('reverse charge is opt-in: no RC code by default; the helper creates it once; custom codes must be standard rated', async () => {
    expect((await c.get('/vat/rates').expect(200)).body.data.map((r: any) => r.code)).not.toContain('RC');
    await c.post('/vat/rates', { code: 'BAD', name: 'Bad RC', treatment: 'ZERO', rate: '0', effectiveFrom: '2018-01-01', reverseCharge: true }).expect(400);
    rc = (await c.post('/vat/rates/reverse-charge').expect(201)).body.data;
    expect(rc).toMatchObject({ code: 'RC', treatment: 'STANDARD', rate: '5', isReverseCharge: true });
    const again = (await c.post('/vat/rates/reverse-charge').expect(201)).body.data;
    expect(again.id).toBe(rc.id);
    expect((await c.post('/vat/calculate', { code: 'RC', date: today(), amount: '1000.00', inclusive: false }).expect(201)).body.data).toMatchObject({ reverseCharge: true, vat: '50.00' });
  });

  let inv: any;
  it('a reverse-charge purchase invoice owes the supplier the net only and books input + output VAT together', async () => {
    inv = await rcInvoice('1000.00');
    expect([inv.net, inv.vat, inv.total]).toEqual(['1000.00', '0.00', '1000.00']); // supplier is owed 1,000 (no VAT charged)
    expect(inv.lines[0]).toMatchObject({ net: '1000.00', vat: '50.00', gross: '1000.00' }); // line still shows the VAT we self-assess
    await c.post(`/purchases/documents/${inv.id}/post`).expect(200);
    expect(await bal(supp.accountId)).toMatchObject({ balance: '1000.00', balanceSide: 'CR' });
    expect(await bal(acc['5202'])).toMatchObject({ balance: '1000.00', balanceSide: 'DR' });
    expect(await bal(acc[VIN])).toMatchObject({ balance: '50.00', balanceSide: 'DR' });
    expect(await bal(acc[VOUT])).toMatchObject({ balance: '50.00', balanceSide: 'CR' });
    expect((await tb()).meta.balanced).toBe(true);
    const r = await ret();
    expect(box(r, '3')).toMatchObject({ amount: '1000.00', vat: '50.00' });
    expect(box(r, '10')).toMatchObject({ amount: '1000.00', vat: '50.00' });
    expect(box(r, '9')).toMatchObject({ amount: '0.00', vat: '0.00' }); // not a normal standard-rated expense
    expect(r.outputs.find((b: any) => b.box === '1b')).toMatchObject({ amount: '0.00', vat: '0.00' }); // not a normal supply
    expect(box(r, '8')).toMatchObject({ amount: '1000.00', vat: '50.00' });
    expect(box(r, '11')).toMatchObject({ amount: '1000.00', vat: '50.00' });
    expect(r.summary).toMatchObject({ totalVatDue: '50.00', recoverableVat: '50.00', netVatDue: '0.00' });
  });

  it('boxes combine with ordinary sales and purchases; the net position only reflects the ordinary VAT', async () => {
    const sale = (await c.post('/sales/documents', { type: 'INVOICE', partyId: cust.id, date: today(), lines: [{ description: 'Goods', quantity: '1', unitPrice: '2000.00' }] }).expect(201)).body.data;
    await c.post(`/sales/documents/${sale.id}/post`).expect(200);
    const pur = (await c.post('/purchases/documents', { type: 'INVOICE', partyId: supp.id, date: today(), lines: [{ description: 'Local supplies', quantity: '1', unitPrice: '400.00', accountId: acc['5202'] }] }).expect(201)).body.data;
    await c.post(`/purchases/documents/${pur.id}/post`).expect(200);
    const r = await ret();
    expect(r.outputs.find((b: any) => b.box === '1b')).toMatchObject({ amount: '2000.00', vat: '100.00' });
    expect(box(r, '9')).toMatchObject({ amount: '400.00', vat: '20.00' });
    expect(box(r, '3')).toMatchObject({ amount: '1000.00', vat: '50.00' });
    expect(box(r, '8')).toMatchObject({ amount: '3000.00', vat: '150.00' });
    expect(box(r, '11')).toMatchObject({ amount: '1400.00', vat: '70.00' });
    expect(r.summary).toMatchObject({ totalVatDue: '150.00', recoverableVat: '70.00', netVatDue: '80.00', position: 'PAYABLE' }); // 100 - 20
    expect((await tb()).meta.balanced).toBe(true);
  });

  it('the supplier is settled with the net amount only', async () => {
    const bank = acc['1112'];
    await c.post('/vouchers', { type: 'RECEIPT', date: today(), lines: [{ accountId: bank, debit: '10000.00' }, { accountId: acc['3001'], credit: '10000.00' }] }).then((r) => c.post(`/vouchers/${r.body.data.id}/post`).expect(200));
    await c.post('/purchases/payments', { partyId: supp.id, date: today(), amount: '1000.00', accountId: bank, allocations: [{ documentId: inv.id, amount: '1000.00' }] }).expect(201);
    expect((await c.get(`/purchases/documents/${inv.id}`).expect(200)).body.data.outstanding).toBe('0.00');
  });

  it('a debit note on a reverse-charge purchase reduces both input and output VAT', async () => {
    const dn = (await c.post('/purchases/documents', { type: 'DEBIT_NOTE', partyId: supp.id, date: today(), lines: [{ description: 'Returned services', quantity: '1', unitPrice: '200.00', taxCode: 'RC', accountId: acc['5202'] }] }).expect(201)).body.data;
    expect([dn.net, dn.vat, dn.total]).toEqual(['200.00', '0.00', '200.00']);
    await c.post(`/purchases/documents/${dn.id}/post`).expect(200);
    const r = await ret();
    expect(box(r, '3')).toMatchObject({ amount: '800.00', vat: '40.00' });
    expect(box(r, '10')).toMatchObject({ amount: '800.00', vat: '40.00' });
    expect((await tb()).meta.balanced).toBe(true);
  });

  it('cancelling a posted reverse-charge invoice reverses both tax rows', async () => {
    const extra = await rcInvoice('600.00');
    await c.post(`/purchases/documents/${extra.id}/post`).expect(200);
    expect(box(await ret(), '3')).toMatchObject({ amount: '1400.00', vat: '70.00' });
    await c.post(`/purchases/documents/${extra.id}/cancel`, { reason: 'duplicate' }).expect(200);
    const r = await ret();
    expect(box(r, '3')).toMatchObject({ amount: '800.00', vat: '40.00' });
    expect(box(r, '10')).toMatchObject({ amount: '800.00', vat: '40.00' });
    expect((await tb()).meta.balanced).toBe(true);
  });

  it('reverse charge is rejected where it does not apply', async () => {
    // sales documents
    await c.post('/sales/documents', { type: 'INVOICE', partyId: cust.id, date: today(), lines: [{ description: 'x', quantity: '1', unitPrice: '10.00', taxCode: 'RC' }] }).expect(422);
    // VAT-inclusive prices (the supplier charged no VAT)
    await c.post('/purchases/documents', { type: 'INVOICE', partyId: supp.id, date: today(), pricesIncludeVat: true, lines: [{ description: 'x', quantity: '1', unitPrice: '105.00', taxCode: 'RC' }] }).expect(422);
    // expenses
    const cat = (await c.post('/expenses/categories', { name: 'Services', accountId: acc['5207'] }).expect(201)).body.data;
    await c.post('/expenses', { kind: 'DIRECT', categoryId: cat.id, date: today(), description: 'Foreign SaaS', amount: '100.00', taxCode: 'RC', paidFromId: acc['1112'] }).expect(400);
  });

  it('manual vouchers: reverse charge needs equal input and output VAT, and a purchase-side voucher', async () => {
    const rcId = rc.id;
    const tagged = (account: string, side: 'debit' | 'credit', v: string) => ({ accountId: acc[account], [side]: v, taxRateId: rcId, taxableAmount: '300.00' });
    // only the input leg
    await c.post('/vouchers', { type: 'PURCHASE', date: today(), lines: [{ accountId: acc['5202'], debit: '300.00' }, tagged(VIN, 'debit', '15.00'), { accountId: supp.accountId, credit: '315.00' }] }).expect(422);
    // sales voucher
    await c.post('/vouchers', { type: 'SALES', date: today(), lines: [{ accountId: supp.accountId, debit: '300.00' }, tagged(VIN, 'debit', '15.00'), tagged(VOUT, 'credit', '15.00'), { accountId: acc['4101'], credit: '300.00' }] }).expect(422);
    // balanced pair
    const before = box(await ret(), '3');
    const v = (await c.post('/vouchers', { type: 'PURCHASE', date: today(), lines: [{ accountId: acc['5202'], debit: '300.00' }, tagged(VIN, 'debit', '15.00'), tagged(VOUT, 'credit', '15.00'), { accountId: supp.accountId, credit: '300.00' }] }).expect(201)).body.data;
    await c.post(`/vouchers/${v.id}/post`).expect(200);
    const after = box(await ret(), '3');
    expect(Number(after.amount) - Number(before.amount)).toBe(300);
    expect(Number(after.vat) - Number(before.vat)).toBe(15);
    expect((await tb()).meta.balanced).toBe(true);
  });
});
