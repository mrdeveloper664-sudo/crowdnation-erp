import { Controller, ForbiddenException, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AccessService } from '../common/access.service';
import { REPORT_CATALOG, ReportsService } from './reports.service';
import { ReportExportService } from './report-export.service';
import { ReportQuery } from './report.types';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { parseDate } from '../common/dates';
import { D, ZERO, fmt } from '../common/money';
import { PrismaService } from '../common/prisma.service';

import { StreamableFile } from '@nestjs/common';
class StreamableBuffer extends StreamableFile { constructor(b: Buffer) { super(b); } }

@Controller('reports')
export class ReportsController {
  constructor(private prisma: PrismaService, private reports: ReportsService, private exporter: ReportExportService, private access: AccessService) {}

  @Get('catalog') @RequirePermission('report', 'view')
  catalog() { return REPORT_CATALOG; }

  /** Generic report runner: JSON (default) or format=xlsx|pdf|csv|html (print view). */
  @Get('run/:name') @RequirePermission('report', 'view')
  async run(@CurrentUser() u: AuthUser, @Param('name') name: string, @Query() q: ReportQuery, @Res({ passthrough: true }) res: Response) {
    const fmtName = (q.format ?? 'json').toLowerCase();
    const result = await this.prisma.tenant(u.companyId, async (tx) => {
      if (fmtName !== 'json') {
        const needed = fmtName === 'html' ? 'print' : 'export';
        if (!(await this.access.has(tx, u.userId, 'report', needed))) throw new ForbiddenException(`Missing permission report:${needed}`);
      }
      const company = await tx.company.findUniqueOrThrow({ where: { id: u.companyId } });
      return { r: await this.reports.run(tx, u.companyId, name, q), company: company.name };
    });
    if (fmtName === 'json') return result.r;
    const file = `${name}`;
    if (fmtName === 'xlsx') { res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${file}.xlsx"` }); return new StreamableBuffer(await this.exporter.xlsx(result.r, result.company)); }
    if (fmtName === 'pdf') { res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${file}.pdf"` }); return new StreamableBuffer(await this.exporter.pdf(result.r, result.company)); }
    if (fmtName === 'csv') { res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${file}.csv"` }); return new StreamableBuffer(Buffer.from(this.exporter.csv(result.r))); }
    res.set({ 'Content-Type': 'text/html; charset=utf-8' }); return new StreamableBuffer(Buffer.from(this.exporter.html(result.r, result.company)));
  }

  /**
   * Trial balance computed ONLY from posted journal lines (no stored totals).
   * Columns: opening (before `from`), period debit/credit, closing.
   */
  @Get('trial-balance') @RequirePermission('report', 'view')
  trialBalance(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string, @Query('hideZero') hideZero?: string) {
    const f = from ? parseDate(from, 'from') : parseDate('1900-01-01');
    const t = to ? parseDate(to, 'to') : parseDate('9999-12-31');
    return this.prisma.tenant(u.companyId, async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        SELECT a.id, a.code, a.name, g.name AS "groupName", g.nature,
          COALESCE(SUM(l.debit - l.credit) FILTER (WHERE e.entry_date < ${f}), 0) AS opening,
          COALESCE(SUM(l.debit) FILTER (WHERE e.entry_date BETWEEN ${f} AND ${t}), 0) AS debit,
          COALESCE(SUM(l.credit) FILTER (WHERE e.entry_date BETWEEN ${f} AND ${t}), 0) AS credit
        FROM accounts a
        JOIN account_groups g ON g.id = a.group_id
        LEFT JOIN journal_entry_lines l ON l.account_id = a.id
        LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.entry_date <= ${t}
        WHERE a.company_id = ${u.companyId}::uuid
        GROUP BY a.id, g.name, g.nature ORDER BY a.code`;
      let totOpDr = ZERO, totOpCr = ZERO, totDr = ZERO, totCr = ZERO, totClDr = ZERO, totClCr = ZERO;
      const items = rows.map((r) => {
        const op = D(r.opening), dr = D(r.debit), cr = D(r.credit), cl = op.add(dr).sub(cr);
        const opDr = op.gt(0) ? op : ZERO, opCr = op.lt(0) ? op.neg() : ZERO, clDr = cl.gt(0) ? cl : ZERO, clCr = cl.lt(0) ? cl.neg() : ZERO;
        totOpDr = totOpDr.add(opDr); totOpCr = totOpCr.add(opCr); totDr = totDr.add(dr); totCr = totCr.add(cr); totClDr = totClDr.add(clDr); totClCr = totClCr.add(clCr);
        return { accountId: r.id, code: r.code, name: r.name, groupName: r.groupName, nature: r.nature,
          openingDebit: fmt(opDr), openingCredit: fmt(opCr), debit: fmt(dr), credit: fmt(cr), closingDebit: fmt(clDr), closingCredit: fmt(clCr) };
      }).filter((r) => hideZero !== 'true' || [r.openingDebit, r.openingCredit, r.debit, r.credit, r.closingDebit, r.closingCredit].some((v) => D(v).gt(0)));
      return {
        from: from ?? null, to: to ?? null, items,
        totals: { openingDebit: fmt(totOpDr), openingCredit: fmt(totOpCr), debit: fmt(totDr), credit: fmt(totCr), closingDebit: fmt(totClDr), closingCredit: fmt(totClCr) },
        balanced: totOpDr.eq(totOpCr) && totDr.eq(totCr) && totClDr.eq(totClCr),
      };
    });
  }
}
