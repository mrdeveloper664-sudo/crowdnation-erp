import { Injectable } from '@nestjs/common';
import { DocSide } from '@prisma/client';
import { isoDate } from '../common/dates';
import { D, Decimal, ZERO, fmt, round } from '../common/money';
import { Tx } from '../common/prisma.service';
import { SystemAccountsService } from '../accounting/system-accounts.service';
import { InventoryService } from '../inventory/inventory.service';
import { VouchersService } from '../vouchers/vouchers.service';

/** Connects sales/purchase documents to stock and to the ledger (inventory, COGS, GRNI, price variance). */
@Injectable()
export class InventoryHooks {
  constructor(private inv: InventoryService, private vouchers: VouchersService, private sys: SystemAccountsService) {}

  async productDefaults(tx: Tx, companyId: string, productId: string, side: DocSide) {
    const p = await tx.product.findFirst({ where: { id: productId, companyId } });
    if (!p) return null;
    return { name: p.name, price: (side === 'SALES' ? p.salePrice : p.purchasePrice).toString(), taxCode: p.taxCode, accountId: (side === 'SALES' ? p.incomeAccountId : p.expenseAccountId) ?? undefined };
  }

  private async stockLines(tx: Tx, doc: any) {
    const out: Array<{ line: any; product: any }> = [];
    for (const line of doc.lines) {
      if (!line.productId) continue;
      const product = await tx.product.findUnique({ where: { id: line.productId } });
      if (product?.trackInventory) out.push({ line, product });
    }
    return out;
  }

  private async inventoryAccount(tx: Tx, companyId: string, product: any) {
    return product.inventoryAccountId ?? (await this.sys.get(tx, companyId, 'INVENTORY'));
  }

  private async warehouseFor(tx: Tx, companyId: string, doc: any, line: any) {
    return line.warehouseId ?? doc.warehouseId ?? (await this.inv.defaultWarehouse(tx, companyId)).id;
  }

  /** Balanced auto-journal through the normal voucher engine; tagged so it can be reversed with its source. */
  private async autoJournal(tx: Tx, companyId: string, userId: string, doc: any, tag: string, lines: Array<{ accountId: string; debit?: Decimal; credit?: Decimal }>, narration: string) {
    const clean = lines.filter((l) => (l.debit && l.debit.gt(0)) || (l.credit && l.credit.gt(0)));
    if (clean.length < 2) return;
    const v = await this.vouchers.create(companyId, userId, {
      type: 'JOURNAL', date: isoDate(doc.docDate), reference: `AUTO:${doc.id}:${tag}`, narration: `${narration} ${doc.number}`,
      lines: clean.map((l) => ({ accountId: l.accountId, debit: l.debit?.gt(0) ? l.debit.toString() : undefined, credit: l.credit?.gt(0) ? l.credit.toString() : undefined })),
    }, undefined, tx);
    await this.vouchers.post(companyId, userId, v.id, tx);
  }

  private async linkedGrnLine(tx: Tx, line: any) {
    if (!line.sourceLineId) return null;
    const src = await tx.documentLine.findUnique({ where: { id: line.sourceLineId } });
    if (!src) return null;
    const d = await tx.document.findUnique({ where: { id: src.documentId } });
    return d?.type === 'GRN' ? { src, doc: d } : null;
  }

  // GRN confirmation = goods received into stock: Dr Inventory, Cr Goods Received Not Invoiced
  async receiveGrn(tx: Tx, companyId: string, userId: string, doc: any) {
    const grni = await this.sys.get(tx, companyId, 'GRNI');
    const dr = new Map<string, Decimal>(); let total = ZERO;
    for (const { line, product } of await this.stockLines(tx, doc)) {
      const cost = round(line.net.mul(doc.exchangeRate), 2);
      await this.inv.receive(tx, { companyId, userId, productId: product.id, warehouseId: await this.warehouseFor(tx, companyId, doc, line), qty: line.quantity, totalCost: cost, date: doc.docDate, type: 'RECEIPT', batchNo: line.batchNo, serialNos: line.serialNos, sourceType: 'DOC', sourceId: doc.id });
      await tx.documentLine.update({ where: { id: line.id }, data: { receivedQty: line.quantity } });
      const acct = await this.inventoryAccount(tx, companyId, product);
      dr.set(acct, (dr.get(acct) ?? ZERO).add(cost)); total = total.add(cost);
    }
    await this.autoJournal(tx, companyId, userId, doc, 'GRN', [...[...dr].map(([accountId, debit]) => ({ accountId, debit })), { accountId: grni, credit: total }], 'Goods received');
  }

  async postingLines(tx: Tx, companyId: string, _userId: string, doc: any) {
    const overrides = new Map<string, string>();
    if (doc.side !== 'PURCHASE') return { overrides };
    for (const { line, product } of await this.stockLines(tx, doc)) {
      if (doc.type === 'INVOICE' && (await this.linkedGrnLine(tx, line))) overrides.set(line.id, await this.sys.get(tx, companyId, 'GRNI'));
      else overrides.set(line.id, await this.inventoryAccount(tx, companyId, product));
    }
    return { overrides };
  }

  async afterPost(tx: Tx, companyId: string, userId: string, doc: any, _voucherId: string) {
    const stock = await this.stockLines(tx, doc);
    if (!stock.length) return;
    const ppv = async () => this.sys.get(tx, companyId, 'PPV');
    if (doc.side === 'PURCHASE' && doc.type === 'INVOICE') {
      let variance = ZERO; // positive: goods were received at a higher cost than invoiced
      for (const { line, product } of stock) {
        const invCost = round(line.net.mul(doc.exchangeRate), 2);
        const grn = await this.linkedGrnLine(tx, line);
        if (grn) { const grnCost = round(grn.src.net.mul(grn.doc.exchangeRate).mul(line.quantity).div(grn.src.quantity), 2); variance = variance.add(grnCost.sub(invCost)); }
        else await this.inv.receive(tx, { companyId, userId, productId: product.id, warehouseId: await this.warehouseFor(tx, companyId, doc, line), qty: line.quantity, totalCost: invCost, date: doc.docDate, type: 'RECEIPT', batchNo: line.batchNo, serialNos: line.serialNos, sourceType: 'DOC', sourceId: doc.id });
      }
      if (!variance.isZero()) {
        const grni = await this.sys.get(tx, companyId, 'GRNI'), p = await ppv();
        await this.autoJournal(tx, companyId, userId, doc, 'PPV', variance.gt(0) ? [{ accountId: grni, debit: variance }, { accountId: p, credit: variance }] : [{ accountId: p, debit: variance.abs() }, { accountId: grni, credit: variance.abs() }], 'Price variance');
      }
    } else if (doc.side === 'PURCHASE' && doc.type === 'DEBIT_NOTE') { // purchase return
      let diff = ZERO; const invAcct = new Map<string, Decimal>();
      for (const { line, product } of stock) {
        const m = await this.inv.issue(tx, { companyId, userId, productId: product.id, warehouseId: await this.warehouseFor(tx, companyId, doc, line), qty: line.quantity, date: doc.docDate, type: 'RETURN_OUT', batchNo: line.batchNo, serialNos: line.serialNos, sourceType: 'DOC', sourceId: doc.id });
        if (m) diff = diff.add(round(line.net.mul(doc.exchangeRate), 2).sub(m.totalCost.neg()));
        void invAcct;
      }
      if (!diff.isZero()) { const i = await this.sys.get(tx, companyId, 'INVENTORY'), p = await ppv(); await this.autoJournal(tx, companyId, userId, doc, 'PPV', diff.gt(0) ? [{ accountId: i, debit: diff }, { accountId: p, credit: diff }] : [{ accountId: p, debit: diff.abs() }, { accountId: i, credit: diff.abs() }], 'Return price variance'); }
    } else if (doc.side === 'SALES' && doc.type === 'INVOICE') {
      const cogs = await this.sys.get(tx, companyId, 'COGS'); const cr = new Map<string, Decimal>(); let total = ZERO;
      for (const { line, product } of stock) {
        const m = await this.inv.issue(tx, { companyId, userId, productId: product.id, warehouseId: await this.warehouseFor(tx, companyId, doc, line), qty: line.quantity, date: doc.docDate, type: 'ISSUE', batchNo: line.batchNo, serialNos: line.serialNos, sourceType: 'DOC', sourceId: doc.id });
        if (!m) continue;
        const cost = m.totalCost.neg(); const a = await this.inventoryAccount(tx, companyId, product);
        cr.set(a, (cr.get(a) ?? ZERO).add(cost)); total = total.add(cost);
      }
      await this.autoJournal(tx, companyId, userId, doc, 'COGS', [{ accountId: cogs, debit: total }, ...[...cr].map(([accountId, credit]) => ({ accountId, credit }))], 'Cost of goods sold');
    } else if (doc.side === 'SALES' && doc.type === 'CREDIT_NOTE') { // sales return: stock back at the original cost
      const cogs = await this.sys.get(tx, companyId, 'COGS'); const dr = new Map<string, Decimal>(); let total = ZERO;
      for (const { line, product } of stock) {
        let unit: Decimal | null = null;
        if (doc.sourceDocId) {
          const sold = await tx.stockMovement.findMany({ where: { sourceType: 'DOC', sourceId: doc.sourceDocId, productId: product.id, quantity: { lt: 0 }, reversalOfId: null } });
          const q = sold.reduce((s, x) => s.add(x.quantity.abs()), ZERO);
          if (q.gt(0)) unit = sold.reduce((s, x) => s.add(x.totalCost.abs()), ZERO).div(q);
        }
        if (!unit) { const oh = await this.inv.onHand(tx, product.id); unit = oh.qty.gt(0) ? oh.value.div(oh.qty) : product.purchasePrice; }
        const cost = round(unit!.mul(line.quantity), 2);
        await this.inv.receive(tx, { companyId, userId, productId: product.id, warehouseId: await this.warehouseFor(tx, companyId, doc, line), qty: line.quantity, totalCost: cost, date: doc.docDate, type: 'RETURN_IN', batchNo: line.batchNo, serialNos: line.serialNos, sourceType: 'DOC', sourceId: doc.id });
        const a = await this.inventoryAccount(tx, companyId, product); dr.set(a, (dr.get(a) ?? ZERO).add(cost)); total = total.add(cost);
      }
      await this.autoJournal(tx, companyId, userId, doc, 'COGS', [...[...dr].map(([accountId, debit]) => ({ accountId, debit })), { accountId: cogs, credit: total }], 'Cost reversal on return');
    }
  }

  /** Cancelling a document: reverse its stock movements, serial states and helper journals. */
  async reverse(tx: Tx, companyId: string, userId: string, doc: any) {
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const date = today > doc.docDate ? today : doc.docDate;
    // serials: reverse the state change made by this document
    for (const { line, product } of await this.stockLines(tx, doc)) {
      if (!product.trackSerial || !line.serialNos?.length) continue;
      const inbound = (doc.side === 'PURCHASE' && ['INVOICE', 'GRN'].includes(doc.type)) || (doc.side === 'SALES' && doc.type === 'CREDIT_NOTE');
      for (const sn of line.serialNos) {
        const s = await tx.stockSerial.findUnique({ where: { companyId_productId_serialNo: { companyId, productId: product.id, serialNo: sn } } });
        if (!s) continue;
        if (inbound) { if (s.status !== 'IN_STOCK') throw new Error(`Serial ${sn} has already left stock`); await tx.stockSerial.update({ where: { id: s.id }, data: { status: 'OUT' } }); }
        else await tx.stockSerial.update({ where: { id: s.id }, data: { status: 'IN_STOCK', warehouseId: await this.warehouseFor(tx, companyId, doc, line) } });
      }
    }
    await this.inv.reverseSource(tx, companyId, userId, 'DOC', doc.id, date);
    const autos = await tx.voucher.findMany({ where: { companyId, reference: { startsWith: `AUTO:${doc.id}:` }, status: 'POSTED' } });
    for (const v of autos) await this.vouchers.cancel(companyId, userId, v.id, `Cancelled with ${doc.number}`, undefined, tx);
  }
}
