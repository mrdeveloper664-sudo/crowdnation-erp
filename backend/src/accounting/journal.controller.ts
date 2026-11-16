import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { isoDate } from '../common/dates';
import { fmt } from '../common/money';
import { PrismaService } from '../common/prisma.service';

/** Read-only view of a posted journal entry (target of report drill-downs). */
@Controller('journal-entries')
export class JournalController {
  constructor(private prisma: PrismaService) {}

  @Get(':id') @RequirePermission('journal', 'view')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const e = await tx.journalEntry.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' }, include: { account: { select: { code: true, name: true } } } }, reversedBy: { select: { id: true, entryNumber: true } }, reversalOf: { select: { id: true, entryNumber: true } } } });
      const voucher = await tx.voucher.findFirst({ where: { OR: [{ journalEntryId: id }, { reversalEntryId: id }] }, select: { id: true, number: true, type: true } });
      return { ...e, entryDate: isoDate(e.entryDate), exchangeRate: e.exchangeRate.toString(), voucher, lines: e.lines.map((l) => ({ ...l, debit: fmt(l.debit), credit: fmt(l.credit), foreignAmount: l.foreignAmount?.toString() ?? null })) };
    });
  }
}
