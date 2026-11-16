import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isoDate, parseDate } from '../common/dates';
import { D, ZERO, fmt } from '../common/money';
import { Tx } from '../common/prisma.service';
import { ReportQuery, ReportResult } from '../reports/report.types';
import { InventoryService } from './inventory.service';

@Injectable()
export class InventoryReports {
  constructor(private inv: InventoryService) {}

  async run(tx: Tx, companyId: string, name: string, q: ReportQuery & { productId?: string }): Promise<ReportResult> {
    const asOf = q.asOf ? parseDate(q.asOf, 'asOf') : undefined;
    const sub = `As of ${q.asOf ?? 'today'}`;
    if (name === 'stock-summary' || name === 'stock-valuation' || name === 'low-stock') {
      let rows = await this.inv.stockRows(tx, companyId, { asOf, warehouseId: (q as any).warehouseId });
      if (name === 'low-stock') {
        // aggregate per product across warehouses
        const per = new Map<string, any>();
        for (const r of rows) { const x = per.get(r.productId) ?? { ...r, qty: ZERO, value: ZERO }; x.qty = x.qty.add(D(r.qty)); x.value = x.value.add(D(r.value)); per.set(r.productId, x); }
        const prods = await tx.product.findMany({ where: { companyId, trackInventory: true, isActive: true, minStock: { gt: 0 } } });
        const body = prods.map((p) => ({ p, qty: per.get(p.id)?.qty ?? ZERO })).filter((x) => x.qty.lte(x.p.minStock)).map((x) => ({ sku: x.p.sku, name: x.p.name, qty: x.qty.toString(), minStock: x.p.minStock.toString(), shortfall: x.p.minStock.sub(x.qty).toString(), reorderQty: x.p.reorderQty?.toString() ?? '' }));
        return { name, title: 'Low Stock Report', subtitle: sub, rows: body, columns: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product' }, { key: 'qty', label: 'On hand', align: 'right' }, { key: 'minStock', label: 'Minimum', align: 'right' }, { key: 'shortfall', label: 'Shortfall', align: 'right' }, { key: 'reorderQty', label: 'Reorder qty', align: 'right' }] };
      }
      let totalQty = ZERO, totalVal = ZERO;
      const body = rows.map((r) => { const q2 = D(r.qty), v = D(r.value); totalQty = totalQty.add(q2); totalVal = totalVal.add(v); return { sku: r.sku, name: r.name, category: r.category ?? '', warehouse: r.warehouse, qty: q2.toString(), avgCost: q2.isZero() ? '0.00' : fmt(v.div(q2), 4), value: fmt(v) }; });
      const gl = await tx.$queryRaw<{ net: Prisma.Decimal }[]>`
        SELECT COALESCE(SUM(l.debit - l.credit),0) AS net FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.company_id = ${companyId}::uuid AND a.type = 'INVENTORY' ${asOf ? Prisma.sql`AND e.entry_date <= ${asOf}` : Prisma.empty}`;
      const glBal = D(gl[0].net);
      body.push({ sku: '', name: 'TOTAL', category: '', warehouse: '', qty: totalQty.toString(), avgCost: '', value: fmt(totalVal), _kind: 'total' } as any);
      return {
        name, title: name === 'stock-valuation' ? 'Stock Valuation' : 'Stock Summary', subtitle: sub, rows: body,
        columns: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product' }, { key: 'category', label: 'Category' }, { key: 'warehouse', label: 'Warehouse' }, { key: 'qty', label: 'Quantity', align: 'right' }, { key: 'avgCost', label: 'Avg cost', align: 'right', type: 'money' }, { key: 'value', label: 'Value', align: 'right', type: 'money' }],
        summary: [{ label: 'Stock value', value: fmt(totalVal) }, { label: 'Inventory ledger balance', value: fmt(glBal) }, { label: 'Difference', value: fmt(totalVal.sub(glBal)) }],
        meta: { value: fmt(totalVal), ledger: fmt(glBal), reconciled: totalVal.eq(glBal) },
      };
    }
    if (name === 'stock-movements') {
      const r = await tx.stockMovement.findMany({ where: { companyId, ...(q.productId ? { productId: q.productId } : {}), ...(q.from || q.to ? { movementDate: { ...(q.from ? { gte: parseDate(q.from) } : {}), ...(q.to ? { lte: parseDate(q.to) } : {}) } } : {}) }, orderBy: [{ movementDate: 'asc' }, { createdAt: 'asc' }], take: 2000 });
      const prods = new Map((await tx.product.findMany({ where: { companyId } })).map((p) => [p.id, p]));
      return { name, title: 'Stock Movements', subtitle: `${q.from ?? 'start'} to ${q.to ?? 'date'}`, rows: r.map((m) => ({ date: isoDate(m.movementDate), sku: prods.get(m.productId)?.sku, name: prods.get(m.productId)?.name, type: m.type, batch: m.batchNo ?? '', qty: m.quantity.toString(), value: fmt(m.totalCost) })),
        columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product' }, { key: 'type', label: 'Type' }, { key: 'batch', label: 'Batch' }, { key: 'qty', label: 'Qty', align: 'right' }, { key: 'value', label: 'Value', align: 'right', type: 'money' }] };
    }
    // batch-summary
    const b = await tx.$queryRaw<any[]>`
      SELECT p.sku, p.name, m.batch_no, MIN(m.expiry_date) AS expiry, SUM(m.quantity) AS qty FROM stock_movements m JOIN products p ON p.id = m.product_id
      WHERE m.company_id = ${companyId}::uuid AND m.batch_no IS NOT NULL ${asOf ? Prisma.sql`AND m.movement_date <= ${asOf}` : Prisma.empty}
      GROUP BY p.sku, p.name, m.batch_no HAVING SUM(m.quantity) <> 0 ORDER BY MIN(m.expiry_date) NULLS LAST, p.sku`;
    return { name: 'batch-summary', title: 'Batch Summary', subtitle: sub, rows: b.map((x) => ({ sku: x.sku, name: x.name, batch: x.batch_no, expiry: x.expiry ? isoDate(x.expiry) : '', qty: D(x.qty).toString() })),
      columns: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product' }, { key: 'batch', label: 'Batch' }, { key: 'expiry', label: 'Expiry', type: 'date' }, { key: 'qty', label: 'Quantity', align: 'right' }] };
  }
}
