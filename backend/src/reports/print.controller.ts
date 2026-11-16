import { Controller, Get, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { isoDate } from '../common/dates';
import { fmt } from '../common/money';
import { PrismaService } from '../common/prisma.service';
import { ReportExportService } from './report-export.service';
import { ReportResult } from './report.types';

/** Printable / PDF renderings of single documents (vouchers and sales/purchase documents). */
@Controller()
export class PrintController {
  constructor(private prisma: PrismaService, private exporter: ReportExportService) {}

  private async send(res: Response, r: ReportResult, company: string, format: string, file: string) {
    if (format === 'pdf') { res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${file}.pdf"` }); return new StreamableFile(await this.exporter.pdf(r, company)); }
    res.set({ 'Content-Type': 'text/html; charset=utf-8' }); return new StreamableFile(Buffer.from(this.exporter.html(r, company)));
  }

  @Get('vouchers/:id/print') @RequirePermission('voucher', 'print')
  async voucher(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('format') format = 'html', @Res({ passthrough: true }) res: Response) {
    const { v, company } = await this.prisma.tenant(u.companyId, async (tx) => ({
      v: await tx.voucher.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } }),
      company: await tx.company.findUniqueOrThrow({ where: { id: u.companyId } }),
    }));
    const accounts = await this.prisma.tenant(u.companyId, (tx) => tx.account.findMany({ where: { id: { in: v.lines.map((l) => l.accountId) } } }));
    const nm = new Map(accounts.map((a) => [a.id, `${a.code}  ${a.name}`]));
    const r: ReportResult = {
      name: 'voucher', title: `${v.type.replace('_', ' ')} Voucher ${v.number}`, subtitle: `Date ${isoDate(v.voucherDate)} · Status ${v.status}${v.reference ? ' · Ref ' + v.reference : ''}`,
      columns: [{ key: 'account', label: 'Account' }, { key: 'description', label: 'Description' }, { key: 'debit', label: 'Debit', align: 'right' }, { key: 'credit', label: 'Credit', align: 'right' }],
      rows: [...v.lines.map((l) => ({ account: nm.get(l.accountId), description: l.description ?? '', debit: l.debit.gt(0) ? fmt(l.debit) : '', credit: l.credit.gt(0) ? fmt(l.credit) : '' })), { account: 'TOTAL', _kind: 'total' as const, debit: fmt(v.lines.reduce((s, l) => s.add(l.debit), v.totalAmount.mul(0))), credit: fmt(v.lines.reduce((s, l) => s.add(l.credit), v.totalAmount.mul(0))) }],
      summary: [{ label: 'Currency', value: v.currency }, ...(v.narration ? [{ label: 'Narration', value: v.narration }] : [])],
    };
    return this.send(res, r, `${company.name}${company.trn ? ' (TRN ' + company.trn + ')' : ''}`, format, v.number);
  }

  private async doc(u: AuthUser, id: string, format: string, res: Response) {
    const { d, company } = await this.prisma.tenant(u.companyId, async (tx) => ({
      d: await tx.document.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } }, party: true } }),
      company: await tx.company.findUniqueOrThrow({ where: { id: u.companyId } }),
    }));
    const taxInvoice = d.side === 'SALES' && d.type === 'INVOICE';
    const r: ReportResult = {
      name: 'document', title: `${taxInvoice ? 'TAX INVOICE' : d.type.replace('_', ' ')} ${d.number}`,
      subtitle: `${d.side === 'SALES' ? 'Customer' : 'Supplier'}: ${d.party.name}${d.party.trn ? ' (TRN ' + d.party.trn + ')' : ''} · Date ${isoDate(d.docDate)}${d.dueDate ? ' · Due ' + isoDate(d.dueDate) : ''} · ${d.currency}`,
      columns: [{ key: 'description', label: 'Description' }, { key: 'qty', label: 'Qty', align: 'right' }, { key: 'price', label: 'Unit price', align: 'right' }, { key: 'net', label: 'Net', align: 'right' }, { key: 'vat', label: 'VAT', align: 'right' }, { key: 'total', label: 'Total', align: 'right' }],
      rows: d.lines.map((l) => ({ description: l.description, qty: l.quantity.toString(), price: fmt(l.unitPrice), net: fmt(l.net), vat: fmt(l.vat), total: fmt(l.gross) })),
      summary: [{ label: 'Net', value: fmt(d.net) }, { label: 'VAT', value: fmt(d.vat) }, { label: 'Total', value: `${fmt(d.total)} ${d.currency}` }, ...(d.notes ? [{ label: 'Notes', value: d.notes }] : [])],
    };
    return this.send(res, r, `${company.name}${company.trn ? ' (TRN ' + company.trn + ')' : ''}`, format, d.number);
  }
  @Get('sales/documents/:id/print') @RequirePermission('sales', 'print')
  sales(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('format') format = 'html', @Res({ passthrough: true }) res: Response) { return this.doc(u, id, format, res); }
  @Get('purchases/documents/:id/print') @RequirePermission('purchase', 'print')
  purchases(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('format') format = 'html', @Res({ passthrough: true }) res: Response) { return this.doc(u, id, format, res); }
}
