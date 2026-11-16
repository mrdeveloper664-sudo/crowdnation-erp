import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { PartyKind, Prisma } from '@prisma/client';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { D, fmt } from '../common/money';
import { paged } from '../common/interceptors/response.interceptor';
import { PrismaService, Tx } from '../common/prisma.service';
import { IsMoney } from '../common/validators';
import { SequenceService } from '../accounting/sequence.service';
import { ReportsService } from '../reports/reports.service';

class PartyDto {
  @IsString() @Length(2, 160) name: string;
  @IsOptional() @IsString() @Length(0, 32) trn?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsMoney() creditLimit?: string;
  @IsOptional() @IsInt() @Min(0) paymentTermsDays?: number;
  @IsOptional() @IsString() notes?: string;
}
class UpdatePartyDto extends PartyDto {
  @IsOptional() @IsString() @Length(2, 160) declare name: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export async function partyBalance(tx: Tx, accountId: string) {
  const [r] = await tx.$queryRaw<{ net: Prisma.Decimal }[]>`SELECT COALESCE(SUM(debit - credit),0) AS net FROM journal_entry_lines WHERE account_id = ${accountId}::uuid`;
  return D(r.net);
}

function build(kind: PartyKind, path: string, resource: string) {
  @Controller(path)
  class PartiesController {
    constructor(public prisma: PrismaService, public audit: AuditService, public seq: SequenceService, public reports: ReportsService) {}

    @Get() @RequirePermission(resource, 'view')
    list(@CurrentUser() u: AuthUser, @Query('search') search?: string, @Query('active') active?: string, @Query('page') pageQ?: string, @Query('pageSize') sizeQ?: string) {
      const page = Math.max(1, Number(pageQ) || 1), pageSize = Math.min(200, Math.max(1, Number(sizeQ) || 50));
      const where: Prisma.PartyWhereInput = { kind, ...(active !== undefined ? { isActive: active === 'true' } : {}), ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } : {}) };
      return this.prisma.tenant(u.companyId, async (tx) => {
        const [total, rows] = await Promise.all([tx.party.count({ where }), tx.party.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * pageSize, take: pageSize })]);
        const bal = await Promise.all(rows.map((r) => partyBalance(tx, r.accountId)));
        return paged(rows.map((r, i) => ({ ...r, creditLimit: r.creditLimit ? fmt(r.creditLimit) : null, balance: fmt(bal[i].abs()), balanceSide: bal[i].isZero() ? null : bal[i].gt(0) ? 'DR' : 'CR' })), page, pageSize, total);
      });
    }

    @Post() @RequirePermission(resource, 'create')
    create(@CurrentUser() u: AuthUser, @Body() dto: PartyDto) {
      return this.prisma.tenant(u.companyId, async (tx) => {
        const n = await this.seq.nextGlobal(tx, u.companyId, `PARTY:${kind}`);
        const code = `${kind === 'CUSTOMER' ? 'C' : 'S'}${this.seq.pad(n)}`;
        const group = await tx.accountGroup.findFirstOrThrow({ where: { companyId: u.companyId, code: kind === 'CUSTOMER' ? '1120' : '2110' } });
        const account = await tx.account.create({ data: { companyId: u.companyId, groupId: group.id, code, name: dto.name, type: kind === 'CUSTOMER' ? 'CUSTOMER' : 'SUPPLIER' } });
        const p = await tx.party.create({ data: { ...dto, companyId: u.companyId, kind, code, accountId: account.id } });
        await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: `${kind.toLowerCase()}.created`, entityType: 'party', entityId: p.id, after: p });
        return p;
      });
    }

    @Get(':id') @RequirePermission(resource, 'view')
    get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
      return this.prisma.tenant(u.companyId, async (tx) => {
        const p = await tx.party.findFirstOrThrow({ where: { id, kind } });
        const b = await partyBalance(tx, p.accountId);
        return { ...p, balance: fmt(b.abs()), balanceSide: b.isZero() ? null : b.gt(0) ? 'DR' : 'CR' };
      });
    }

    @Patch(':id') @RequirePermission(resource, 'edit')
    update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePartyDto) {
      return this.prisma.tenant(u.companyId, async (tx) => {
        const before = await tx.party.findFirstOrThrow({ where: { id, kind } });
        const after = await tx.party.update({ where: { id }, data: dto });
        if (dto.name && dto.name !== before.name) await tx.account.update({ where: { id: before.accountId }, data: { name: dto.name } });
        if (dto.isActive !== undefined) await tx.account.update({ where: { id: before.accountId }, data: { isActive: dto.isActive } });
        await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: `${kind.toLowerCase()}.updated`, entityType: 'party', entityId: id, before, after });
        return after;
      });
    }

    @Get(':id/statement') @RequirePermission(resource, 'view')
    statement(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: any) {
      return this.prisma.tenant(u.companyId, async (tx) => {
        const p = await tx.party.findFirst({ where: { id, kind } });
        if (!p) throw new BadRequestException('Party not found');
        return this.reports.run(tx, u.companyId, 'ledger-statement', { ...q, accountId: p.accountId });
      });
    }
  }
  return PartiesController;
}

export const CustomersController = build('CUSTOMER', 'customers', 'customer');
export const SuppliersController = build('SUPPLIER', 'suppliers', 'supplier');
