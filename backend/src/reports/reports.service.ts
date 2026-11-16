import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isoDate, parseDate } from '../common/dates';
import { D, Decimal, ZERO, fmt } from '../common/money';
import { Tx } from '../common/prisma.service';
import { ReportQuery, ReportResult, ReportRow } from './report.types';
import { InventoryReports } from '../inventory/inventory-reports';
import { MODULE_REPORTS, ModuleReports } from './module-reports';

const MIN = '1900-01-01', MAX = '9999-12-31';
interface Range { from: Date; to: Date; label: string; fyName?: string }
type Meta = { id: string; code: string; name: string; type: string; nature: string; groupId: string; groupName: string; groupCode: string };

export const REPORT_CATALOG = [
  { name: 'trial-balance', title: 'Trial Balance', params: ['from', 'to', 'financialYearId', 'branchId', 'hideZero'] },
  { name: 'profit-and-loss', title: 'Profit and Loss Statement', params: ['from', 'to', 'financialYearId', 'branchId'] },
  { name: 'balance-sheet', title: 'Balance Sheet', params: ['asOf', 'financialYearId', 'branchId'] },
  { name: 'cash-flow', title: 'Cash Flow Statement', params: ['from', 'to', 'financialYearId', 'branchId'] },
  { name: 'general-ledger', title: 'General Ledger', params: ['from', 'to', 'financialYearId', 'branchId', 'accountId', 'search', 'page'] },
  { name: 'day-book', title: 'Day Book', params: ['from', 'to', 'financialYearId', 'branchId', 'voucherType', 'search', 'page'] },
  { name: 'cash-book', title: 'Cash Book', params: ['from', 'to', 'financialYearId', 'branchId', 'accountId', 'page'] },
  { name: 'bank-book', title: 'Bank Book', params: ['from', 'to', 'financialYearId', 'branchId', 'accountId', 'page'] },
  { name: 'ledger-statement', title: 'Ledger Statement', params: ['accountId', 'from', 'to', 'financialYearId', 'page'] },
  { name: 'customer-outstanding', title: 'Customer Outstanding', params: ['asOf', 'search'] },
  { name: 'supplier-outstanding', title: 'Supplier Outstanding', params: ['asOf', 'search'] },
  { name: 'accounts-receivable', title: 'Accounts Receivable Ageing', params: ['asOf', 'search'] },
  { name: 'accounts-payable', title: 'Accounts Payable Ageing', params: ['asOf', 'search'] },
  { name: 'vat', title: 'VAT Report', params: ['from', 'to', 'financialYearId'] },
  { name: 'expense-report', title: 'Expense Report', params: ['from', 'to', 'financialYearId', 'branchId'] },
  { name: 'income-report', title: 'Income Report', params: ['from', 'to', 'financialYearId', 'branchId'] },
  { name: 'lead-report', title: 'Lead Report', params: ['from', 'to'] },
  { name: 'employee-report', title: 'Employee Report', params: [] },
  { name: 'payroll-report', title: 'Payroll Report', params: ['period'] },
  { name: 'expense-budget', title: 'Expense Budget vs Actual', params: ['year', 'month'] },
  { name: 'project-profitability', title: 'Project Profitability', params: [] },
  { name: 'asset-register', title: 'Fixed Asset Register', params: [] },
  { name: 'depreciation-schedule', title: 'Depreciation Schedule', params: [] },
  { name: 'stock-summary', title: 'Stock Summary', params: ['asOf'] },
  { name: 'stock-valuation', title: 'Stock Valuation', params: ['asOf'] },
  { name: 'low-stock', title: 'Low Stock', params: [] },
  { name: 'stock-movements', title: 'Stock Movements', params: ['from', 'to'] },
  { name: 'batch-summary', title: 'Batch Summary', params: ['asOf'] },
];

@Injectable()
export class ReportsService {
  constructor(private invReports: InventoryReports, private modReports: ModuleReports) {}

  async run(tx: Tx, companyId: string, name: string, q: ReportQuery): Promise<ReportResult> {
    switch (name) {
      case 'trial-balance': return this.trialBalance(tx, companyId, q);
      case 'profit-and-loss': return this.profitAndLoss(tx, companyId, q);
      case 'balance-sheet': return this.balanceSheet(tx, companyId, q);
      case 'cash-flow': return this.cashFlow(tx, companyId, q);
      case 'general-ledger': return this.book(tx, companyId, q, 'general-ledger', 'General Ledger', {});
      case 'cash-book': return this.book(tx, companyId, q, 'cash-book', 'Cash Book', { type: 'CASH' });
      case 'bank-book': return this.book(tx, companyId, q, 'bank-book', 'Bank Book', { type: 'BANK' });
      case 'ledger-statement':
        if (!q.accountId) throw new BadRequestException('accountId is required');
        return this.book(tx, companyId, q, 'ledger-statement', 'Ledger Statement', {});
      case 'day-book': return this.dayBook(tx, companyId, q);
      case 'customer-outstanding': return this.outstanding(tx, companyId, q, 'CUSTOMER', false);
      case 'supplier-outstanding': return this.outstanding(tx, companyId, q, 'SUPPLIER', false);
      case 'accounts-receivable': return this.outstanding(tx, companyId, q, 'CUSTOMER', true);
      case 'accounts-payable': return this.outstanding(tx, companyId, q, 'SUPPLIER', true);
      case 'expense-report': return this.incomeExpense(tx, companyId, q, 'EXPENSE');
      case 'income-report': return this.incomeExpense(tx, companyId, q, 'INCOME');
      case 'vat': return this.vatReport(tx, companyId, q);
      case 'stock-summary': case 'stock-valuation': case 'low-stock': case 'stock-movements': case 'batch-summary':
        return this.invReports.run(tx, companyId, name, q as any);
      default:
        if (MODULE_REPORTS.includes(name)) return this.modReports.run(tx, companyId, name, q as any);
        throw new NotFoundException(`Unknown report ${name}`);
    }
  }

  // ------------------------------------------------------------------ helpers
  async range(tx: Tx, q: ReportQuery): Promise<Range> {
    if (q.financialYearId) {
      const fy = await tx.financialYear.findUnique({ where: { id: q.financialYearId } });
      if (!fy) throw new NotFoundException('Financial year not found');
      return { from: q.from ? parseDate(q.from, 'from') : fy.startDate, to: q.to ? parseDate(q.to, 'to') : fy.endDate, label: fy.name, fyName: fy.name };
    }
    const from = q.from ? parseDate(q.from, 'from') : parseDate(MIN);
    const to = q.to ? parseDate(q.to, 'to') : parseDate(MAX);
    return { from, to, label: q.from || q.to ? `${q.from ?? 'beginning'} to ${q.to ?? 'date'}` : 'All dates' };
  }

  private async accounts(tx: Tx, companyId: string): Promise<Map<string, Meta>> {
    const rows = await tx.account.findMany({ where: { companyId }, include: { group: true }, orderBy: { code: 'asc' } });
    return new Map(rows.map((a) => [a.id, { id: a.id, code: a.code, name: a.name, type: a.type, nature: a.group.nature, groupId: a.groupId, groupName: a.group.name, groupCode: a.group.code }]));
  }

  /** debit/credit per account for entries dated within [from,to] (optionally one branch). */
  private async activity(tx: Tx, companyId: string, from: Date, to: Date, branchId?: string) {
    const rows = await tx.$queryRaw<{ account_id: string; debit: Decimal; credit: Decimal }[]>`
      SELECT l.account_id, SUM(l.debit) AS debit, SUM(l.credit) AS credit
      FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.company_id = ${companyId}::uuid AND e.entry_date BETWEEN ${from} AND ${to}
        ${branchId ? Prisma.sql`AND e.branch_id = ${branchId}::uuid` : Prisma.empty}
      GROUP BY l.account_id`;
    return new Map(rows.map((r) => [r.account_id, { debit: D(r.debit), credit: D(r.credit) }]));
  }

  private net(m: Map<string, { debit: Decimal; credit: Decimal }>, id: string) {
    const a = m.get(id);
    return a ? a.debit.sub(a.credit) : ZERO;
  }

  private paging(q: ReportQuery) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(1000, Math.max(1, Number(q.pageSize) || 100));
    return { page, pageSize };
  }

  private page<T>(rows: T[], q: ReportQuery) {
    const { page, pageSize } = this.paging(q);
    return { rows: rows.slice((page - 1) * pageSize, page * pageSize), paging: { page, pageSize, total: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)) } };
  }

  private money = (v: Decimal) => fmt(v);

  // ------------------------------------------------------------------ trial balance
  async trialBalance(tx: Tx, companyId: string, q: ReportQuery): Promise<ReportResult> {
    const r = await this.range(tx, q);
    const metas = await this.accounts(tx, companyId);
    const before = await this.activity(tx, companyId, parseDate(MIN), new Date(r.from.getTime() - 86_400_000), q.branchId);
    const during = await this.activity(tx, companyId, r.from, r.to, q.branchId);
    const rows: ReportRow[] = [];
    const t = { od: ZERO, oc: ZERO, d: ZERO, c: ZERO, cd: ZERO, cc: ZERO };
    for (const m of metas.values()) {
      const op = this.net(before, m.id), a = during.get(m.id), dr = a?.debit ?? ZERO, cr = a?.credit ?? ZERO, cl = op.add(dr).sub(cr);
      if (q.hideZero === 'true' && op.isZero() && dr.isZero() && cr.isZero() && cl.isZero()) continue;
      const row = { od: op.gt(0) ? op : ZERO, oc: op.lt(0) ? op.neg() : ZERO, d: dr, c: cr, cd: cl.gt(0) ? cl : ZERO, cc: cl.lt(0) ? cl.neg() : ZERO };
      (Object.keys(t) as (keyof typeof t)[]).forEach((k) => (t[k] = t[k].add(row[k])));
      rows.push({ code: m.code, name: m.name, group: m.groupName, openingDebit: this.money(row.od), openingCredit: this.money(row.oc), debit: this.money(row.d), credit: this.money(row.c), closingDebit: this.money(row.cd), closingCredit: this.money(row.cc), _drill: { type: 'ledger', id: m.id } });
    }
    rows.push({ name: 'TOTAL', _kind: 'total', openingDebit: this.money(t.od), openingCredit: this.money(t.oc), debit: this.money(t.d), credit: this.money(t.c), closingDebit: this.money(t.cd), closingCredit: this.money(t.cc) });
    const balanced = t.od.eq(t.oc) && t.d.eq(t.c) && t.cd.eq(t.cc);
    return {
      name: 'trial-balance', title: 'Trial Balance', subtitle: r.label,
      columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'group', label: 'Group' },
        ...['openingDebit', 'openingCredit', 'debit', 'credit', 'closingDebit', 'closingCredit'].map((k, i) => ({ key: k, label: ['Opening Dr', 'Opening Cr', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr'][i], align: 'right' as const, type: 'money' as const }))],
      rows, summary: [{ label: 'Balanced', value: balanced ? 'Yes' : 'NO' }], meta: { balanced },
    };
  }

  // ------------------------------------------------------------------ P&L
  private sections(metas: Map<string, Meta>, nature: string, amountOf: (id: string) => Decimal) {
    const byGroup = new Map<string, { name: string; code: string; accounts: { m: Meta; amt: Decimal }[] }>();
    for (const m of metas.values()) {
      if (m.nature !== nature) continue;
      const amt = amountOf(m.id);
      if (amt.isZero()) continue;
      const g = byGroup.get(m.groupId) ?? { name: m.groupName, code: m.groupCode, accounts: [] };
      g.accounts.push({ m, amt });
      byGroup.set(m.groupId, g);
    }
    return [...byGroup.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  private emit(rows: ReportRow[], secs: ReturnType<ReportsService['sections']>, key = 'amount') {
    let total = ZERO;
    for (const g of secs) {
      rows.push({ particulars: g.name, _kind: 'header' });
      let sub = ZERO;
      for (const a of g.accounts) { rows.push({ particulars: `   ${a.m.code}  ${a.m.name}`, [key]: this.money(a.amt), _drill: { type: 'ledger', id: a.m.id } }); sub = sub.add(a.amt); }
      rows.push({ particulars: `Total ${g.name}`, [key]: this.money(sub), _kind: 'subtotal' });
      total = total.add(sub);
    }
    return total;
  }

  async profitAndLoss(tx: Tx, companyId: string, q: ReportQuery): Promise<ReportResult> {
    const r = await this.range(tx, q);
    const metas = await this.accounts(tx, companyId);
    const act = await this.activity(tx, companyId, r.from, r.to, q.branchId);
    const rows: ReportRow[] = [];
    const income = this.emit(rows, this.sections(metas, 'INCOME', (id) => this.net(act, id).neg()));
    rows.push({ particulars: 'TOTAL INCOME', amount: this.money(income), _kind: 'total' });
    const expSecs = this.sections(metas, 'EXPENSE', (id) => this.net(act, id));
    const expense = this.emit(rows, expSecs);
    rows.push({ particulars: 'TOTAL EXPENSES', amount: this.money(expense), _kind: 'total' });
    const profit = income.sub(expense);
    rows.push({ particulars: profit.gte(0) ? 'NET PROFIT' : 'NET LOSS', amount: this.money(profit), _kind: 'total' });
    const direct = expSecs.filter((g) => g.code === '5100').reduce((s, g) => s.add(g.accounts.reduce((x, a) => x.add(a.amt), ZERO)), ZERO);
    return {
      name: 'profit-and-loss', title: 'Profit and Loss Statement', subtitle: r.label,
      columns: [{ key: 'particulars', label: 'Particulars' }, { key: 'amount', label: 'Amount', align: 'right', type: 'money' }], rows,
      summary: [{ label: 'Total income', value: this.money(income) }, { label: 'Gross profit', value: this.money(income.sub(direct)) }, { label: 'Total expenses', value: this.money(expense) }, { label: 'Net profit', value: this.money(profit) }],
      meta: { income: this.money(income), expenses: this.money(expense), netProfit: this.money(profit) },
    };
  }

  // ------------------------------------------------------------------ balance sheet
  async balanceSheet(tx: Tx, companyId: string, q: ReportQuery): Promise<ReportResult> {
    const asOf = q.asOf ? parseDate(q.asOf, 'asOf') : parseDate(MAX);
    const metas = await this.accounts(tx, companyId);
    const act = await this.activity(tx, companyId, parseDate(MIN), asOf, q.branchId);
    const rows: ReportRow[] = [];
    rows.push({ particulars: 'ASSETS', _kind: 'header' });
    const assets = this.emit(rows, this.sections(metas, 'ASSET', (id) => this.net(act, id)));
    rows.push({ particulars: 'TOTAL ASSETS', amount: this.money(assets), _kind: 'total' });
    rows.push({ particulars: 'LIABILITIES', _kind: 'header' });
    const liabilities = this.emit(rows, this.sections(metas, 'LIABILITY', (id) => this.net(act, id).neg()));
    rows.push({ particulars: 'TOTAL LIABILITIES', amount: this.money(liabilities), _kind: 'total' });
    rows.push({ particulars: 'EQUITY', _kind: 'header' });
    const equityAccounts = this.emit(rows, this.sections(metas, 'EQUITY', (id) => this.net(act, id).neg()));
    let earnings = ZERO;
    for (const m of metas.values()) if (m.nature === 'INCOME') earnings = earnings.add(this.net(act, m.id).neg()); else if (m.nature === 'EXPENSE') earnings = earnings.sub(this.net(act, m.id));
    rows.push({ particulars: '   Current period profit / (loss)', amount: this.money(earnings) });
    const equity = equityAccounts.add(earnings);
    rows.push({ particulars: 'TOTAL EQUITY', amount: this.money(equity), _kind: 'total' });
    rows.push({ particulars: 'TOTAL LIABILITIES + EQUITY', amount: this.money(liabilities.add(equity)), _kind: 'total' });
    const balanced = assets.eq(liabilities.add(equity));
    return {
      name: 'balance-sheet', title: 'Balance Sheet', subtitle: `As of ${q.asOf ?? 'today'}`,
      columns: [{ key: 'particulars', label: 'Particulars' }, { key: 'amount', label: 'Amount', align: 'right', type: 'money' }], rows,
      summary: [{ label: 'Total assets', value: this.money(assets) }, { label: 'Liabilities + equity', value: this.money(liabilities.add(equity)) }, { label: 'Balanced', value: balanced ? 'Yes' : 'NO' }],
      meta: { balanced, assets: this.money(assets), liabilities: this.money(liabilities), equity: this.money(equity) },
    };
  }

  // ------------------------------------------------------------------ cash flow (indirect)
  async cashFlow(tx: Tx, companyId: string, q: ReportQuery): Promise<ReportResult> {
    const r = await this.range(tx, q);
    const metas = await this.accounts(tx, companyId);
    const groups = await tx.accountGroup.findMany({ where: { companyId } });
    const gp = new Map(groups.map((g) => [g.id, g]));
    const longTerm = (groupId: string) => { for (let g = gp.get(groupId); g; g = g.parentId ? gp.get(g.parentId) : undefined) if (g.code === '2200') return true; return false; };
    const dayBefore = new Date(r.from.getTime() - 86_400_000);
    const open = await this.activity(tx, companyId, parseDate(MIN), dayBefore, q.branchId);
    const during = await this.activity(tx, companyId, r.from, r.to, q.branchId);
    const delta = (id: string) => this.net(during, id); // movement in the period (debit - credit)
    let netProfit = ZERO, adj = ZERO, openingCash = ZERO, closingCash = ZERO;
    const wc: ReportRow[] = [], inv: ReportRow[] = [], fin: ReportRow[] = [];
    let wcT = ZERO, invT = ZERO, finT = ZERO;
    for (const m of metas.values()) {
      const d = delta(m.id);
      if (m.type === 'CASH' || m.type === 'BANK') { openingCash = openingCash.add(this.net(open, m.id)); closingCash = closingCash.add(this.net(open, m.id)).add(d); continue; }
      if (d.isZero()) continue;
      if (m.nature === 'INCOME' || m.nature === 'EXPENSE') { netProfit = netProfit.sub(d); continue; }
      const cash = d.neg(); // increase in an asset uses cash; increase in liability/equity provides cash
      const line = { particulars: `   ${m.name}`, amount: this.money(cash), _drill: { type: 'ledger' as const, id: m.id } };
      if (m.type === 'ACCUMULATED_DEPRECIATION') { adj = adj.add(cash); wc.push({ ...line, particulars: `   Add back: ${m.name}` }); wcT = wcT.add(cash); }
      else if (m.type === 'FIXED_ASSET') { inv.push(line); invT = invT.add(cash); }
      else if (m.nature === 'EQUITY' || (m.nature === 'LIABILITY' && longTerm(m.groupId))) { fin.push(line); finT = finT.add(cash); }
      else { wc.push(line); wcT = wcT.add(cash); }
    }
    const operating = netProfit.add(wcT), change = operating.add(invT).add(finT);
    const rows: ReportRow[] = [
      { particulars: 'OPERATING ACTIVITIES', _kind: 'header' }, { particulars: '   Net profit / (loss)', amount: this.money(netProfit) }, ...wc,
      { particulars: 'Net cash from operating activities', amount: this.money(operating), _kind: 'subtotal' },
      { particulars: 'INVESTING ACTIVITIES', _kind: 'header' }, ...inv, { particulars: 'Net cash from investing activities', amount: this.money(invT), _kind: 'subtotal' },
      { particulars: 'FINANCING ACTIVITIES', _kind: 'header' }, ...fin, { particulars: 'Net cash from financing activities', amount: this.money(finT), _kind: 'subtotal' },
      { particulars: 'NET CHANGE IN CASH AND BANK', amount: this.money(change), _kind: 'total' },
      { particulars: 'Opening cash and bank', amount: this.money(openingCash) },
      { particulars: 'Closing cash and bank', amount: this.money(closingCash), _kind: 'total' },
    ];
    const reconciled = openingCash.add(change).eq(closingCash);
    return {
      name: 'cash-flow', title: 'Cash Flow Statement', subtitle: r.label,
      columns: [{ key: 'particulars', label: 'Particulars' }, { key: 'amount', label: 'Amount', align: 'right', type: 'money' }], rows,
      summary: [{ label: 'Net change in cash', value: this.money(change) }, { label: 'Reconciles to cash & bank', value: reconciled ? 'Yes' : 'NO' }],
      meta: { reconciled, operating: this.money(operating), investing: this.money(invT), financing: this.money(finT), openingCash: this.money(openingCash), closingCash: this.money(closingCash) },
    };
  }

  // ------------------------------------------------------------------ ledger books (GL / cash / bank / statement)
  private async book(tx: Tx, companyId: string, q: ReportQuery, name: string, title: string, f: { type?: string }): Promise<ReportResult> {
    const r = await this.range(tx, q);
    const metas = await this.accounts(tx, companyId);
    const ids = [...metas.values()].filter((m) => (q.accountId ? m.id === q.accountId : f.type ? m.type === f.type : true)).map((m) => m.id);
    if (q.accountId && !ids.length) throw new NotFoundException('Account not found');
    if (!ids.length) return { name, title, subtitle: r.label, columns: [], rows: [] };
    const idList = Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`));
    const branch = q.branchId ? Prisma.sql`AND e.branch_id = ${q.branchId}::uuid` : Prisma.empty;
    const opening = await tx.$queryRaw<{ account_id: string; net: Decimal }[]>`
      SELECT l.account_id, SUM(l.debit - l.credit) AS net FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.account_id IN (${idList}) AND e.entry_date < ${r.from} ${branch} GROUP BY l.account_id`;
    const lines = await tx.$queryRaw<any[]>`
      SELECT l.account_id, e.id AS entry_id, e.entry_number, e.entry_date, e.source_type, e.source_id, COALESCE(l.description, e.narration) AS narration,
             l.debit, l.credit, v.number AS voucher_number, v.id AS voucher_id
      FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
      LEFT JOIN vouchers v ON v.journal_entry_id = e.id OR v.reversal_entry_id = e.id
      WHERE l.account_id IN (${idList}) AND e.entry_date BETWEEN ${r.from} AND ${r.to} ${branch}
        ${q.search ? Prisma.sql`AND (e.narration ILIKE ${'%' + q.search + '%'} OR l.description ILIKE ${'%' + q.search + '%'} OR e.entry_number ILIKE ${'%' + q.search + '%'} OR v.number ILIKE ${'%' + q.search + '%'})` : Prisma.empty}
      ORDER BY l.account_id, e.entry_date, e.entry_number, l.line_no`;
    const open = new Map(opening.map((o) => [o.account_id, D(o.net)]));
    const byAcc = new Map<string, any[]>();
    for (const l of lines) byAcc.set(l.account_id, [...(byAcc.get(l.account_id) ?? []), l]);
    const side = (n: Decimal) => `${n.abs().toFixed(2)} ${n.isZero() ? '' : n.gt(0) ? 'Dr' : 'Cr'}`.trim();
    const rows: ReportRow[] = [];
    for (const id of ids) {
      const ls = byAcc.get(id) ?? []; const op = open.get(id) ?? ZERO;
      if (!ls.length && op.isZero() && !q.accountId) continue;
      const m = metas.get(id)!;
      let run = op, td = ZERO, tc = ZERO;
      rows.push({ date: '', particulars: `${m.code}  ${m.name}`, _kind: 'header', _drill: { type: 'ledger', id } });
      rows.push({ date: '', particulars: 'Opening balance', balance: side(op) });
      for (const l of ls) {
        run = run.add(l.debit).sub(l.credit); td = td.add(l.debit); tc = tc.add(l.credit);
        rows.push({ date: isoDate(l.entry_date), voucher: l.voucher_number ?? l.entry_number, particulars: l.narration ?? '', debit: this.money(D(l.debit)), credit: this.money(D(l.credit)), balance: side(run), _drill: l.voucher_id ? { type: 'voucher', id: l.voucher_id } : { type: 'entry', id: l.entry_id } });
      }
      rows.push({ date: '', particulars: 'Closing balance', debit: this.money(td), credit: this.money(tc), balance: side(run), _kind: 'subtotal' });
    }
    const p = this.page(rows, q);
    return {
      name, title, subtitle: r.label, rows: p.rows, paging: p.paging,
      columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'voucher', label: 'Voucher' }, { key: 'particulars', label: 'Particulars' },
        { key: 'debit', label: 'Debit', align: 'right', type: 'money' }, { key: 'credit', label: 'Credit', align: 'right', type: 'money' }, { key: 'balance', label: 'Balance', align: 'right' }],
    };
  }

  // ------------------------------------------------------------------ day book
  private async dayBook(tx: Tx, companyId: string, q: ReportQuery): Promise<ReportResult> {
    const r = await this.range(tx, q);
    const rows = await tx.$queryRaw<any[]>`
      SELECT e.id AS entry_id, e.entry_number, e.entry_date, e.narration, a.code, a.name AS account_name, l.debit, l.credit, v.number AS voucher_number, v.id AS voucher_id, v.type AS voucher_type
      FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      LEFT JOIN vouchers v ON v.journal_entry_id = e.id OR v.reversal_entry_id = e.id
      WHERE l.company_id = ${companyId}::uuid AND e.entry_date BETWEEN ${r.from} AND ${r.to}
        ${q.branchId ? Prisma.sql`AND e.branch_id = ${q.branchId}::uuid` : Prisma.empty}
        ${q.voucherType ? Prisma.sql`AND v.type = ${q.voucherType}::"VoucherType"` : Prisma.empty}
        ${q.search ? Prisma.sql`AND (e.narration ILIKE ${'%' + q.search + '%'} OR a.name ILIKE ${'%' + q.search + '%'} OR v.number ILIKE ${'%' + q.search + '%'})` : Prisma.empty}
      ORDER BY e.entry_date, e.entry_number, l.line_no`;
    let td = ZERO, tc = ZERO;
    const all: ReportRow[] = rows.map((x) => { td = td.add(x.debit); tc = tc.add(x.credit); return { date: isoDate(x.entry_date), voucher: x.voucher_number ?? x.entry_number, type: x.voucher_type ?? '', account: `${x.code}  ${x.account_name}`, narration: x.narration ?? '', debit: this.money(D(x.debit)), credit: this.money(D(x.credit)), _drill: x.voucher_id ? { type: 'voucher', id: x.voucher_id } : { type: 'entry', id: x.entry_id } }; });
    const p = this.page(all, q);
    return {
      name: 'day-book', title: 'Day Book', subtitle: r.label, rows: p.rows, paging: p.paging,
      columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'voucher', label: 'Voucher' }, { key: 'type', label: 'Type' }, { key: 'account', label: 'Account' }, { key: 'narration', label: 'Narration' },
        { key: 'debit', label: 'Debit', align: 'right', type: 'money' }, { key: 'credit', label: 'Credit', align: 'right', type: 'money' }],
      summary: [{ label: 'Total debit', value: this.money(td) }, { label: 'Total credit', value: this.money(tc) }],
    };
  }

  // ------------------------------------------------------------------ outstanding / ageing
  private async outstanding(tx: Tx, companyId: string, q: ReportQuery, type: 'CUSTOMER' | 'SUPPLIER', ageing: boolean): Promise<ReportResult> {
    const asOf = q.asOf ? parseDate(q.asOf, 'asOf') : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const accs = await tx.account.findMany({ where: { companyId, type, ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}) }, orderBy: { code: 'asc' } });
    const lines = await tx.$queryRaw<any[]>`
      SELECT l.account_id, e.entry_date, l.debit, l.credit FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.company_id = ${companyId}::uuid AND l.account_id IN (SELECT id FROM accounts WHERE company_id = ${companyId}::uuid AND type = ${type}::"AccountType")
        AND e.entry_date <= ${asOf} ORDER BY e.entry_date, e.entry_number, l.line_no`;
    const byAcc = new Map<string, any[]>();
    for (const l of lines) byAcc.set(l.account_id, [...(byAcc.get(l.account_id) ?? []), l]);
    const sign = type === 'CUSTOMER' ? 1 : -1; // customers owe us (debit); we owe suppliers (credit)
    const rows: ReportRow[] = []; const T = { total: ZERO, b0: ZERO, b1: ZERO, b2: ZERO, b3: ZERO, un: ZERO };
    for (const a of accs) {
      const ls = byAcc.get(a.id) ?? [];
      const open: { date: Date; amt: Decimal }[] = []; let unapplied = ZERO;
      for (const l of ls) {
        let amt = D(l.debit).sub(D(l.credit)).mul(sign);
        if (amt.gt(0)) open.push({ date: l.entry_date, amt });
        else { let settle = amt.neg(); while (settle.gt(0) && open.length) { const o = open[0]; const use = Decimal.min(o.amt, settle); o.amt = o.amt.sub(use); settle = settle.sub(use); if (o.amt.isZero()) open.shift(); } unapplied = unapplied.add(settle); }
      }
      const b = [ZERO, ZERO, ZERO, ZERO];
      for (const o of open) { const days = Math.floor((asOf.getTime() - o.date.getTime()) / 86_400_000); b[days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3] = b[days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3].add(o.amt); }
      const total = b.reduce((s, x) => s.add(x), ZERO).sub(unapplied);
      if (total.isZero() && unapplied.isZero()) continue;
      T.total = T.total.add(total); T.b0 = T.b0.add(b[0]); T.b1 = T.b1.add(b[1]); T.b2 = T.b2.add(b[2]); T.b3 = T.b3.add(b[3]); T.un = T.un.add(unapplied);
      rows.push({ code: a.code, name: a.name, outstanding: this.money(total), current: this.money(b[0]), d31: this.money(b[1]), d61: this.money(b[2]), d90: this.money(b[3]), unapplied: this.money(unapplied), _drill: { type: 'ledger', id: a.id } });
    }
    rows.push({ name: 'TOTAL', _kind: 'total', outstanding: this.money(T.total), current: this.money(T.b0), d31: this.money(T.b1), d61: this.money(T.b2), d90: this.money(T.b3), unapplied: this.money(T.un) });
    const base = [{ key: 'code', label: 'Code' }, { key: 'name', label: type === 'CUSTOMER' ? 'Customer' : 'Supplier' }, { key: 'outstanding', label: 'Outstanding', align: 'right' as const, type: 'money' as const }];
    const ageCols = [{ key: 'current', label: '0-30' }, { key: 'd31', label: '31-60' }, { key: 'd61', label: '61-90' }, { key: 'd90', label: '90+' }, { key: 'unapplied', label: 'Unapplied' }].map((c) => ({ ...c, align: 'right' as const, type: 'money' as const }));
    const names: Record<string, string> = { 'CUSTOMER:false': 'Customer Outstanding', 'SUPPLIER:false': 'Supplier Outstanding', 'CUSTOMER:true': 'Accounts Receivable Ageing', 'SUPPLIER:true': 'Accounts Payable Ageing' };
    const slug: Record<string, string> = { 'CUSTOMER:false': 'customer-outstanding', 'SUPPLIER:false': 'supplier-outstanding', 'CUSTOMER:true': 'accounts-receivable', 'SUPPLIER:true': 'accounts-payable' };
    return { name: slug[`${type}:${ageing}`], title: names[`${type}:${ageing}`], subtitle: `As of ${isoDate(asOf)}`, columns: ageing ? [...base, ...ageCols] : base, rows, summary: [{ label: 'Total outstanding', value: this.money(T.total) }], meta: { total: this.money(T.total) } };
  }

  // ------------------------------------------------------------------ income / expense
  private async incomeExpense(tx: Tx, companyId: string, q: ReportQuery, nature: 'INCOME' | 'EXPENSE'): Promise<ReportResult> {
    const r = await this.range(tx, q);
    const metas = await this.accounts(tx, companyId);
    const act = await this.activity(tx, companyId, r.from, r.to, q.branchId);
    const items = [...metas.values()].filter((m) => m.nature === nature).map((m) => ({ m, amt: nature === 'INCOME' ? this.net(act, m.id).neg() : this.net(act, m.id) })).filter((x) => !x.amt.isZero()).sort((a, b) => b.amt.cmp(a.amt));
    const total = items.reduce((s, x) => s.add(x.amt), ZERO);
    const rows: ReportRow[] = items.map((x) => ({ code: x.m.code, name: x.m.name, group: x.m.groupName, amount: this.money(x.amt), share: total.isZero() ? '0.0%' : `${x.amt.div(total).mul(100).toFixed(1)}%`, _drill: { type: 'ledger', id: x.m.id } }));
    rows.push({ name: 'TOTAL', _kind: 'total', amount: this.money(total), share: '100.0%' });
    const label = nature === 'INCOME' ? 'Income' : 'Expense';
    return { name: `${label.toLowerCase()}-report`, title: `${label} Report`, subtitle: r.label, rows, summary: [{ label: `Total ${label.toLowerCase()}`, value: this.money(total) }],
      columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'group', label: 'Group' }, { key: 'amount', label: 'Amount', align: 'right', type: 'money' }, { key: 'share', label: 'Share', align: 'right' }] };
  }

  // ------------------------------------------------------------------ VAT
  private async vatReport(tx: Tx, companyId: string, q: ReportQuery): Promise<ReportResult> {
    const r = await this.range(tx, q);
    const rows = await tx.taxTransaction.findMany({ where: { companyId, txnDate: { gte: r.from, lte: r.to } }, orderBy: { txnDate: 'asc' } });
    const rates = new Map((await tx.taxRate.findMany({ where: { companyId } })).map((x) => [x.id, x.code]));
    let out = ZERO, inn = ZERO;
    const body: ReportRow[] = rows.map((x) => { if (x.direction === 'OUTPUT') out = out.add(x.taxAmount); else inn = inn.add(x.taxAmount); return { date: isoDate(x.txnDate), source: x.sourceType, direction: x.direction, code: rates.get(x.taxRateId) ?? '', treatment: x.treatment, taxable: this.money(x.taxableAmount), vat: this.money(x.taxAmount), flag: x.isReversal ? 'Reversal' : x.isAdjustment ? 'Adjustment' : '', _drill: x.sourceId ? { type: 'voucher' as const, id: x.sourceId } : undefined }; });
    return { name: 'vat', title: 'VAT Transaction Report', subtitle: r.label, rows: body, summary: [{ label: 'Output VAT', value: this.money(out) }, { label: 'Input VAT', value: this.money(inn) }, { label: 'Net VAT payable', value: this.money(out.sub(inn)) }],
      columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'source', label: 'Source' }, { key: 'direction', label: 'Direction' }, { key: 'code', label: 'Tax code' }, { key: 'treatment', label: 'Treatment' }, { key: 'taxable', label: 'Taxable amount', align: 'right', type: 'money' }, { key: 'vat', label: 'VAT', align: 'right', type: 'money' }, { key: 'flag', label: 'Flag' }] };
  }
}
