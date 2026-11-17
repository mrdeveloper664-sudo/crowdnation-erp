import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { TaxTreatment } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { isoDate, parseDate } from '../common/dates';
import { PrismaService } from '../common/prisma.service';
import { IsoDate } from '../common/validators';
import { VatService } from './vat.service';

class TaxRateDto {
  @IsString() @Length(1, 20) code: string;
  @IsString() @Length(2, 80) name: string;
  @IsEnum(TaxTreatment) treatment: TaxTreatment;
  @Matches(/^\d{1,3}(\.\d{1,4})?$/) rate: string;
  @Matches(IsoDate) effectiveFrom: string;
  @IsOptional() @Matches(IsoDate) effectiveTo?: string;
  /** Reverse-charge code (purchases from non-registered/foreign suppliers): requires a standard-rated treatment with a rate above zero. */
  @IsOptional() @IsBoolean() reverseCharge?: boolean;
}
class CalcDto {
  @IsString() code: string;
  @Matches(IsoDate) date: string;
  @Matches(/^\d{1,15}(\.\d{1,4})?$/) amount: string;
  @IsBoolean() inclusive: boolean;
}
class UpdateRateDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @Matches(IsoDate) effectiveTo?: string;
}

@Controller('vat')
export class VatController {
  constructor(private prisma: PrismaService, private vat: VatService, private audit: AuditService) {}

  @Get('rates') @RequirePermission('vat', 'view')
  rates(@CurrentUser() u: AuthUser) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      await this.vat.ensureDefaults(tx, u.companyId);
      return (await tx.taxRate.findMany({ orderBy: [{ code: 'asc' }, { effectiveFrom: 'desc' }] })).map((r) => ({ ...r, rate: r.rate.toString(), effectiveFrom: isoDate(r.effectiveFrom), effectiveTo: r.effectiveTo ? isoDate(r.effectiveTo) : null }));
    });
  }

  /** Adding a new version of an existing code closes the previous version the day before. */
  @Post('rates') @RequirePermission('vat', 'create')
  createRate(@CurrentUser() u: AuthUser, @Body() dto: TaxRateDto) {
    const from = parseDate(dto.effectiveFrom, 'effectiveFrom');
    const to = dto.effectiveTo ? parseDate(dto.effectiveTo, 'effectiveTo') : null;
    if (dto.reverseCharge && (dto.treatment !== 'STANDARD' || Number(dto.rate) <= 0)) throw new BadRequestException('A reverse-charge code must be standard rated with a rate above zero');
    if (to && to < from) throw new BadRequestException('effectiveTo precedes effectiveFrom');
    return this.prisma.tenant(u.companyId, async (tx) => {
      await this.vat.ensureDefaults(tx, u.companyId);
      const prev = await tx.taxRate.findFirst({ where: { code: dto.code, effectiveFrom: { lt: from }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, orderBy: { effectiveFrom: 'desc' } });
      if (prev) await tx.taxRate.update({ where: { id: prev.id }, data: { effectiveTo: new Date(from.getTime() - 86_400_000) } });
      const r = await tx.taxRate.create({ data: { companyId: u.companyId, code: dto.code, name: dto.name, treatment: dto.treatment, rate: dto.rate, effectiveFrom: from, effectiveTo: to, isReverseCharge: !!dto.reverseCharge } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'tax_rate.created', entityType: 'tax_rate', entityId: r.id, after: dto });
      return { ...r, rate: r.rate.toString() };
    });
  }

  /** Convenience: create the standard reverse-charge code `RC` (5%) if it does not exist yet. */
  @Post('rates/reverse-charge') @RequirePermission('vat', 'create')
  reverseChargeCode(@CurrentUser() u: AuthUser) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const r = await this.vat.ensureReverseCharge(tx, u.companyId);
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'tax_rate.reverse_charge_enabled', entityType: 'tax_rate', entityId: r.id });
      return { ...r, rate: r.rate.toString() };
    });
  }

  @Patch('rates/:id') @RequirePermission('vat', 'edit')
  updateRate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRateDto) {
    return this.prisma.tenant(u.companyId, (tx) => tx.taxRate.update({ where: { id }, data: { isActive: dto.isActive, effectiveTo: dto.effectiveTo ? parseDate(dto.effectiveTo) : undefined } }));
  }

  @Post('calculate') @RequirePermission('vat', 'view')
  calculate(@CurrentUser() u: AuthUser, @Body() dto: CalcDto) {
    return this.prisma.tenant(u.companyId, (tx) => this.vat.calculate(tx, u.companyId, { code: dto.code, date: parseDate(dto.date), amount: dto.amount, inclusive: dto.inclusive }));
  }

  @Get('transactions') @RequirePermission('vat', 'view')
  transactions(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const rows = await tx.taxTransaction.findMany({
        where: { txnDate: { gte: from ? parseDate(from) : undefined, lte: to ? parseDate(to) : undefined } }, orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }], take: 1000,
      });
      return rows.map((r) => ({ ...r, txnDate: isoDate(r.txnDate), taxableAmount: r.taxableAmount.toFixed(2), taxAmount: r.taxAmount.toFixed(2) }));
    });
  }

  @Get('return') @RequirePermission('vat', 'view')
  vatReturn(@CurrentUser() u: AuthUser, @Query('from') from: string, @Query('to') to: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: u.companyId } });
      return { trn: company.trn, company: company.name, ...(await this.vat.vatReturn(tx, u.companyId, parseDate(from, 'from'), parseDate(to, 'to'))) };
    });
  }
}
