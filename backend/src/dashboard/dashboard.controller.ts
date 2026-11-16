import { Controller, Get, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { parseDate } from '../common/dates';
import { D, ZERO, fmt } from '../common/money';
import { PrismaService } from '../common/prisma.service';

/** All figures are aggregated live from posted journals / documents - nothing is cached or hand-maintained. */
@Controller('dashboard')
export class DashboardController {
  constructor(private prisma: PrismaService) {}

  @Get() @RequirePermission('report', 'view')
  summary(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string, @Query('financialYearId') fyId?: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const c = u.companyId;
      let f: Date, t: Date; let label: string;
      if (fyId) { const fy = await tx.financialYear.findUniqueOrThrow({ where: { id: fyId } }); f = from ? parseDate(from) : fy.startDate; t = to ? parseDate(to) : fy.endDate; label = fy.name; }
      else {
        const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
        const fy = await tx.financialYear.findFirst({ where: { startDate: { lte: today }, endDate: { gte: today } } });
        f = from ? parseDate(from) : fy?.startDate ?? new Date(Date.UTC(today.getUTCFullYear(), 0, 1)); t = to ? parseDate(to) : today; label = fy?.name ?? 'Current';
      }
      const nat = await tx.$queryRaw<{ nature: string; net: Prisma.Decimal }[]>`
        SELECT g.nature, SUM(l.debit - l.credit) AS net FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id JOIN account_groups g ON g.id = a.group_id
        WHERE l.company_id = ${c}::uuid AND e.entry_date BETWEEN ${f} AND ${t} AND g.nature IN ('INCOME','EXPENSE') GROUP BY g.nature`;
      const net = (n: string) => D(nat.find((x) => x.nature === n)?.net);
      const revenue = net('INCOME').neg(), expenses = net('EXPENSE');
      const bal = await tx.$queryRaw<{ type: string; net: Prisma.Decimal }[]>`
        SELECT a.type, SUM(l.debit - l.credit) AS net FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
        WHERE l.company_id = ${c}::uuid AND e.entry_date <= ${t} AND a.type IN ('CASH','BANK','CUSTOMER','SUPPLIER','INVENTORY') GROUP BY a.type`;
      const b = (ty: string) => D(bal.find((x) => x.type === ty)?.net);
      const monthly = await tx.$queryRaw<{ m: string; side: string; type: string; net: Prisma.Decimal }[]>`
        SELECT to_char(d.doc_date, 'YYYY-MM') AS m, d.side, d.type, SUM(d.net * d.exchange_rate) AS net FROM documents d
        WHERE d.company_id = ${c}::uuid AND d.status = 'POSTED' AND d.type IN ('INVOICE','CREDIT_NOTE','DEBIT_NOTE') AND d.doc_date BETWEEN ${f} AND ${t} GROUP BY 1,2,3 ORDER BY 1`;
      const months = [...new Set(monthly.map((x) => x.m))];
      const series = (side: string) => months.map((m) => { const inv = monthly.filter((x) => x.m === m && x.side === side && x.type === 'INVOICE').reduce((s, x) => s.add(D(x.net)), ZERO); const note = monthly.filter((x) => x.m === m && x.side === side && x.type !== 'INVOICE').reduce((s, x) => s.add(D(x.net)), ZERO); return { month: m, amount: fmt(inv.sub(note)) }; });
      const top = await tx.$queryRaw<{ name: string; total: Prisma.Decimal }[]>`
        SELECT p.name, SUM(CASE WHEN d.type = 'INVOICE' THEN d.net ELSE -d.net END * d.exchange_rate) AS total FROM documents d JOIN parties p ON p.id = d.party_id
        WHERE d.company_id = ${c}::uuid AND d.side = 'SALES' AND d.status = 'POSTED' AND d.type IN ('INVOICE','CREDIT_NOTE') AND d.doc_date BETWEEN ${f} AND ${t} GROUP BY p.name ORDER BY total DESC LIMIT 5`;
      const vat = await tx.taxTransaction.groupBy({ by: ['direction'], where: { companyId: c, txnDate: { gte: f, lte: t } }, _sum: { taxAmount: true } });
      const out = D(vat.find((v) => v.direction === 'OUTPUT')?._sum.taxAmount), inn = D(vat.find((v) => v.direction === 'INPUT')?._sum.taxAmount);
      const stock = await tx.stockMovement.aggregate({ where: { companyId: c, movementDate: { lte: t } }, _sum: { totalCost: true } });
      const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
      const [pendingVouchers, draftDocs, overdue, pendingExpenses, pendingLeave] = await Promise.all([
        tx.voucher.count({ where: { status: 'PENDING_APPROVAL' } }), tx.document.count({ where: { status: 'DRAFT' } }),
        tx.document.count({ where: { status: 'POSTED', type: 'INVOICE', side: 'SALES', dueDate: { lt: today } } }),
        tx.expense.count({ where: { status: 'SUBMITTED' } }), tx.leaveRequest.count({ where: { status: 'PENDING' } }),
      ]);
      const lowStockRows = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM (SELECT p.id FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id WHERE p.company_id = ${c}::uuid AND p.track_inventory AND p.is_active AND p.min_stock > 0 GROUP BY p.id, p.min_stock HAVING COALESCE(SUM(m.quantity),0) <= p.min_stock) s`;
      return {
        period: { label, from: f.toISOString().slice(0, 10), to: t.toISOString().slice(0, 10) },
        revenue: fmt(revenue), expenses: fmt(expenses), netProfit: fmt(revenue.sub(expenses)),
        cashBalance: fmt(b('CASH')), bankBalance: fmt(b('BANK')), receivables: fmt(b('CUSTOMER')), payables: fmt(b('SUPPLIER').neg()),
        inventoryValue: fmt(D(stock._sum.totalCost)),
        vat: { output: fmt(out), input: fmt(inn), net: fmt(out.sub(inn)) },
        salesPerformance: series('SALES'), purchasePerformance: series('PURCHASE'), topCustomers: top.map((x) => ({ name: x.name, total: fmt(x.total) })),
        alerts: { pendingVoucherApprovals: pendingVouchers, draftDocuments: draftDocs, overdueInvoices: overdue, pendingExpenseApprovals: pendingExpenses, pendingLeaveRequests: pendingLeave, lowStockItems: Number(lowStockRows[0].n) },
      };
    });
  }
}
