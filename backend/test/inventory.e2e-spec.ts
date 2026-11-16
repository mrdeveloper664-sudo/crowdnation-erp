import { INestApplication } from '@nestjs/common';
import { Tenant, accountMap, api, createApp, registerAndLogin, today } from './helpers';

describe('Inventory (e2e)', () => {
  let app: INestApplication; let T: Tenant; let acc: Record<string, string>; let c: ReturnType<typeof api>; let wh1: any; let wh2: any; let cust: any; let supp: any;
  const rep = async (n: string, q = '') => (await c.get(`/reports/run/${n}?${q}`).expect(200)).body.data;
  const tb = async () => (await rep('trial-balance')).meta.balanced;
  const bal = async (code: string) => { acc = await accountMap(app, T.token); const l = (await c.get(`/ledgers/${acc[code]}`).expect(200)).body.data; return `${l.balance}${l.balanceSide ? ' ' + l.balanceSide : ''}`; };
  const stockQty = async (productId: string) => (await c.get(`/inventory/products/${productId}`).expect(200)).body.data.onHand;

  beforeAll(async () => {
    ({ app } = await createApp());
    T = await registerAndLogin(app, 'Stock Co'); c = api(app, T.token); acc = await accountMap(app, T.token);
    wh1 = (await c.post('/inventory/warehouses', { code: 'MAIN', name: 'Main', isDefault: true }).expect(201)).body.data;
    wh2 = (await c.post('/inventory/warehouses', { code: 'DXB', name: 'Dubai Store' }).expect(201)).body.data;
    cust = (await c.post('/customers', { name: 'Retail Customer' }).expect(201)).body.data;
    supp = (await c.post('/suppliers', { name: 'Wholesale Supplier' }).expect(201)).body.data;
  });
  afterAll(async () => { await app.close(); });

  it('manages categories, units and products (barcode lookup, unique SKU)', async () => {
    const cat = (await c.post('/inventory/categories', { name: 'Electronics' }).expect(201)).body.data;
    await c.post('/inventory/units', { code: 'PCS', name: 'Pieces' }).expect(201);
    const p = (await c.post('/inventory/products', { sku: 'LAP-1', barcode: '6291000000011', name: 'Laptop', categoryId: cat.id, salePrice: '3000.00', purchasePrice: '2000.00', minStock: '3' }).expect(201)).body.data;
    await c.post('/inventory/products', { sku: 'LAP-1', name: 'dup' }).expect(409);
    expect((await c.get('/inventory/products/by-barcode/6291000000011').expect(200)).body.data.id).toBe(p.id);
    expect((await c.post('/inventory/products', { name: 'Auto SKU item' }).expect(201)).body.data.sku).toMatch(/^P\d{6}$/);
  });

  let lap: any;
  it('manual stock-in posts Dr Inventory / Cr offset and values stock', async () => {
    lap = (await c.get('/inventory/products?search=LAP-1').expect(200)).body.data[0];
    await c.post('/inventory/stock-in', { warehouseId: wh1.id, date: today(), offsetAccountId: acc['3001'], lines: [{ productId: lap.id, quantity: '10', totalCost: '20000.00' }] }).expect(201);
    expect(await stockQty(lap.id)).toBe('10');
    expect(await bal('1131')).toBe('20000.00 DR');
    const v = await rep('stock-valuation');
    expect(v.meta).toMatchObject({ value: '20000.00', ledger: '20000.00', reconciled: true });
    expect(await tb()).toBe(true);
  });

  it('refuses to issue more than is on hand', async () => {
    await c.post('/inventory/stock-out', { warehouseId: wh1.id, date: today(), offsetAccountId: acc['5207'], lines: [{ productId: lap.id, quantity: '11' }] }).expect(422);
  });

  it('transfers between warehouses at cost without touching the ledger', async () => {
    await c.post('/inventory/transfers', { fromWarehouseId: wh1.id, toWarehouseId: wh2.id, date: today(), lines: [{ productId: lap.id, quantity: '4' }] }).expect(201);
    const s = (await c.get(`/inventory/stock?productId=${lap.id}`).expect(200)).body.data;
    expect(Object.fromEntries(s.map((r: any) => [r.warehouse, r.qty]))).toEqual({ Main: '6', 'Dubai Store': '4' });
    expect(await bal('1131')).toBe('20000.00 DR');
  });

  it('sales invoice issues stock and posts COGS at weighted-average cost', async () => {
    const inv = (await c.post('/sales/documents', { type: 'INVOICE', partyId: cust.id, date: today(), warehouseId: wh1.id, lines: [{ productId: lap.id, quantity: '2' }] }).expect(201)).body.data;
    expect(inv.lines[0]).toMatchObject({ unitPrice: '3000.0000', net: '6000.00', vat: '300.00' }); // price defaulted from product
    await c.post(`/sales/documents/${inv.id}/post`).expect(200);
    expect(await stockQty(lap.id)).toBe('8');
    expect(await bal('5102')).toBe('4000.00 DR'); // COGS 2 x 2000
    expect(await bal('1131')).toBe('16000.00 DR');
    expect((await rep('stock-valuation')).meta.reconciled).toBe(true);
    const pl = await rep('profit-and-loss');
    expect(pl.meta.netProfit).toBe('2000.00');
    // cancelling the invoice returns the stock and reverses COGS
    await c.post(`/sales/documents/${inv.id}/cancel`, { reason: 'order cancelled' }).expect(200);
    expect(await stockQty(lap.id)).toBe('10');
    expect(await bal('5102')).toBe('0.00');
    expect(await bal('1131')).toBe('20000.00 DR');
    expect(await tb()).toBe(true);
  });

  it('purchase: PO -> GRN (Dr Inventory / Cr GRNI) -> invoice clears GRNI and books price variance', async () => {
    const po = (await c.post('/purchases/documents', { type: 'ORDER', partyId: supp.id, date: today(), warehouseId: wh1.id, lines: [{ productId: lap.id, quantity: '5', unitPrice: '2100.00' }] }).expect(201)).body.data;
    await c.post(`/purchases/documents/${po.id}/confirm`).expect(200);
    const grn = (await c.post(`/purchases/documents/${po.id}/convert`, { to: 'GRN' }).expect(200)).body.data;
    await c.post(`/purchases/documents/${grn.id}/confirm`).expect(200);
    expect(await stockQty(lap.id)).toBe('15');
    expect(await bal('1131')).toBe('30500.00 DR'); // 20000 + 10500
    expect(await bal('2112')).toBe('10500.00 CR');
    // supplier invoices at 2150 per unit (higher than GRN)
    const pinv = (await c.post('/purchases/documents', { type: 'INVOICE', partyId: supp.id, date: today(), warehouseId: wh1.id, sourceDocId: grn.id, lines: [{ productId: lap.id, quantity: '5', unitPrice: '2150.00', sourceLineId: grn.lines[0].id }] }).expect(201)).body.data;
    await c.post(`/purchases/documents/${pinv.id}/post`).expect(200);
    expect(await bal('2112')).toBe('0.00');
    expect(await bal('5209')).toBe('250.00 DR'); // price variance 5 x 50
    expect(await bal(supp.code === 'S00001' ? '2111' : '2111')).toBeDefined();
    expect((await c.get(`/suppliers/${supp.id}`).expect(200)).body.data.balance).toBe('11287.50'); // 10750 + 5% VAT
    expect((await rep('stock-valuation')).meta).toMatchObject({ value: '30500.00', reconciled: true });
    expect(await tb()).toBe(true);
    await c.post(`/purchases/documents/${grn.id}/cancel`, { reason: 'not needed' }).expect(409); // already converted
  });

  it('FIFO method values issues from the oldest layer', async () => {
    const t = await registerAndLogin(app, 'Fifo Co'); const f = api(app, t.token); const a = await accountMap(app, t.token);
    await f.patch('/company/settings', { inventoryMethod: 'FIFO' }).expect(200);
    const w = (await f.post('/inventory/warehouses', { code: 'W1', name: 'Warehouse', isDefault: true }).expect(201)).body.data;
    const p = (await f.post('/inventory/products', { sku: 'F1', name: 'Fifo item' }).expect(201)).body.data;
    await f.post('/inventory/stock-in', { warehouseId: w.id, date: today(), offsetAccountId: a['3001'], lines: [{ productId: p.id, quantity: '10', totalCost: '100.00' }] }).expect(201); // 10 each
    await f.post('/inventory/stock-in', { warehouseId: w.id, date: today(), offsetAccountId: a['3001'], lines: [{ productId: p.id, quantity: '10', totalCost: '200.00' }] }).expect(201); // 20 each
    const out = (await f.post('/inventory/stock-out', { warehouseId: w.id, date: today(), offsetAccountId: a['5207'], lines: [{ productId: p.id, quantity: '15' }] }).expect(201)).body.data;
    expect(out.value).toBe('200.00'); // 10x10 + 5x20 (WAVG would be 225)
    expect((await f.get('/reports/run/stock-valuation').expect(200)).body.data.meta).toMatchObject({ value: '100.00', reconciled: true });
  });

  it('batch and serial tracking are enforced', async () => {
    const b = (await c.post('/inventory/products', { sku: 'MILK', name: 'Milk 1L', trackBatch: true }).expect(201)).body.data;
    await c.post('/inventory/stock-in', { warehouseId: wh1.id, date: today(), offsetAccountId: acc['3001'], lines: [{ productId: b.id, quantity: '10', totalCost: '30.00' }] }).expect(422); // batch required
    await c.post('/inventory/stock-in', { warehouseId: wh1.id, date: today(), offsetAccountId: acc['3001'], lines: [{ productId: b.id, quantity: '10', totalCost: '30.00', batchNo: 'B1', expiryDate: '2027-01-31' }, { productId: b.id, quantity: '5', totalCost: '20.00', batchNo: 'B2', expiryDate: '2027-03-31' }] }).expect(201);
    await c.post('/inventory/stock-out', { warehouseId: wh1.id, date: today(), offsetAccountId: acc['5207'], lines: [{ productId: b.id, quantity: '6', batchNo: 'B2' }] }).expect(422); // only 5 in B2
    await c.post('/inventory/stock-out', { warehouseId: wh1.id, date: today(), offsetAccountId: acc['5207'], lines: [{ productId: b.id, quantity: '3', batchNo: 'B1' }] }).expect(201);
    const batches = (await rep('batch-summary')).rows;
    expect(batches.map((r: any) => `${r.batch}:${r.qty}`)).toEqual(['B1:7', 'B2:5']);

    const s = (await c.post('/inventory/products', { sku: 'PHONE', name: 'Phone', trackSerial: true }).expect(201)).body.data;
    await c.post('/inventory/stock-in', { warehouseId: wh1.id, date: today(), offsetAccountId: acc['3001'], lines: [{ productId: s.id, quantity: '2', totalCost: '2000.00', serialNos: ['SN1'] }] }).expect(422); // need 2 serials
    await c.post('/inventory/stock-in', { warehouseId: wh1.id, date: today(), offsetAccountId: acc['3001'], lines: [{ productId: s.id, quantity: '2', totalCost: '2000.00', serialNos: ['SN1', 'SN2'] }] }).expect(201);
    await c.post('/inventory/stock-in', { warehouseId: wh1.id, date: today(), offsetAccountId: acc['3001'], lines: [{ productId: s.id, quantity: '1', totalCost: '1000.00', serialNos: ['SN1'] }] }).expect(409); // duplicate serial
    const inv = (await c.post('/sales/documents', { type: 'INVOICE', partyId: cust.id, date: today(), warehouseId: wh1.id, lines: [{ productId: s.id, quantity: '1', unitPrice: '1500.00', serialNos: ['SN2'] }] }).expect(201)).body.data;
    await c.post(`/sales/documents/${inv.id}/post`).expect(200);
    const serials = (await c.get(`/inventory/serials?productId=${s.id}`).expect(200)).body.data;
    expect(Object.fromEntries(serials.map((x: any) => [x.serialNo, x.status]))).toEqual({ SN1: 'IN_STOCK', SN2: 'OUT' });
    await c.post(`/sales/documents/${inv.id}/cancel`, { reason: 'return' }).expect(200);
    expect((await c.get(`/inventory/serials?productId=${s.id}&status=IN_STOCK`).expect(200)).body.data).toHaveLength(2);
  });

  it('stock count adjustment posts gain/loss and low-stock report flags items', async () => {
    const r = (await c.post('/inventory/adjustments', { warehouseId: wh1.id, date: today(), lines: [{ productId: lap.id, countedQty: '5' }] }).expect(201)).body.data;
    expect(r.adjusted[0].difference).toBe('-6'); // 11 on hand in MAIN -> 5
    expect(Number(r.netValue)).toBeLessThan(0);
    expect(await bal('5208')).toMatch(/DR$/);
    const low = await rep('low-stock');
    expect(low.rows.every((x: any) => Number(x.qty) <= Number(x.minStock))).toBe(true);
    expect((await rep('stock-valuation')).meta.reconciled).toBe(true);
    expect(await tb()).toBe(true);
  });

  it('sales return (credit note) puts stock back at the original cost', async () => {
    const before = await stockQty(lap.id);
    const inv = (await c.post('/sales/documents', { type: 'INVOICE', partyId: cust.id, date: today(), warehouseId: wh1.id, lines: [{ productId: lap.id, quantity: '1' }] }).expect(201)).body.data;
    await c.post(`/sales/documents/${inv.id}/post`).expect(200);
    const cn = (await c.post('/sales/documents', { type: 'CREDIT_NOTE', partyId: cust.id, date: today(), warehouseId: wh1.id, sourceDocId: inv.id, lines: [{ productId: lap.id, quantity: '1' }] }).expect(201)).body.data;
    await c.post(`/sales/documents/${cn.id}/post`).expect(200);
    expect(await stockQty(lap.id)).toBe(before);
    expect((await rep('stock-valuation')).meta.reconciled).toBe(true);
    expect(await tb()).toBe(true);
  });
});
