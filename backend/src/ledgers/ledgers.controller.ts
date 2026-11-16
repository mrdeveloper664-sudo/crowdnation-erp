import { BadRequestException, Body, ConflictException, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { AccountType, Prisma } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { isoDate, parseDate } from '../common/dates';
import { D, ZERO, fmt } from '../common/money';
import { paged } from '../common/interceptors/response.interceptor';
import { PrismaService } from '../common/prisma.service';
import { IsMoney } from '../common/validators';
import { PostingService } from '../accounting/posting.service';

class OpeningItemDto {
  @IsUUID() accountId: string;
  @IsMoney() debit: string;
  @IsMoney() credit: string;
}
class OpeningDto {
  @IsUUID() financialYearId: string;
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => OpeningItemDto) items: OpeningItemDto[];
}

@Controller('ledgers')
export class LedgersController {
  constructor(private prisma: PrismaService, private posting: PostingService, private audit: AuditService) {}

  /** Ledger list with live balances computed from posted journal lines. */
  @Get() @RequirePermission('ledger', 'view')
  async list(@CurrentUser() u: AuthUser, @Query('type') type?: AccountType, @Query('search') search?: string, @Query('asOf') asOf?: string) {
    const to = asOf ? parseDate(asOf, 'asOf') : parseDate('9999-12-31');
    return this.prisma.tenant(u.companyId, async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        SELECT a.id, a.code, a.name, a.type, a.is_active AS "isActive", g.name AS "groupName", g.nature,
               COALESCE(SUM(l.debit) FILTER (WHERE e.id IS NOT NULL), 0) AS debit, COALESCE(SUM(l.credit) FILTER (WHERE e.id IS NOT NULL), 0) AS credit
        FROM accounts a
        JOIN account_groups g ON g.id = a.group_id
        LEFT JOIN journal_entry_lines l ON l.account_id = a.id
        LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.entry_date <= ${to}
        WHERE a.company_id = ${u.companyId}::uuid
          ${type ? Prisma.sql`AND a.type = ${type}::"AccountType"` : Prisma.empty}
          ${search ? Prisma.sql`AND (a.name ILIKE ${'%' + search + '%'} OR a.code ILIKE ${'%' + search + '%'})` : Prisma.empty}
        GROUP BY a.id, g.name, g.nature
        ORDER BY a.code`;
      return rows.map((r) => this.withBalance(r));
    });
  }

  private withBalance(r: any) {
    const net = D(r.debit).sub(D(r.credit));
    return { ...r, debit: fmt(r.debit), credit: fmt(r.credit), balance: fmt(net.abs()), balanceSide: net.isZero() ? null : net.gt(0) ? 'DR' : 'CR' };
  }

  @Get('opening-balances') @RequirePermission('ledger', 'view')
  openingBalances(@CurrentUser() u: AuthUser, @Query('financialYearId', ParseUUIDPipe) fy: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const items = await tx.ledgerOpeningBalance.findMany({ where: { financialYearId: fy }, include: { account: { select: { code: true, name: true } } } });
      const dr = items.reduce((s, i) => s.add(i.debit), ZERO);
      const cr = items.reduce((s, i) => s.add(i.credit), ZERO);
      return { items, totalDebit: fmt(dr), totalCredit: fmt(cr), difference: fmt(dr.sub(cr)), posted: items.some((i) => i.posted) };
    });
  }

  @Put('opening-balances') @RequirePermission('ledger', 'edit')
  setOpening(@CurrentUser() u: AuthUser, @Body() dto: OpeningDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      if (await tx.ledgerOpeningBalance.count({ where: { financialYearId: dto.financialYearId, posted: true } })) {
        throw new ConflictException('Opening balances are already posted; correct them with a journal voucher');
      }
      await tx.financialYear.findUniqueOrThrow({ where: { id: dto.financialYearId } });
      const ids = [...new Set(dto.items.map((i) => i.accountId))];
      if (ids.length !== dto.items.length) throw new BadRequestException('Duplicate account in opening balances');
      if ((await tx.account.count({ where: { id: { in: ids } } })) !== ids.length) throw new BadRequestException('Unknown account');
      for (const i of dto.items) if (D(i.debit).gt(0) && D(i.credit).gt(0)) throw new BadRequestException('An opening balance is either debit or credit');
      await tx.ledgerOpeningBalance.deleteMany({ where: { financialYearId: dto.financialYearId } });
      await tx.ledgerOpeningBalance.createMany({
        data: dto.items.filter((i) => D(i.debit).gt(0) || D(i.credit).gt(0)).map((i) => ({ companyId: u.companyId, financialYearId: dto.financialYearId, accountId: i.accountId, debit: i.debit, credit: i.credit })),
      });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'opening_balances.saved', entityType: 'financial_year', entityId: dto.financialYearId, after: dto.items });
      return { saved: dto.items.length };
    });
  }

  /** Posts opening balances as ONE balanced journal; any difference goes to the "Opening Balance Difference" account. */
  @Post('opening-balances/post') @RequirePermission('ledger', 'post')
  postOpening(@CurrentUser() u: AuthUser, @Body('financialYearId', ParseUUIDPipe) fyId: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const fy = await tx.financialYear.findUniqueOrThrow({ where: { id: fyId } });
      const items = await tx.ledgerOpeningBalance.findMany({ where: { financialYearId: fyId } });
      if (!items.length) throw new BadRequestException('No opening balances to post');
      if (items.some((i) => i.posted)) throw new ConflictException('Opening balances already posted');
      const lines = items.map((i) => ({ accountId: i.accountId, debit: i.debit, credit: i.credit, description: 'Opening balance' }));
      const dr = items.reduce((s, i) => s.add(i.debit), ZERO);
      const cr = items.reduce((s, i) => s.add(i.credit), ZERO);
      const diff = dr.sub(cr);
      if (!diff.isZero()) {
        const suspense = await tx.account.findFirstOrThrow({ where: { companyId: u.companyId, systemKey: 'OPENING_DIFFERENCE' } });
        lines.push({ accountId: suspense.id, debit: diff.isNegative() ? diff.abs() : ZERO, credit: diff.isNegative() ? ZERO : diff, description: 'Opening balance difference' });
      }
      const entry = await this.posting.post(tx, {
        companyId: u.companyId, userId: u.userId, entryDate: fy.startDate, sourceType: 'OPENING_BALANCE', sourceId: fy.id,
        idempotencyKey: `opening:${fy.id}`, narration: `Opening balances ${fy.name}`, lines,
      });
      await tx.ledgerOpeningBalance.updateMany({ where: { financialYearId: fyId }, data: { posted: true } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'opening_balances.posted', entityType: 'journal_entry', entityId: entry.id, after: { difference: fmt(diff) } });
      return { journalEntryId: entry.id, entryNumber: entry.entryNumber, difference: fmt(diff) };
    });
  }

  @Get(':id') @RequirePermission('ledger', 'view')
  async one(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const acc = await tx.account.findUniqueOrThrow({ where: { id }, include: { group: true } });
      const [r] = await tx.$queryRaw<any[]>`
        SELECT COALESCE(SUM(debit),0) AS debit, COALESCE(SUM(credit),0) AS credit FROM journal_entry_lines WHERE account_id = ${id}::uuid`;
      return { ...acc, ...this.withBalance(r) };
    });
  }

  /** Ledger statement with opening balance and running balance. */
  @Get(':id/statement') @RequirePermission('ledger', 'view')
  statement(
    @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from?: string, @Query('to') to?: string, @Query('search') search?: string,
    @Query('page') pageQ?: string, @Query('pageSize') sizeQ?: string,
  ) {
    const f = from ? parseDate(from, 'from') : parseDate('1900-01-01');
    const t = to ? parseDate(to, 'to') : parseDate('9999-12-31');
    const page = Math.max(1, Number(pageQ) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(sizeQ) || 50));
    return this.prisma.tenant(u.companyId, async (tx) => {
      const acc = await tx.account.findUniqueOrThrow({ where: { id }, select: { id: true, code: true, name: true } });
      const [open] = await tx.$queryRaw<any[]>`
        SELECT COALESCE(SUM(l.debit - l.credit),0) AS net FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.account_id = ${id}::uuid AND e.entry_date < ${f}`;
      const filter = search ? Prisma.sql`AND (e.narration ILIKE ${'%' + search + '%'} OR l.description ILIKE ${'%' + search + '%'} OR e.entry_number ILIKE ${'%' + search + '%'})` : Prisma.empty;
      const [{ count }] = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.account_id = ${id}::uuid AND e.entry_date BETWEEN ${f} AND ${t} ${filter}`;
      const rows = await tx.$queryRaw<any[]>`
        SELECT * FROM (
          SELECT e.id AS "entryId", e.entry_number AS "entryNumber", e.entry_date AS "date", e.source_type AS "sourceType", e.source_id AS "sourceId",
                 COALESCE(l.description, e.narration) AS narration, l.debit, l.credit,
                 ${open.net}::numeric + SUM(l.debit - l.credit) OVER (ORDER BY e.entry_date, e.entry_number, l.line_no ROWS UNBOUNDED PRECEDING) AS running
          FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
          WHERE l.account_id = ${id}::uuid AND e.entry_date BETWEEN ${f} AND ${t} ${filter}
        ) s ORDER BY "date", "entryNumber" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
      const [tot] = await tx.$queryRaw<any[]>`
        SELECT COALESCE(SUM(l.debit),0) AS debit, COALESCE(SUM(l.credit),0) AS credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.account_id = ${id}::uuid AND e.entry_date BETWEEN ${f} AND ${t}`;
      const sideOf = (n: any) => { const d = D(n); return { amount: fmt(d.abs()), side: d.isZero() ? null : d.gt(0) ? 'DR' : 'CR' }; };
      const openingNet = D(open.net);
      const items = rows.map((r) => ({
        ...r, date: isoDate(r.date), debit: fmt(r.debit), credit: fmt(r.credit), running: sideOf(r.running),
      }));
      const out = paged(items, page, pageSize, Number(count));
      return {
        ...out,
        meta: {
          ...out.meta, account: acc, from: from ?? null, to: to ?? null, opening: sideOf(openingNet),
          totalDebit: fmt(tot.debit), totalCredit: fmt(tot.credit), closing: sideOf(openingNet.add(D(tot.debit)).sub(D(tot.credit))),
        },
      };
    });
  }
}
