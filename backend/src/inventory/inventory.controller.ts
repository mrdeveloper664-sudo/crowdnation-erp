import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min, ValidateNested } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { isoDate, parseDate } from '../common/dates';
import { paged } from '../common/interceptors/response.interceptor';
import { D, ZERO, fmt } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { IsMoney, IsoDate } from '../common/validators';
import { SequenceService } from '../accounting/sequence.service';
import { SystemAccountsService } from '../accounting/system-accounts.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { InventoryService } from './inventory.service';

class CategoryDto { @IsString() @Length(2, 80) name: string; @IsOptional() @IsUUID() parentId?: string }
class UomDto { @IsString() @Length(1, 10) code: string; @IsString() @Length(1, 60) name: string }
class WarehouseDto {
  @IsString() @Length(1, 20) code: string; @IsString() @Length(2, 80) name: string;
  @IsOptional() @IsString() address?: string; @IsOptional() @IsBoolean() isDefault?: boolean; @IsOptional() @IsBoolean() isActive?: boolean;
}
class ProductDto {
  @IsOptional() @IsString() @Length(1, 40) sku?: string;
  @IsOptional() @IsString() @Length(1, 60) barcode?: string;
  @IsString() @Length(2, 160) name: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID() categoryId?: string; @IsOptional() @IsUUID() uomId?: string;
  @IsOptional() @IsBoolean() trackInventory?: boolean; @IsOptional() @IsBoolean() trackBatch?: boolean; @IsOptional() @IsBoolean() trackSerial?: boolean;
  @IsOptional() @IsMoney() salePrice?: string; @IsOptional() @IsMoney() purchasePrice?: string;
  @IsOptional() @IsString() taxCode?: string;
  @IsOptional() @Matches(/^\d{1,12}(\.\d{1,4})?$/) minStock?: string; @IsOptional() @Matches(/^\d{1,12}(\.\d{1,4})?$/) reorderQty?: string;
  @IsOptional() @IsUUID() incomeAccountId?: string; @IsOptional() @IsUUID() expenseAccountId?: string; @IsOptional() @IsUUID() inventoryAccountId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class StockLineDto {
  @IsUUID() productId: string; @Matches(/^\d{1,12}(\.\d{1,4})?$/) quantity: string;
  @IsOptional() @IsMoney() totalCost?: string; // stock-in value (base currency)
  @IsOptional() @IsString() batchNo?: string; @IsOptional() @Matches(IsoDate) expiryDate?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) serialNos?: string[];
}
class StockInDto {
  @IsUUID() warehouseId: string; @Matches(IsoDate) date: string;
  @IsUUID() offsetAccountId: string; // credited (e.g. capital / opening equity / supplier) when stock comes in
  @IsOptional() @IsString() note?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => StockLineDto) lines: StockLineDto[];
}
class StockOutDto {
  @IsUUID() warehouseId: string; @Matches(IsoDate) date: string;
  @IsUUID() offsetAccountId: string; // debited (e.g. consumption / damage expense)
  @IsOptional() @IsString() note?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => StockLineDto) lines: StockLineDto[];
}
class TransferDto {
  @IsUUID() fromWarehouseId: string; @IsUUID() toWarehouseId: string; @Matches(IsoDate) date: string; @IsOptional() @IsString() note?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => StockLineDto) lines: StockLineDto[];
}
class AdjustLineDto { @IsUUID() productId: string; @Matches(/^\d{1,12}(\.\d{1,4})?$/) countedQty: string; @IsOptional() @IsMoney() unitCost?: string; @IsOptional() @IsString() batchNo?: string }
class AdjustDto {
  @IsUUID() warehouseId: string; @Matches(IsoDate) date: string; @IsOptional() @IsString() note?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AdjustLineDto) lines: AdjustLineDto[];
}

@Controller('inventory')
export class InventoryController {
  constructor(private prisma: PrismaService, private inv: InventoryService, private audit: AuditService, private seq: SequenceService, private sys: SystemAccountsService, private vouchers: VouchersService) {}

  // ---- master data
  @Get('categories') @RequirePermission('inventory', 'view') categories(@CurrentUser() u: AuthUser) { return this.prisma.tenant(u.companyId, (tx) => tx.productCategory.findMany({ orderBy: { name: 'asc' } })); }
  @Post('categories') @RequirePermission('inventory', 'create') createCategory(@CurrentUser() u: AuthUser, @Body() d: CategoryDto) { return this.prisma.tenant(u.companyId, (tx) => tx.productCategory.create({ data: { ...d, companyId: u.companyId } })); }
  @Get('units') @RequirePermission('inventory', 'view') units(@CurrentUser() u: AuthUser) { return this.prisma.tenant(u.companyId, (tx) => tx.unitOfMeasure.findMany({ orderBy: { code: 'asc' } })); }
  @Post('units') @RequirePermission('inventory', 'create') createUnit(@CurrentUser() u: AuthUser, @Body() d: UomDto) { return this.prisma.tenant(u.companyId, (tx) => tx.unitOfMeasure.create({ data: { ...d, companyId: u.companyId } })); }
  @Get('warehouses') @RequirePermission('inventory', 'view') warehouses(@CurrentUser() u: AuthUser) { return this.prisma.tenant(u.companyId, (tx) => tx.warehouse.findMany({ orderBy: { code: 'asc' } })); }
  @Post('warehouses') @RequirePermission('inventory', 'create')
  createWarehouse(@CurrentUser() u: AuthUser, @Body() d: WarehouseDto) {
    return this.prisma.tenant(u.companyId, async (tx) => { if (d.isDefault) await tx.warehouse.updateMany({ data: { isDefault: false } }); return tx.warehouse.create({ data: { ...d, companyId: u.companyId } }); });
  }
  @Patch('warehouses/:id') @RequirePermission('inventory', 'edit')
  updateWarehouse(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: WarehouseDto) {
    return this.prisma.tenant(u.companyId, async (tx) => { if (d.isDefault) await tx.warehouse.updateMany({ data: { isDefault: false } }); return tx.warehouse.update({ where: { id }, data: d }); });
  }

  // ---- products
  @Get('products') @RequirePermission('inventory', 'view')
  products(@CurrentUser() u: AuthUser, @Query('search') search?: string, @Query('categoryId') categoryId?: string, @Query('active') active?: string, @Query('page') pageQ?: string, @Query('pageSize') sizeQ?: string) {
    const page = Math.max(1, Number(pageQ) || 1), pageSize = Math.min(200, Math.max(1, Number(sizeQ) || 50));
    const where: Prisma.ProductWhereInput = { ...(categoryId ? { categoryId } : {}), ...(active !== undefined ? { isActive: active === 'true' } : {}), ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { sku: { contains: search, mode: 'insensitive' } }, { barcode: { contains: search } }] } : {}) };
    return this.prisma.tenant(u.companyId, async (tx) => {
      const [total, rows] = await Promise.all([tx.product.count({ where }), tx.product.findMany({ where, orderBy: { sku: 'asc' }, skip: (page - 1) * pageSize, take: pageSize })]);
      const on = await Promise.all(rows.map((r) => this.inv.onHand(tx, r.id)));
      return paged(rows.map((r, i) => ({ ...r, salePrice: fmt(r.salePrice), purchasePrice: fmt(r.purchasePrice), onHand: on[i].qty.toString(), stockValue: fmt(on[i].value) })), page, pageSize, total);
    });
  }

  @Get('products/by-barcode/:code') @RequirePermission('inventory', 'view')
  byBarcode(@CurrentUser() u: AuthUser, @Param('code') code: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const p = await tx.product.findFirst({ where: { OR: [{ barcode: code }, { sku: code }] } });
      if (!p) throw new BadRequestException('No product with this barcode or SKU');
      return { ...p, onHand: (await this.inv.onHand(tx, p.id)).qty.toString() };
    });
  }

  @Post('products') @RequirePermission('inventory', 'create')
  createProduct(@CurrentUser() u: AuthUser, @Body() d: ProductDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      if (d.trackSerial && d.trackInventory === false) throw new BadRequestException('Serial tracking needs a stocked item');
      const sku = d.sku ?? `P${this.seq.pad(await this.seq.nextGlobal(tx, u.companyId, 'PRODUCT'), 6)}`;
      const p = await tx.product.create({ data: { ...d, sku, companyId: u.companyId } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'product.created', entityType: 'product', entityId: p.id, after: p });
      return p;
    });
  }

  @Get('products/:id') @RequirePermission('inventory', 'view')
  async product(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const p = await this.inv.product(tx, u.companyId, id);
      const rows = await this.inv.stockRows(tx, u.companyId, { productId: id });
      return { ...p, onHand: (await this.inv.onHand(tx, id)).qty.toString(), byWarehouse: rows.map((r) => ({ warehouseId: r.warehouseId, warehouse: r.warehouse, qty: D(r.qty).toString(), value: fmt(r.value) })) };
    });
  }

  @Patch('products/:id') @RequirePermission('inventory', 'edit')
  updateProduct(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ProductDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const before = await this.inv.product(tx, u.companyId, id);
      if ((d.trackInventory !== undefined && d.trackInventory !== before.trackInventory) || (d.trackSerial !== undefined && d.trackSerial !== before.trackSerial) || (d.trackBatch !== undefined && d.trackBatch !== before.trackBatch)) {
        if (await tx.stockMovement.count({ where: { productId: id } })) throw new BadRequestException('Tracking settings cannot change once the product has stock movements');
      }
      const after = await tx.product.update({ where: { id }, data: d });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'product.updated', entityType: 'product', entityId: id, before, after });
      return after;
    });
  }

  @Delete('products/:id') @RequirePermission('inventory', 'delete')
  deleteProduct(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      if ((await tx.stockMovement.count({ where: { productId: id } })) + (await tx.documentLine.count({ where: { productId: id } }))) throw new BadRequestException('Product has transactions; deactivate it instead');
      await tx.product.delete({ where: { id } }); return { deleted: true };
    });
  }

  // ---- stock operations
  private async autoVoucher(tx: Tx, u: AuthUser, date: string, tag: string, narration: string, lines: Array<{ accountId: string; debit?: string; credit?: string }>) {
    const clean = lines.filter((l) => D(l.debit).gt(0) || D(l.credit).gt(0));
    if (clean.length < 2) return null;
    const v = await this.vouchers.create(u.companyId, u.userId, { type: 'JOURNAL', date, reference: tag, narration, lines: clean }, undefined, tx);
    await this.vouchers.post(u.companyId, u.userId, v.id, tx);
    return v;
  }

  @Post('stock-in') @RequirePermission('inventory', 'create')
  stockIn(@CurrentUser() u: AuthUser, @Body() d: StockInDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const date = parseDate(d.date); let total = ZERO; const byAcct = new Map<string, any>();
      const ref = `STOCKIN-${Date.now()}`;
      for (const l of d.lines) {
        if (!l.totalCost) throw new BadRequestException('totalCost is required for stock-in');
        const prod = await this.inv.product(tx, u.companyId, l.productId);
        await this.inv.receive(tx, { companyId: u.companyId, userId: u.userId, productId: l.productId, warehouseId: d.warehouseId, qty: D(l.quantity), totalCost: D(l.totalCost), date, type: 'RECEIPT', batchNo: l.batchNo, expiryDate: l.expiryDate ? parseDate(l.expiryDate) : null, serialNos: l.serialNos, sourceType: 'MANUAL', note: d.note });
        const a = prod.inventoryAccountId ?? (await this.sys.get(tx, u.companyId, 'INVENTORY'));
        byAcct.set(a, (byAcct.get(a) ?? ZERO).add(l.totalCost)); total = total.add(l.totalCost);
      }
      await this.autoVoucher(tx, u, d.date, ref, d.note ?? 'Stock in', [...[...byAcct].map(([accountId, v]) => ({ accountId, debit: v.toString() })), { accountId: d.offsetAccountId, credit: total.toString() }]);
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'stock.in', entityType: 'stock', after: d });
      return { received: d.lines.length, value: fmt(total) };
    });
  }

  @Post('stock-out') @RequirePermission('inventory', 'create')
  stockOut(@CurrentUser() u: AuthUser, @Body() d: StockOutDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const date = parseDate(d.date); let total = ZERO; const byAcct = new Map<string, any>();
      for (const l of d.lines) {
        const prod = await this.inv.product(tx, u.companyId, l.productId);
        const m = await this.inv.issue(tx, { companyId: u.companyId, userId: u.userId, productId: l.productId, warehouseId: d.warehouseId, qty: D(l.quantity), date, type: 'ISSUE', batchNo: l.batchNo, serialNos: l.serialNos, sourceType: 'MANUAL', note: d.note });
        if (!m) continue;
        const cost = m.totalCost.neg(); const a = prod.inventoryAccountId ?? (await this.sys.get(tx, u.companyId, 'INVENTORY'));
        byAcct.set(a, (byAcct.get(a) ?? ZERO).add(cost)); total = total.add(cost);
      }
      await this.autoVoucher(tx, u, d.date, `STOCKOUT-${Date.now()}`, d.note ?? 'Stock out', [{ accountId: d.offsetAccountId, debit: total.toString() }, ...[...byAcct].map(([accountId, v]) => ({ accountId, credit: v.toString() }))]);
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'stock.out', entityType: 'stock', after: d });
      return { issued: d.lines.length, value: fmt(total) };
    });
  }

  @Post('transfers') @RequirePermission('inventory', 'create')
  transfer(@CurrentUser() u: AuthUser, @Body() d: TransferDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      for (const l of d.lines) await this.inv.transfer(tx, { companyId: u.companyId, userId: u.userId, productId: l.productId, fromWarehouseId: d.fromWarehouseId, toWarehouseId: d.toWarehouseId, qty: D(l.quantity), date: parseDate(d.date), batchNo: l.batchNo, serialNos: l.serialNos, note: d.note });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'stock.transfer', entityType: 'stock', after: d });
      return { transferred: d.lines.length };
    });
  }

  /** Stock count: posts the difference between counted and system quantity (gain/loss to Stock Adjustments). */
  @Post('adjustments') @RequirePermission('inventory', 'edit')
  adjust(@CurrentUser() u: AuthUser, @Body() d: AdjustDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const date = parseDate(d.date); const adj = await this.sys.get(tx, u.companyId, 'STOCK_ADJUSTMENT');
      let gain = ZERO, loss = ZERO; const invA = await this.sys.get(tx, u.companyId, 'INVENTORY'); const results: any[] = [];
      for (const l of d.lines) {
        const prod = await this.inv.product(tx, u.companyId, l.productId);
        if (!prod.trackInventory) throw new BadRequestException(`${prod.sku} is not a stocked item`);
        if (prod.trackSerial) throw new BadRequestException(`${prod.sku}: adjust serial-tracked items with stock-in / stock-out`);
        const cur = await this.inv.onHand(tx, prod.id, d.warehouseId, l.batchNo);
        const diff = D(l.countedQty).sub(cur.qty);
        if (diff.isZero()) continue;
        if (diff.gt(0)) {
          const unit = l.unitCost ? D(l.unitCost) : cur.qty.gt(0) ? cur.value.div(cur.qty) : prod.purchasePrice;
          const m = await this.inv.receive(tx, { companyId: u.companyId, userId: u.userId, productId: prod.id, warehouseId: d.warehouseId, qty: diff, totalCost: unit.mul(diff), date, type: 'ADJUSTMENT_IN', batchNo: l.batchNo, sourceType: 'ADJUSTMENT', note: d.note });
          gain = gain.add(m!.totalCost);
        } else {
          const m = await this.inv.issue(tx, { companyId: u.companyId, userId: u.userId, productId: prod.id, warehouseId: d.warehouseId, qty: diff.abs(), date, type: 'ADJUSTMENT_OUT', batchNo: l.batchNo, sourceType: 'ADJUSTMENT', note: d.note });
          loss = loss.add(m!.totalCost.neg());
        }
        results.push({ sku: prod.sku, difference: diff.toString() });
      }
      const net = gain.sub(loss);
      await this.autoVoucher(tx, u, d.date, `ADJ-${Date.now()}`, d.note ?? 'Stock adjustment',
        net.gte(0) ? [{ accountId: invA, debit: net.toString() }, { accountId: adj, credit: net.toString() }] : [{ accountId: adj, debit: net.abs().toString() }, { accountId: invA, credit: net.abs().toString() }]);
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'stock.adjusted', entityType: 'stock', after: d });
      return { adjusted: results, netValue: fmt(net) };
    });
  }

  // ---- queries
  @Get('stock') @RequirePermission('inventory', 'view')
  stock(@CurrentUser() u: AuthUser, @Query('warehouseId') warehouseId?: string, @Query('productId') productId?: string, @Query('asOf') asOf?: string) {
    return this.prisma.tenant(u.companyId, async (tx) => (await this.inv.stockRows(tx, u.companyId, { warehouseId, productId, asOf: asOf ? parseDate(asOf) : undefined })).map((r) => ({ ...r, qty: D(r.qty).toString(), value: fmt(r.value), minStock: r.minStock.toString() })));
  }

  @Get('movements') @RequirePermission('inventory', 'view')
  movements(@CurrentUser() u: AuthUser, @Query('productId') productId?: string, @Query('warehouseId') warehouseId?: string, @Query('page') pageQ?: string) {
    const page = Math.max(1, Number(pageQ) || 1), pageSize = 50;
    return this.prisma.tenant(u.companyId, async (tx) => {
      const where = { ...(productId ? { productId } : {}), ...(warehouseId ? { warehouseId } : {}) };
      const [total, rows] = await Promise.all([tx.stockMovement.count({ where }), tx.stockMovement.findMany({ where, orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize })]);
      return paged(rows.map((r) => ({ ...r, movementDate: isoDate(r.movementDate), quantity: r.quantity.toString(), unitCost: r.unitCost.toString(), totalCost: fmt(r.totalCost) })), page, pageSize, total);
    });
  }

  @Get('serials') @RequirePermission('inventory', 'view')
  serials(@CurrentUser() u: AuthUser, @Query('productId', ParseUUIDPipe) productId: string, @Query('status') status?: string) {
    return this.prisma.tenant(u.companyId, (tx) => tx.stockSerial.findMany({ where: { productId, ...(status ? { status } : {}) }, orderBy: { serialNo: 'asc' } }));
  }
}
