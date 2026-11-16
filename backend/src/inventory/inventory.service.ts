import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { D, Decimal, ZERO, round } from '../common/money';
import { Tx } from '../common/prisma.service';

export interface ReceiveParams {
  companyId: string; userId: string; productId: string; warehouseId: string; qty: Decimal; totalCost: Decimal; date: Date; type: MovementType;
  batchNo?: string | null; expiryDate?: Date | null; serialNos?: string[]; sourceType?: string; sourceId?: string; note?: string;
}
export interface IssueParams {
  companyId: string; userId: string; productId: string; warehouseId: string; qty: Decimal; date: Date; type: MovementType;
  batchNo?: string | null; serialNos?: string[]; sourceType?: string; sourceId?: string; note?: string;
}

/** Stock engine: movements are the single source of truth; balances and valuation are always derived from them. */
@Injectable()
export class InventoryService {
  async product(tx: Tx, companyId: string, productId: string) {
    const p = await tx.product.findFirst({ where: { id: productId, companyId } });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  async defaultWarehouse(tx: Tx, companyId: string) {
    const w = (await tx.warehouse.findFirst({ where: { companyId, isDefault: true, isActive: true } })) ?? (await tx.warehouse.findFirst({ where: { companyId, isActive: true }, orderBy: { code: 'asc' } }));
    if (w) return w;
    return tx.warehouse.create({ data: { companyId, code: 'MAIN', name: 'Main Warehouse', isDefault: true } });
  }

  async onHand(tx: Tx, productId: string, warehouseId?: string, batchNo?: string | null) {
    const a = await tx.stockMovement.aggregate({ where: { productId, ...(warehouseId ? { warehouseId } : {}), ...(batchNo ? { batchNo } : {}) }, _sum: { quantity: true, totalCost: true } });
    return { qty: D(a._sum.quantity), value: D(a._sum.totalCost) };
  }

  private async lockProduct(tx: Tx, id: string) { await tx.$queryRaw`SELECT id FROM products WHERE id = ${id}::uuid FOR UPDATE`; }

  private checkTracking(p: { trackBatch: boolean; trackSerial: boolean; sku: string }, qty: Decimal, batchNo?: string | null, serials?: string[]) {
    if (p.trackBatch && !batchNo) throw new UnprocessableEntityException(`${p.sku}: batch number required`);
    if (p.trackSerial) {
      if (!qty.isInteger()) throw new UnprocessableEntityException(`${p.sku}: serial tracked items need whole quantities`);
      if ((serials?.length ?? 0) !== qty.toNumber()) throw new UnprocessableEntityException(`${p.sku}: ${qty.toString()} serial number(s) required`);
      if (new Set(serials).size !== serials!.length) throw new UnprocessableEntityException(`${p.sku}: duplicate serial numbers`);
    }
  }

  async receive(tx: Tx, p: ReceiveParams) {
    const prod = await this.product(tx, p.companyId, p.productId);
    if (!prod.trackInventory) return null;
    if (p.qty.lte(0)) throw new BadRequestException('Quantity must be positive');
    await this.lockProduct(tx, prod.id);
    this.checkTracking(prod, p.qty, p.batchNo, p.serialNos);
    const dp = (await tx.companySetting.findUniqueOrThrow({ where: { companyId: p.companyId } })).amountDecimals;
    const total = round(p.totalCost, dp);
    const unitCost = total.div(p.qty).toDecimalPlaces(6);
    const m = await tx.stockMovement.create({
      data: { companyId: p.companyId, productId: prod.id, warehouseId: p.warehouseId, type: p.type, movementDate: p.date, quantity: p.qty, unitCost, totalCost: total, batchNo: p.batchNo, expiryDate: p.expiryDate,
        sourceType: p.sourceType, sourceId: p.sourceId, note: p.note, createdBy: p.userId },
    });
    await tx.stockLayer.create({ data: { companyId: p.companyId, productId: prod.id, warehouseId: p.warehouseId, movementId: m.id, batchNo: p.batchNo, receivedAt: p.date, remainingQty: p.qty, unitCost } });
    if (prod.trackSerial) {
      for (const sn of p.serialNos!) {
        const ex = await tx.stockSerial.findUnique({ where: { companyId_productId_serialNo: { companyId: p.companyId, productId: prod.id, serialNo: sn } } });
        if (ex && ex.status === 'IN_STOCK') throw new ConflictException(`Serial ${sn} is already in stock`);
        if (ex) await tx.stockSerial.update({ where: { id: ex.id }, data: { status: 'IN_STOCK', warehouseId: p.warehouseId, cost: unitCost } });
        else await tx.stockSerial.create({ data: { companyId: p.companyId, productId: prod.id, serialNo: sn, warehouseId: p.warehouseId, cost: unitCost } });
      }
    }
    return m;
  }

  async issue(tx: Tx, p: IssueParams) {
    const prod = await this.product(tx, p.companyId, p.productId);
    if (!prod.trackInventory) return null;
    if (p.qty.lte(0)) throw new BadRequestException('Quantity must be positive');
    await this.lockProduct(tx, prod.id);
    this.checkTracking(prod, p.qty, p.batchNo, p.serialNos);
    const settings = await tx.companySetting.findUniqueOrThrow({ where: { companyId: p.companyId } });
    const dp = settings.amountDecimals;
    const wh = await this.onHand(tx, prod.id, p.warehouseId);
    if (wh.qty.lt(p.qty)) throw new UnprocessableEntityException(`${prod.sku}: insufficient stock (${wh.qty.toString()} available, ${p.qty.toString()} requested)`);
    if (p.batchNo) {
      const b = await this.onHand(tx, prod.id, p.warehouseId, p.batchNo);
      if (b.qty.lt(p.qty)) throw new UnprocessableEntityException(`${prod.sku}: insufficient stock in batch ${p.batchNo} (${b.qty.toString()})`);
    }
    // consume FIFO layers (keeps quantities consistent for both methods)
    const layers = await tx.stockLayer.findMany({ where: { productId: prod.id, warehouseId: p.warehouseId, remainingQty: { gt: 0 }, ...(p.batchNo ? { batchNo: p.batchNo } : {}) }, orderBy: [{ receivedAt: 'asc' }, { seq: 'asc' }] });
    let need = p.qty, fifo = ZERO;
    for (const l of layers) {
      if (need.lte(0)) break;
      const use = Decimal.min(need, l.remainingQty);
      fifo = fifo.add(use.mul(l.unitCost)); need = need.sub(use);
      await tx.stockLayer.update({ where: { id: l.id }, data: { remainingQty: l.remainingQty.sub(use) } });
    }
    if (need.gt(0)) throw new UnprocessableEntityException(`${prod.sku}: stock layers are inconsistent`);
    let cost: Decimal;
    if (settings.inventoryMethod === 'FIFO') cost = round(fifo, dp);
    else cost = p.qty.eq(wh.qty) ? wh.value : round(wh.value.div(wh.qty).mul(p.qty), dp); // weighted average
    const unitCost = cost.div(p.qty).toDecimalPlaces(6);
    const m = await tx.stockMovement.create({
      data: { companyId: p.companyId, productId: prod.id, warehouseId: p.warehouseId, type: p.type, movementDate: p.date, quantity: p.qty.neg(), unitCost, totalCost: cost.neg(), batchNo: p.batchNo,
        sourceType: p.sourceType, sourceId: p.sourceId, note: p.note, createdBy: p.userId },
    });
    if (prod.trackSerial) {
      for (const sn of p.serialNos!) {
        const s = await tx.stockSerial.findUnique({ where: { companyId_productId_serialNo: { companyId: p.companyId, productId: prod.id, serialNo: sn } } });
        if (!s || s.status !== 'IN_STOCK' || s.warehouseId !== p.warehouseId) throw new UnprocessableEntityException(`Serial ${sn} is not in stock in this warehouse`);
        await tx.stockSerial.update({ where: { id: s.id }, data: { status: 'OUT' } });
      }
    }
    return m;
  }

  async transfer(tx: Tx, p: { companyId: string; userId: string; productId: string; fromWarehouseId: string; toWarehouseId: string; qty: Decimal; date: Date; batchNo?: string | null; serialNos?: string[]; note?: string }) {
    if (p.fromWarehouseId === p.toWarehouseId) throw new BadRequestException('Source and destination warehouses must differ');
    const out = await this.issue(tx, { ...p, warehouseId: p.fromWarehouseId, type: 'TRANSFER_OUT', sourceType: 'TRANSFER' });
    if (!out) return null;
    const into = await this.receive(tx, { ...p, warehouseId: p.toWarehouseId, totalCost: out.totalCost.neg(), type: 'TRANSFER_IN', sourceType: 'TRANSFER', sourceId: out.id });
    return { out, into };
  }

  /** Mirror every movement of a source document (used when the document is cancelled). */
  async reverseSource(tx: Tx, companyId: string, userId: string, sourceType: string, sourceId: string, date: Date) {
    const moves = await tx.stockMovement.findMany({ where: { companyId, sourceType, sourceId, reversalOfId: null } });
    for (const m of moves) {
      if (await tx.stockMovement.findUnique({ where: { reversalOfId: m.id } })) continue;
      await this.lockProduct(tx, m.productId);
      const prod = await this.product(tx, companyId, m.productId);
      if (m.quantity.gt(0)) {
        const layer = await tx.stockLayer.findFirst({ where: { movementId: m.id } });
        if (!layer || layer.remainingQty.lt(m.quantity)) throw new ConflictException(`${prod.sku}: received stock has already been used; it cannot be reversed`);
        await tx.stockLayer.update({ where: { id: layer.id }, data: { remainingQty: layer.remainingQty.sub(m.quantity) } });
      } else {
        await tx.stockLayer.create({ data: { companyId, productId: m.productId, warehouseId: m.warehouseId, movementId: m.id, batchNo: m.batchNo, receivedAt: date, remainingQty: m.quantity.neg(), unitCost: m.unitCost } });
      }
      await tx.stockMovement.create({
        data: { companyId, productId: m.productId, warehouseId: m.warehouseId, type: m.quantity.gt(0) ? 'ADJUSTMENT_OUT' : 'ADJUSTMENT_IN', movementDate: date, quantity: m.quantity.neg(), unitCost: m.unitCost, totalCost: m.totalCost.neg(),
          batchNo: m.batchNo, sourceType, sourceId, reversalOfId: m.id, note: 'Reversal', createdBy: userId },
      });
    }
    return moves.length;
  }

  // ------------------------------------------------------------------ reporting helpers
  async stockRows(tx: Tx, companyId: string, q: { asOf?: Date; warehouseId?: string; productId?: string; categoryId?: string }) {
    return tx.$queryRaw<any[]>`
      SELECT p.id AS "productId", p.sku, p.name, p.min_stock AS "minStock", w.id AS "warehouseId", w.name AS warehouse, c.name AS category,
             COALESCE(SUM(m.quantity),0) AS qty, COALESCE(SUM(m.total_cost),0) AS value
      FROM products p
      CROSS JOIN warehouses w
      LEFT JOIN product_categories c ON c.id = p.category_id
      LEFT JOIN stock_movements m ON m.product_id = p.id AND m.warehouse_id = w.id ${q.asOf ? Prisma.sql`AND m.movement_date <= ${q.asOf}` : Prisma.empty}
      WHERE p.company_id = ${companyId}::uuid AND w.company_id = ${companyId}::uuid AND p.track_inventory
        ${q.warehouseId ? Prisma.sql`AND w.id = ${q.warehouseId}::uuid` : Prisma.empty}
        ${q.productId ? Prisma.sql`AND p.id = ${q.productId}::uuid` : Prisma.empty}
        ${q.categoryId ? Prisma.sql`AND p.category_id = ${q.categoryId}::uuid` : Prisma.empty}
      GROUP BY p.id, w.id, c.name HAVING COALESCE(SUM(m.quantity),0) <> 0 OR ${q.productId ? Prisma.sql`true` : Prisma.sql`false`}
      ORDER BY p.sku, w.name`;
  }
}
