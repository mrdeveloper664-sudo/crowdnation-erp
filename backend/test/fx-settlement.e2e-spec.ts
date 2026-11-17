import { INestApplication } from '@nestjs/common';
import { Tenant, accountMap, api, createApp, registerAndLogin, today } from './helpers';

/** Foreign-currency invoices settled by receipts / payments: realised FX gain/loss through PostingService. */
describe('FX settlement (e2e)', () => {
  let app: INestApplication; let T: Tenant; let acc: Record<string, string>; let c: ReturnType<typeof api>; let cust: any; let supp: any;
  const tb = async () => (await c.get('/reports/run/trial-balance').expect(200)).body.data;
  const bal = async (id: string) => (await c.get(`/ledgers/${id}`).expect(200)).body.data;
  const balance = async (id: string) => { const b = await bal(id); return b.balanceSide === 'CR' ? '-' + b.balance : b.balance; }; // signed, DR positive
  const outstanding = async (side: string, id: string) => (await c.get(`/${side}/documents/${id}`).expect(200)).body.data.outstanding;
  const usdInvoice = async (side: 'sales' | 'purchases', party: any, price: string, rate: string, taxCode = 'ZERO') => {
    const d = (await c.post(`/${side}/documents`, { type: 'INVOICE', partyId: party.id, date: today(), currency: 'USD', exchangeRate: rate, lines: [{ description: 'Goods', quantity: '1', unitPrice: price, taxCode, accountId: side === 'purchases' ? acc['5202'] : undefined }] }).expect(201)).body.data;
    await c.post(`/${side}/documents/${d.id}/post`).expect(200);
    return d;
  };

  beforeAll(async () => {
    ({ app } = await createApp());
    T = await registerAndLogin(app, 'FX Co'); c = api(app, T.token); acc = await accountMap(app, T.token);
    await c.post('/vouchers', { type: 'RECEIPT', date: today(), lines: [{ accountId: acc['1112'], debit: '500000.00' }, { accountId: acc['3001'], credit: '500000.00' }] }).then(async (r) => c.post(`/vouchers/${r.body.data.id}/post`).expect(200));
    cust = (await c.post('/customers', { name: 'Global Imports Inc' }).expect(201)).body.data;
    supp = (await c.post('/suppliers', { name: 'Overseas Supplier Ltd' }).expect(201)).body.data;
  });
  afterAll(async () => { await app.close(); });

  it('receipt at a higher rate than the invoice books a realised FX gain and clears the receivable exactly', async () => {
    const inv = await usdInvoice('sales', cust, '1000.00', '3.67', 'STD'); // 1,050.00 USD incl. VAT -> 3,853.50 AED
    expect(inv.currency).toBe('USD');
    expect(await balance(cust.accountId)).toBe('3853.50');
    const r = (await c.post('/sales/receipts', { partyId: cust.id, date: today(), amount: '1050.00', currency: 'USD', exchangeRate: '3.70', accountId: acc['1112'], allocations: [{ documentId: inv.id, amount: '1050.00' }] }).expect(201)).body.data;
    expect(r).toMatchObject({ currency: 'USD', exchangeRate: '3.7', amount: '1050.00', fxAmount: '31.50', unallocated: '0.00' }); // 3,885.00 received - 3,853.50 carried
    expect(await outstanding('sales', inv.id)).toBe('0.00');
    expect(await balance(cust.accountId)).toBe('0.00'); // no residue on the customer ledger
    expect(await bal(acc['4201'])).toMatchObject({ balance: '31.50', balanceSide: 'CR' }); // FX gain
    expect(await balance(acc['1112'])).toBe('503885.00'); // bank got 1,050 USD x 3.70 = 3,885.00 on top of the 500,000 capital
    expect((await tb()).meta.balanced).toBe(true);
  });

  it('cancelling the receipt reverses the voucher and the FX entry; the invoice is open again', async () => {
    const list = (await c.get('/sales/receipts').expect(200)).body.data;
    await c.post(`/sales/receipts/${list[0].id}/cancel`, { reason: 'bounced' }).expect(200);
    expect(await balance(cust.accountId)).toBe('3853.50');
    expect((await bal(acc['4201'])).balance).toBe('0.00');
    const inv = (await c.get('/sales/documents?type=INVOICE').expect(200)).body.data[0];
    expect(await outstanding('sales', inv.id)).toBe('1050.00');
    expect((await tb()).meta.balanced).toBe(true);
    // the invoice can be settled again afterwards (allocation base amounts were released)
    await c.post('/sales/receipts', { partyId: cust.id, date: today(), amount: '1050.00', currency: 'USD', exchangeRate: '3.67', accountId: acc['1112'], allocations: [{ documentId: inv.id, amount: '1050.00' }] }).expect(201);
    expect(await balance(cust.accountId)).toBe('0.00');
    expect((await bal(acc['4201'])).balance).toBe('0.00'); // same rate: no FX
    expect((await tb()).meta.balanced).toBe(true);
  });

  it('part-payments at different rates book a loss each time and the last one clears the exact remainder', async () => {
    const inv = await usdInvoice('sales', cust, '2000.00', '3.67'); // 7,340.00 AED
    const pay = (amount: string, rate: string) => c.post('/sales/receipts', { partyId: cust.id, date: today(), amount, currency: 'USD', exchangeRate: rate, accountId: acc['1112'], allocations: [{ documentId: inv.id, amount }] }).expect(201);
    expect((await pay('500.00', '3.60')).body.data.fxAmount).toBe('-35.00'); // 1,800 received vs 1,835 carried
    expect(await outstanding('sales', inv.id)).toBe('1500.00');
    expect((await pay('1500.00', '3.65')).body.data.fxAmount).toBe('-30.00'); // 5,475 received vs 5,505 carried (remainder)
    expect(await outstanding('sales', inv.id)).toBe('0.00');
    expect(await balance(cust.accountId)).toBe('0.00');
    expect(await bal(acc['5205'])).toMatchObject({ balance: '65.00', balanceSide: 'DR' }); // FX loss
    expect((await tb()).meta.balanced).toBe(true);
  });

  it('rounding: three odd part-payments leave no residue on the ledger', async () => {
    const inv = await usdInvoice('sales', cust, '100.00', '3.6725'); // 367.25 AED
    const pay = (amount: string, rate: string) => c.post('/sales/receipts', { partyId: cust.id, date: today(), amount, currency: 'USD', exchangeRate: rate, accountId: acc['1112'], allocations: [{ documentId: inv.id, amount }] }).expect(201).then((r) => r.body.data.fxAmount);
    expect(await pay('33.33', '3.6725')).toBe('0.00'); // 122.40 vs 122.40
    expect(await pay('33.33', '3.70')).toBe('0.92'); // 123.32 vs 122.40
    expect(await pay('33.34', '3.6725')).toBe('-0.01'); // 122.44 received vs 122.45 remainder
    expect(await outstanding('sales', inv.id)).toBe('0.00');
    expect(await balance(cust.accountId)).toBe('0.00');
    expect((await tb()).meta.balanced).toBe(true);
  });

  it('supplier payments: paying more than carried is a loss, paying less is a gain', async () => {
    const lossBefore = (await bal(acc['5205'])).balance; const gainBefore = (await bal(acc['4201'])).balance;
    const p1 = await usdInvoice('purchases', supp, '1000.00', '3.67'); // 3,670 AED payable
    const p2 = await usdInvoice('purchases', supp, '1000.00', '3.67');
    expect(await balance(supp.accountId)).toBe('-7340.00');
    const r1 = (await c.post('/purchases/payments', { partyId: supp.id, date: today(), amount: '1000.00', currency: 'USD', exchangeRate: '3.70', accountId: acc['1112'], allocations: [{ documentId: p1.id, amount: '1000.00' }] }).expect(201)).body.data;
    expect(r1.fxAmount).toBe('-30.00'); // paid 3,700 vs 3,670 carried
    const r2 = (await c.post('/purchases/payments', { partyId: supp.id, date: today(), amount: '1000.00', currency: 'USD', exchangeRate: '3.60', accountId: acc['1112'], allocations: [{ documentId: p2.id, amount: '1000.00' }] }).expect(201)).body.data;
    expect(r2.fxAmount).toBe('70.00'); // paid 3,600 vs 3,670 carried
    expect(await balance(supp.accountId)).toBe('0.00');
    expect(await outstanding('purchases', p1.id)).toBe('0.00');
    expect(Number((await bal(acc['5205'])).balance) - Number(lossBefore)).toBe(30);
    expect(Number((await bal(acc['4201'])).balance) - Number(gainBefore)).toBe(70);
    await c.post(`/purchases/payments/${r1.id}/cancel`, { reason: 'wrong rate' }).expect(200);
    expect(await outstanding('purchases', p1.id)).toBe('1000.00');
    expect(await balance(supp.accountId)).toBe('-3670.00');
    expect((await tb()).meta.balanced).toBe(true);
  });

  it('settlement currency must match the invoice currency; unknown rates and duplicate allocations are rejected', async () => {
    const usd = await usdInvoice('sales', cust, '100.00', '3.67');
    const base = (await c.post('/sales/documents', { type: 'INVOICE', partyId: cust.id, date: today(), lines: [{ description: 'AED goods', quantity: '1', unitPrice: '100.00', taxCode: 'ZERO' }] }).expect(201)).body.data;
    await c.post(`/sales/documents/${base.id}/post`).expect(200);
    await c.post('/sales/receipts', { partyId: cust.id, date: today(), amount: '100.00', accountId: acc['1112'], allocations: [{ documentId: usd.id, amount: '100.00' }] }).expect(422); // AED vs USD invoice
    await c.post('/sales/receipts', { partyId: cust.id, date: today(), amount: '100.00', currency: 'USD', exchangeRate: '3.67', accountId: acc['1112'], allocations: [{ documentId: base.id, amount: '100.00' }] }).expect(422); // USD vs AED invoice
    await c.post('/sales/receipts', { partyId: cust.id, date: today(), amount: '100.00', currency: 'GBP', accountId: acc['1112'] }).expect(400); // no GBP rate defined
    await c.post('/sales/receipts', { partyId: cust.id, date: today(), amount: '100.00', currency: 'USD', exchangeRate: '3.67', accountId: acc['1112'], allocations: [{ documentId: usd.id, amount: '40.00' }, { documentId: usd.id, amount: '40.00' }] }).expect(400);
    await c.post('/sales/receipts', { partyId: cust.id, date: today(), amount: '200.00', currency: 'USD', exchangeRate: '3.67', accountId: acc['1112'], allocations: [{ documentId: usd.id, amount: '100.01' }] }).expect(422); // over-allocation
    // a credit note in another currency/rate cannot be applied to this invoice (would leave an unposted FX difference)
    const cn = (await c.post('/sales/documents', { type: 'CREDIT_NOTE', partyId: cust.id, date: today(), lines: [{ description: 'Return', quantity: '1', unitPrice: '10.00', taxCode: 'ZERO' }] }).expect(201)).body.data;
    await c.post(`/sales/documents/${cn.id}/post`).expect(200);
    await c.post(`/sales/documents/${cn.id}/apply`, { invoiceId: usd.id, amount: '10.00' }).expect(422);
    await c.post(`/sales/documents/${cn.id}/apply`, { invoiceId: base.id, amount: '10.00' }).expect(200);
    expect((await tb()).meta.balanced).toBe(true);
  });

  it('a foreign receipt without allocations is booked at its own rate (advance) with no FX entry', async () => {
    const fxBefore = [(await bal(acc['4201'])).balance, (await bal(acc['5205'])).balance];
    const before = Number(await balance(cust.accountId));
    const r = (await c.post('/sales/receipts', { partyId: cust.id, date: today(), amount: '100.00', currency: 'USD', exchangeRate: '3.70', accountId: acc['1112'] }).expect(201)).body.data;
    expect(r).toMatchObject({ fxAmount: '0.00', unallocated: '100.00', currency: 'USD' });
    expect(Number(await balance(cust.accountId))).toBeCloseTo(before - 370, 2);
    expect([(await bal(acc['4201'])).balance, (await bal(acc['5205'])).balance]).toEqual(fxBefore);
    expect((await tb()).meta.balanced).toBe(true);
  });

  it('the posting engine journals for FX entries are SYSTEM entries, balanced, linked to the settlement', async () => {
    const list = (await c.get('/sales/receipts?pageSize=100').expect(200)).body.data;
    const withFx = list.find((s: any) => s.status === 'POSTED' && s.fxJournalEntryId);
    expect(withFx).toBeTruthy();
    const je = (await c.get(`/journal-entries/${withFx.fxJournalEntryId}`)).body.data;
    expect(je.sourceType).toBe('SYSTEM');
    const dr = je.lines.reduce((s: number, l: any) => s + Number(l.debit), 0), cr = je.lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(dr).toBe(cr);
  });
});
