import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { parseDate } from '../common/dates';
import { D } from '../common/money';
import { PrismaService } from '../common/prisma.service';
import { IsoDate } from '../common/validators';
import { CompanyBootstrapService } from '../companies/company-bootstrap.service';

class CreateFyDto {
  @Matches(IsoDate) startDate: string;
  @IsOptional() @IsString() @Length(2, 40) name?: string;
}
class RateDto {
  @IsString() @Length(3, 3) currency: string;
  @Matches(IsoDate) rateDate: string;
  @IsString() @Matches(/^\d{1,10}(\.\d{1,8})?$/) rate: string;
}

@Controller('accounting')
export class AccountingController {
  constructor(private prisma: PrismaService, private audit: AuditService, private bootstrap: CompanyBootstrapService) {}

  @Get('financial-years') @RequirePermission('period', 'view')
  years(@CurrentUser() u: AuthUser) {
    return this.prisma.tenant(u.companyId, (tx) => tx.financialYear.findMany({ include: { periods: { orderBy: { startDate: 'asc' } } }, orderBy: { startDate: 'desc' } }));
  }

  @Post('financial-years') @RequirePermission('period', 'create')
  createYear(@CurrentUser() u: AuthUser, @Body() dto: CreateFyDto) {
    const start = parseDate(dto.startDate, 'startDate');
    return this.prisma.tenant(u.companyId, async (tx) => {
      const end = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), 0));
      const overlap = await tx.financialYear.findFirst({ where: { startDate: { lte: end }, endDate: { gte: start } } });
      if (overlap) throw new BadRequestException(`Overlaps financial year ${overlap.name}`);
      const fy = await this.bootstrap.createFinancialYearFrom(tx, u.companyId, start, dto.name);
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'financial_year.created', entityType: 'financial_year', entityId: fy.id, after: fy });
      return fy;
    });
  }

  private setStatus(u: AuthUser, id: string, status: 'OPEN' | 'LOCKED') {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const before = await tx.accountingPeriod.findUniqueOrThrow({ where: { id } });
      const after = await tx.accountingPeriod.update({
        where: { id }, data: { status, lockedAt: status === 'LOCKED' ? new Date() : null, lockedBy: status === 'LOCKED' ? u.userId : null },
      });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: status === 'LOCKED' ? 'period.locked' : 'period.unlocked', entityType: 'accounting_period', entityId: id, before, after });
      return after;
    });
  }

  @Post('periods/:id/lock') @RequirePermission('period', 'approve')
  lock(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.setStatus(u, id, 'LOCKED'); }

  @Post('periods/:id/unlock') @RequirePermission('period', 'approve')
  unlock(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.setStatus(u, id, 'OPEN'); }

  @Get('exchange-rates') @RequirePermission('period', 'view')
  rates(@CurrentUser() u: AuthUser, @Query('currency') currency?: string) {
    return this.prisma.tenant(u.companyId, (tx) => tx.exchangeRate.findMany({ where: currency ? { currency: currency.toUpperCase() } : {}, orderBy: [{ currency: 'asc' }, { rateDate: 'desc' }], take: 500 }));
  }

  @Put('exchange-rates') @RequirePermission('period', 'edit')
  setRate(@CurrentUser() u: AuthUser, @Body() dto: RateDto) {
    const rateDate = parseDate(dto.rateDate, 'rateDate');
    const currency = dto.currency.toUpperCase();
    if (!D(dto.rate).gt(0)) throw new BadRequestException('Rate must be positive');
    return this.prisma.tenant(u.companyId, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: u.companyId } });
      if (currency === company.baseCurrency) throw new BadRequestException('Base currency rate is always 1');
      return tx.exchangeRate.upsert({
        where: { companyId_currency_rateDate: { companyId: u.companyId, currency, rateDate } },
        create: { companyId: u.companyId, currency, rateDate, rate: dto.rate }, update: { rate: dto.rate },
      });
    });
  }
}
