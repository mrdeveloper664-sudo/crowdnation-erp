import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { isoDate, parseDate } from '../common/dates';
import { D, ZERO, fmt } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { IsMoney, IsoDate } from '../common/validators';
import { SequenceService } from '../accounting/sequence.service';
import { SystemAccountsService } from '../accounting/system-accounts.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { monthlyDepreciation } from './depreciation';

class CategoryDto {
  @IsString() @Length(2, 80) name: string; @IsInt() @Min(1) usefulLifeMonths: number; @IsOptional() @IsIn(['SL', 'DB']) method?: string;
  @IsOptional() @IsUUID() assetAccountId?: string; @IsOptional() @IsUUID() accumDepAccountId?: string; @IsOptional() @IsUUID() depExpenseAccountId?: string;
}
class AssetDto {
  @IsString() @Length(2, 160) name: string; @IsUUID() categoryId: string; @Matches(IsoDate) purchaseDate: string; @IsMoney() cost: string; @IsOptional() @IsMoney() salvageValue?: string;
  @IsOptional() @IsInt() @Min(1) usefulLifeMonths?: number; @IsOptional() @IsIn(['SL', 'DB']) method?: string; @IsOptional() @Matches(IsoDate) depreciationStart?: string;
  @IsOptional() @IsString() location?: string; @IsOptional() @IsUUID() custodianId?: string; @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() fundingAccountId?: string; // posts Dr asset / Cr this ledger; omit when the purchase was already booked (e.g. purchase invoice)
}
class TransferDto { @Matches(IsoDate) date: string; @IsOptional() @IsString() toLocation?: string; @IsOptional() @IsUUID() toCustodian?: string; @IsOptional() @IsString() note?: string }
class MaintDto { @Matches(IsoDate) date: string; @IsString() @Length(2, 300) description: string; @IsOptional() @IsMoney() cost?: string; @IsOptional() @IsUUID() paidFromId?: string; @IsOptional() @IsString() performedBy?: string; @IsOptional() @Matches(IsoDate) nextDueDate?: string }
class DepRunDto { @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string }
class DisposeDto { @Matches(IsoDate) date: string; @IsMoney() proceeds: string; @IsOptional() @IsUUID() proceedsAccountId?: string }

@Controller('assets')
export class AssetsController {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private vouchers: VouchersService, private sys: SystemAccountsService) {}

  @Get('categories') @RequirePermission('asset', 'view') categories(@CurrentUser() u: AuthUser) { return this.prisma.tenant(u.companyId, (tx) => tx.assetCategory.findMany({ orderBy: { name: 'asc' } })); }
  @Post('categories') @RequirePermission('asset', 'create') addCategory(@CurrentUser() u: AuthUser, @Body() d: CategoryDto) { return this.prisma.tenant(u.companyId, (tx) => tx.assetCategory.create({ data: { ...d, companyId: u.companyId } })); }

  private async accounts(tx: Tx, companyId: string, categoryId: string) {
    const c = await tx.assetCategory.findUniqueOrThrow({ where: { id: categoryId } });
    return { cat: c, asset: c.assetAccountId ?? (await this.sys.get(tx, companyId, 'FIXED_ASSETS').catch(async () => (await tx.account.findFirstOrThrow({ where: { companyId, systemKey: 'FIXED_ASSETS' } })).id)),
      accum: c.accumDepAccountId ?? (await tx.account.findFirstOrThrow({ where: { companyId, systemKey: 'ACC_DEPRECIATION' } })).id,
      expense: c.depExpenseAccountId ?? (await tx.account.findFirstOrThrow({ where: { companyId, systemKey: 'DEPRECIATION_EXPENSE' } })).id };
  }

  private async accumulated(tx: Tx, assetId: string) { return D((await tx.assetDepreciation.aggregate({ where: { assetId }, _sum: { amount: true } }))._sum.amount); }

  private async present(tx: Tx, a: any) {
    const acc = await this.accumulated(tx, a.id);
    return { ...a, purchaseDate: isoDate(a.purchaseDate), depreciationStart: isoDate(a.depreciationStart), disposedAt: a.disposedAt ? isoDate(a.disposedAt) : null, cost: fmt(a.cost), salvageValue: fmt(a.salvageValue), accumulatedDepreciation: fmt(acc), netBookValue: fmt(a.cost.sub(acc)) };
  }

  @Get() @RequirePermission('asset', 'view')
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('categoryId') categoryId?: string) {
    return this.prisma.tenant(u.companyId, async (tx) => Promise.all((await tx.fixedAsset.findMany({ where: { ...(status ? { status } : {}), ...(categoryId ? { categoryId } : {}) }, orderBy: { code: 'asc' } })).map((a) => this.present(tx, a))));
  }

  @Post() @RequirePermission('asset', 'create')
  register(@CurrentUser() u: AuthUser, @Body() d: AssetDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const { cat, asset } = await this.accounts(tx, u.companyId, d.categoryId);
      const cost = D(d.cost), salvage = D(d.salvageValue ?? 0);
      if (salvage.gte(cost)) throw new BadRequestException('Salvage value must be below cost');
      const purchase = parseDate(d.purchaseDate);
      const code = `FA-${this.seq.pad(await this.seq.nextGlobal(tx, u.companyId, 'ASSET'), 4)}`;
      let voucherId: string | undefined;
      if (d.fundingAccountId) {
        const v = await this.vouchers.create(u.companyId, u.userId, { type: 'JOURNAL', date: d.purchaseDate, reference: code, narration: `Asset purchase ${d.name}`, lines: [{ accountId: asset, debit: d.cost }, { accountId: d.fundingAccountId, credit: d.cost }] }, undefined, tx);
        await this.vouchers.post(u.companyId, u.userId, v.id, tx); voucherId = v.id;
      }
      const a = await tx.fixedAsset.create({ data: { companyId: u.companyId, code, name: d.name, categoryId: d.categoryId, purchaseDate: purchase, cost, salvageValue: salvage, usefulLifeMonths: d.usefulLifeMonths ?? cat.usefulLifeMonths, method: d.method ?? cat.method,
        depreciationStart: d.depreciationStart ? parseDate(d.depreciationStart) : purchase, location: d.location, custodianId: d.custodianId, supplierId: d.supplierId, purchaseVoucherId: voucherId } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'asset.registered', entityType: 'fixed_asset', entityId: a.id, after: { code, cost: d.cost } });
      return this.present(tx, a);
    });
  }

  @Get(':id') @RequirePermission('asset', 'view')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const a = await tx.fixedAsset.findUniqueOrThrow({ where: { id }, include: { depreciations: { orderBy: { period: 'asc' } } } });
      return { ...(await this.present(tx, a)), depreciations: a.depreciations.map((x) => ({ period: x.period, amount: fmt(x.amount) })), transfers: await tx.assetTransfer.findMany({ where: { assetId: id }, orderBy: { transferDate: 'desc' } }), maintenance: await tx.assetMaintenance.findMany({ where: { assetId: id }, orderBy: { serviceDate: 'desc' } }) };
    });
  }

  @Post(':id/transfer') @HttpCode(200) @RequirePermission('asset', 'edit')
  transfer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: TransferDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const a = await tx.fixedAsset.findUniqueOrThrow({ where: { id } });
      if (a.status !== 'ACTIVE') throw new ConflictException('Asset is disposed');
      await tx.assetTransfer.create({ data: { companyId: u.companyId, assetId: id, transferDate: parseDate(d.date), fromLocation: a.location, toLocation: d.toLocation ?? a.location, fromCustodian: a.custodianId, toCustodian: d.toCustodian ?? a.custodianId, note: d.note, createdBy: u.userId } });
      await tx.fixedAsset.update({ where: { id }, data: { location: d.toLocation ?? a.location, custodianId: d.toCustodian ?? a.custodianId } });
      return { transferred: true };
    });
  }

  @Post(':id/maintenance') @RequirePermission('asset', 'create')
  maintenance(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: MaintDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const a = await tx.fixedAsset.findUniqueOrThrow({ where: { id } });
      let voucherId: string | undefined;
      if (d.cost && D(d.cost).gt(0)) {
        if (!d.paidFromId) throw new BadRequestException('paidFromId (cash/bank) is required to post a maintenance cost');
        const v = await this.vouchers.create(u.companyId, u.userId, { type: 'PAYMENT', date: d.date, reference: a.code, narration: `Maintenance ${a.name}: ${d.description}`, lines: [{ accountId: await this.sys.get(tx, u.companyId, 'GENERAL_EXPENSE'), debit: d.cost }, { accountId: d.paidFromId, credit: d.cost }] }, undefined, tx);
        await this.vouchers.post(u.companyId, u.userId, v.id, tx); voucherId = v.id;
      }
      return tx.assetMaintenance.create({ data: { companyId: u.companyId, assetId: id, serviceDate: parseDate(d.date), description: d.description, cost: d.cost ?? 0, performedBy: d.performedBy, nextDueDate: d.nextDueDate ? parseDate(d.nextDueDate) : null, voucherId, createdBy: u.userId } });
    });
  }

  /** Posts one journal for every active asset's depreciation of the month (idempotent per asset + period). */
  @Post('depreciation/run') @HttpCode(200) @RequirePermission('asset', 'post')
  runDepreciation(@CurrentUser() u: AuthUser, @Body() d: DepRunDto) {
    const [y, m] = d.period.split('-').map(Number);
    const end = new Date(Date.UTC(y, m, 0));
    return this.prisma.tenant(u.companyId, async (tx) => {
      const assets = await tx.fixedAsset.findMany({ where: { status: 'ACTIVE', depreciationStart: { lte: end } } });
      const exp = new Map<string, any>(), acc = new Map<string, any>(); const rows: Array<{ assetId: string; amount: any }> = []; let total = ZERO;
      for (const a of assets) {
        if (await tx.assetDepreciation.findUnique({ where: { assetId_period: { assetId: a.id, period: d.period } } })) continue;
        const accum = await this.accumulated(tx, a.id);
        const amt = monthlyDepreciation({ cost: a.cost, salvage: a.salvageValue, lifeMonths: a.usefulLifeMonths, method: a.method }, accum);
        if (amt.lte(0)) continue;
        const x = await this.accounts(tx, u.companyId, a.categoryId);
        exp.set(x.expense, (exp.get(x.expense) ?? ZERO).add(amt)); acc.set(x.accum, (acc.get(x.accum) ?? ZERO).add(amt)); rows.push({ assetId: a.id, amount: amt }); total = total.add(amt);
      }
      if (!rows.length) return { period: d.period, assets: 0, total: '0.00' };
      const v = await this.vouchers.create(u.companyId, u.userId, { type: 'JOURNAL', date: isoDate(end), reference: `DEPR-${d.period}`, narration: `Depreciation ${d.period}`,
        lines: [...[...exp].map(([accountId, v]) => ({ accountId, debit: v.toString() })), ...[...acc].map(([accountId, v]) => ({ accountId, credit: v.toString() }))] }, undefined, tx);
      await this.vouchers.post(u.companyId, u.userId, v.id, tx);
      await tx.assetDepreciation.createMany({ data: rows.map((r) => ({ companyId: u.companyId, assetId: r.assetId, period: d.period, amount: r.amount, voucherId: v.id })) });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'asset.depreciation_posted', entityType: 'fixed_asset', after: { period: d.period, total: total.toString() } });
      return { period: d.period, assets: rows.length, total: fmt(total), voucher: v.number };
    });
  }

  @Post(':id/dispose') @HttpCode(200) @RequirePermission('asset', 'post')
  dispose(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: DisposeDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM fixed_assets WHERE id = ${id}::uuid FOR UPDATE`;
      const a = await tx.fixedAsset.findUniqueOrThrow({ where: { id } });
      if (a.status !== 'ACTIVE') throw new ConflictException('Asset already disposed');
      const date = parseDate(d.date);
      // depreciation must be up to date through the month before disposal
      const prev = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
      const need = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
      const accum = await this.accumulated(tx, id);
      const startMonth = `${a.depreciationStart.getUTCFullYear()}-${String(a.depreciationStart.getUTCMonth() + 1).padStart(2, '0')}`;
      const fullyDepreciated = a.cost.sub(a.salvageValue).sub(accum).lte(0);
      if (!fullyDepreciated && startMonth <= need && !(await tx.assetDepreciation.findUnique({ where: { assetId_period: { assetId: id, period: need } } }))) throw new ConflictException(`Run depreciation through ${need} before disposing the asset`);
      const { asset, accum: accumAcc } = await this.accounts(tx, u.companyId, a.categoryId);
      const proceeds = D(d.proceeds), nbv = a.cost.sub(accum), diff = proceeds.sub(nbv);
      if (proceeds.gt(0) && !d.proceedsAccountId) throw new BadRequestException('proceedsAccountId is required when proceeds > 0');
      const lines: any[] = [{ accountId: asset, credit: a.cost.toString() }];
      if (accum.gt(0)) lines.push({ accountId: accumAcc, debit: accum.toString() });
      if (proceeds.gt(0)) lines.push({ accountId: d.proceedsAccountId, debit: proceeds.toString() });
      if (diff.gt(0)) lines.push({ accountId: await this.sys.get(tx, u.companyId, 'DISPOSAL_GAIN'), credit: diff.toString() });
      if (diff.lt(0)) lines.push({ accountId: await this.sys.get(tx, u.companyId, 'DISPOSAL_LOSS'), debit: diff.abs().toString() });
      const v = await this.vouchers.create(u.companyId, u.userId, { type: 'JOURNAL', date: d.date, reference: a.code, narration: `Disposal of ${a.name}`, lines }, undefined, tx);
      await this.vouchers.post(u.companyId, u.userId, v.id, tx);
      await tx.fixedAsset.update({ where: { id }, data: { status: 'DISPOSED', disposedAt: date, disposalProceeds: proceeds, disposalVoucherId: v.id } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'asset.disposed', entityType: 'fixed_asset', entityId: id, after: { proceeds: d.proceeds, gainLoss: diff.toString() } });
      return { status: 'DISPOSED', netBookValue: fmt(nbv), gainLoss: fmt(diff), voucher: v.number };
    });
  }
}
