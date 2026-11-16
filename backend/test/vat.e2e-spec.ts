import { INestApplication } from '@nestjs/common';
import { Tenant, accountMap, api, createApp, registerAndLogin, today } from './helpers';

describe('UAE VAT (e2e)', () => {
  let app: INestApplication; let T: Tenant; let acc: Record<string, string>; let c: ReturnType<typeof api>; let rates: Record<string, string>;
  const AR = '1121', SALES = '4101', VOUT = '2121', VIN = '1141', PURCH = '5101', AP = '2111';

  beforeAll(async () => {
    ({ app } = await createApp());
    T = await registerAndLogin(app, 'Vat Co'); c = api(app, T.token); acc = await accountMap(app, T.token);
    const r = (await c.get('/vat/rates').expect(200)).body.data;
    rates = Object.fromEntries(r.map((x: any) => [x.code, x.id]));
  });
  afterAll(async () => { await app.close(); });

  const post = async (type: string, lines: any[]) => {
    const v = await c.post('/vouchers', { type, date: today(), lines }).expect(201);
    await c.post(`/vouchers/${v.body.data.id}/post`).expect(200);
    return v.body.data.id as string;
  };
  const ret = async () => (await c.get(`/vat/return?from=${today().slice(0, 4)}-01-01&to=${today().slice(0, 4)}-12-31`).expect(200)).body.data;

  it('ships the four UAE tax treatments with standard rate 5%', () => {
    expect(Object.keys(rates).sort()).toEqual(['EXEMPT', 'OOS', 'STD', 'ZERO']);
  });

  it('calculates VAT inclusive and exclusive from configured rates', async () => {
    const ex = (await c.post('/vat/calculate', { code: 'STD', date: today(), amount: '200.00', inclusive: false }).expect(201)).body.data;
    expect([ex.net, ex.vat, ex.gross]).toEqual(['200.00', '10.00', '210.00']);
    const inc = (await c.post('/vat/calculate', { code: 'STD', date: today(), amount: '210.00', inclusive: true }).expect(201)).body.data;
    expect([inc.net, inc.vat]).toEqual(['200.00', '10.00']);
  });

  it('records output VAT from a sales voucher and rejects a wrong VAT amount', async () => {
    await c.post('/vouchers', { type: 'SALES', date: today(), lines: [
      { accountId: acc[AR], debit: '1100.00' }, { accountId: acc[SALES], credit: '1000.00' }, { accountId: acc[VOUT], credit: '100.00', taxRateId: rates.STD, taxableAmount: '1000.00' },
    ] }).expect(422); // 100 is not 5% of 1000
    await post('SALES', [
      { accountId: acc[AR], debit: '1050.00' }, { accountId: acc[SALES], credit: '1000.00' }, { accountId: acc[VOUT], credit: '50.00', taxRateId: rates.STD, taxableAmount: '1000.00' },
    ]);
    const r = await ret();
    expect(r.outputs.find((b: any) => b.box === '1b')).toMatchObject({ amount: '1000.00', vat: '50.00' });
  });

  it('zero-rated, exempt supplies and input VAT show in the right boxes', async () => {
    await post('SALES', [{ accountId: acc[AR], debit: '400.00' }, { accountId: acc[SALES], credit: '400.00' }, { accountId: acc[VOUT], taxRateId: rates.ZERO, taxableAmount: '400.00' }]);
    await post('SALES', [{ accountId: acc[AR], debit: '60.00' }, { accountId: acc[SALES], credit: '60.00' }, { accountId: acc[VOUT], taxRateId: rates.EXEMPT, taxableAmount: '60.00' }]);
    await post('PURCHASE', [{ accountId: acc[PURCH], debit: '600.00' }, { accountId: acc[VIN], debit: '30.00', taxRateId: rates.STD, taxableAmount: '600.00' }, { accountId: acc[AP], credit: '630.00' }]);
    const r = await ret();
    expect(r.outputs.find((b: any) => b.box === '4').amount).toBe('400.00');
    expect(r.outputs.find((b: any) => b.box === '5').amount).toBe('60.00');
    expect(r.inputs.find((b: any) => b.box === '9')).toMatchObject({ amount: '600.00', vat: '30.00' });
    expect(r.summary).toMatchObject({ totalVatDue: '50.00', recoverableVat: '30.00', netVatDue: '20.00', position: 'PAYABLE' });
  });

  it('VAT credit note reduces output VAT; cancelling a posted voucher reverses its VAT', async () => {
    await post('CREDIT_NOTE', [{ accountId: acc[SALES], debit: '200.00' }, { accountId: acc[VOUT], debit: '10.00', taxRateId: rates.STD, taxableAmount: '200.00' }, { accountId: acc[AR], credit: '210.00' }]);
    let r = await ret();
    expect(r.summary.totalVatDue).toBe('40.00');
    const id = await post('SALES', [{ accountId: acc[AR], debit: '105.00' }, { accountId: acc[SALES], credit: '100.00' }, { accountId: acc[VOUT], credit: '5.00', taxRateId: rates.STD, taxableAmount: '100.00' }]);
    expect((await ret()).summary.totalVatDue).toBe('45.00');
    await c.post(`/vouchers/${id}/cancel`, { reason: 'duplicate' }).expect(200);
    r = await ret();
    expect(r.summary.totalVatDue).toBe('40.00');
  });

  it('VAT adjustment through a journal voucher is flagged as adjustment', async () => {
    await post('JOURNAL', [{ accountId: acc[VOUT], credit: '7.00', taxRateId: rates.STD, taxableAmount: '140.00' }, { accountId: acc['5207'], debit: '7.00' }]);
    const r = await ret();
    expect(r.outputs.find((b: any) => b.box === '1b').adjustment).toBe('7.00');
  });

  it('supports rate changes by effective date (no hard-coded 5%)', async () => {
    const y = Number(today().slice(0, 4)) + 1;
    await c.post('/vat/rates', { code: 'STD', name: 'Standard 7.5%', treatment: 'STANDARD', rate: '7.5', effectiveFrom: `${y}-01-01` }).expect(201);
    const old = (await c.post('/vat/calculate', { code: 'STD', date: today(), amount: '100', inclusive: false }).expect(201)).body.data;
    const nu = (await c.post('/vat/calculate', { code: 'STD', date: `${y}-02-01`, amount: '100', inclusive: false }).expect(201)).body.data;
    expect(old.vat).toBe('5.00');
    expect(nu.vat).toBe('7.50');
  });
});
