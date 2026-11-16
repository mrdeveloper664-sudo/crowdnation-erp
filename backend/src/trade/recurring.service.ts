import { BadRequestException, Injectable } from '@nestjs/common';
import { Frequency } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { isoDate, parseDate } from '../common/dates';
import { PrismaService } from '../common/prisma.service';
import { DocLineDto } from './documents.dto';
import { DocumentsService } from './documents.service';

export function advance(d: Date, f: Frequency): Date {
  const n = new Date(d.getTime());
  if (f === 'WEEKLY') n.setUTCDate(n.getUTCDate() + 7);
  else { const months = f === 'MONTHLY' ? 1 : f === 'QUARTERLY' ? 3 : 12; const day = n.getUTCDate(); n.setUTCDate(1); n.setUTCMonth(n.getUTCMonth() + months); const last = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).getUTCDate(); n.setUTCDate(Math.min(day, last)); }
  return n;
}

@Injectable()
export class RecurringService {
  constructor(private prisma: PrismaService, private docs: DocumentsService, private audit: AuditService) {}

  list(companyId: string) {
    return this.prisma.tenant(companyId, async (tx) => (await tx.recurringInvoice.findMany({ orderBy: { nextRunDate: 'asc' } })).map((r) => ({ ...r, nextRunDate: isoDate(r.nextRunDate), endDate: r.endDate ? isoDate(r.endDate) : null })));
  }

  create(companyId: string, userId: string, dto: { partyId: string; frequency: Frequency; startDate: string; endDate?: string; autoPost?: boolean; pricesIncludeVat?: boolean; lines: DocLineDto[] }) {
    return this.prisma.tenant(companyId, async (tx) => {
      const party = await tx.party.findUnique({ where: { id: dto.partyId } });
      if (!party || party.kind !== 'CUSTOMER') throw new BadRequestException('Customer required');
      const r = await tx.recurringInvoice.create({ data: { companyId, partyId: dto.partyId, frequency: dto.frequency, nextRunDate: parseDate(dto.startDate), endDate: dto.endDate ? parseDate(dto.endDate) : null, autoPost: !!dto.autoPost, template: { lines: dto.lines, pricesIncludeVat: !!dto.pricesIncludeVat } as any } });
      await this.audit.log(tx, { companyId, userId, action: 'recurring_invoice.created', entityType: 'recurring_invoice', entityId: r.id });
      return r;
    });
  }

  setActive(companyId: string, id: string, isActive: boolean) {
    return this.prisma.tenant(companyId, (tx) => tx.recurringInvoice.update({ where: { id }, data: { isActive } }));
  }

  /** Generates every invoice due on or before `asOf`. Call from a daily scheduler (cron / queue). */
  async run(companyId: string, userId: string, asOf: string) {
    const date = parseDate(asOf, 'asOf');
    return this.prisma.tenant(companyId, async (tx) => {
      const due = await tx.recurringInvoice.findMany({ where: { isActive: true, nextRunDate: { lte: date } } });
      const created: string[] = [];
      for (const r of due) {
        let next = r.nextRunDate;
        while (next <= date && (!r.endDate || next <= r.endDate)) {
          const t = r.template as any;
          const doc = await this.docs.create(companyId, userId, 'SALES', { type: 'INVOICE', partyId: r.partyId, date: isoDate(next), pricesIncludeVat: t.pricesIncludeVat, notes: 'Recurring invoice', lines: t.lines }, tx);
          await tx.document.update({ where: { id: doc.id }, data: { recurringId: r.id } });
          if (r.autoPost) await this.docs.post(companyId, userId, doc.id, tx);
          created.push(doc.number);
          next = advance(next, r.frequency);
        }
        await tx.recurringInvoice.update({ where: { id: r.id }, data: { nextRunDate: next, lastRunAt: new Date(), isActive: !r.endDate || next <= r.endDate } });
      }
      return { generated: created.length, invoices: created };
    });
  }
}
