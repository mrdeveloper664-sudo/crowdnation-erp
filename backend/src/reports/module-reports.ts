import { Injectable } from '@nestjs/common';
import { isoDate, parseDate } from '../common/dates';
import { D, ZERO, fmt } from '../common/money';
import { Tx } from '../common/prisma.service';
import { projectFinancials } from '../projects/projects.controller';
import { monthlyDepreciation } from '../assets/depreciation';
import { ReportQuery, ReportResult } from './report.types';

export const MODULE_REPORTS = ['lead-report', 'employee-report', 'payroll-report', 'expense-budget', 'project-profitability', 'asset-register', 'depreciation-schedule'];

@Injectable()
export class ModuleReports {
  async run(tx: Tx, companyId: string, name: string, q: ReportQuery & { period?: string; year?: string; month?: string }): Promise<ReportResult> {
    switch (name) {
      case 'lead-report': {
        const leads = await tx.lead.findMany({ where: { companyId, ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: parseDate(q.from) } : {}), ...(q.to ? { lte: new Date(parseDate(q.to).getTime() + 86_399_999) } : {}) } } : {}) } });
        const sources = new Map((await tx.leadSource.findMany({ where: { companyId } })).map((s) => [s.id, s.name]));
        const g = new Map<string, { total: number; won: number; lost: number; open: number; value: any; wonValue: any }>();
        for (const l of leads) { const k = l.sourceId ? sources.get(l.sourceId) ?? 'Unknown' : 'Unspecified'; const x = g.get(k) ?? { total: 0, won: 0, lost: 0, open: 0, value: ZERO, wonValue: ZERO }; x.total++; if (l.stage === 'WON') { x.won++; x.wonValue = x.wonValue.add(l.value); } else if (l.stage === 'LOST') x.lost++; else x.open++; x.value = x.value.add(l.value); g.set(k, x); }
        const rows = [...g].map(([source, x]) => ({ source, total: String(x.total), open: String(x.open), won: String(x.won), lost: String(x.lost), conversion: x.total ? `${((x.won / x.total) * 100).toFixed(1)}%` : '0%', pipelineValue: fmt(x.value), wonValue: fmt(x.wonValue) }));
        return { name, title: 'Lead Report', subtitle: 'By lead source', rows, columns: [{ key: 'source', label: 'Source' }, { key: 'total', label: 'Leads', align: 'right' }, { key: 'open', label: 'Open', align: 'right' }, { key: 'won', label: 'Won', align: 'right' }, { key: 'lost', label: 'Lost', align: 'right' }, { key: 'conversion', label: 'Conversion', align: 'right' }, { key: 'pipelineValue', label: 'Total value', align: 'right', type: 'money' }, { key: 'wonValue', label: 'Won value', align: 'right', type: 'money' }], summary: [{ label: 'Leads', value: String(leads.length) }] };
      }
      case 'employee-report': {
        const [emps, depts, desigs] = await Promise.all([tx.employee.findMany({ where: { companyId }, orderBy: { code: 'asc' } }), tx.department.findMany({ where: { companyId } }), tx.designation.findMany({ where: { companyId } })]);
        const dn = new Map(depts.map((d) => [d.id, d.name])), gn = new Map(desigs.map((d) => [d.id, d.name]));
        let total = ZERO;
        const rows = emps.map((e) => { if (e.isActive) total = total.add(e.basicSalary); return { code: e.code, name: e.name, department: e.departmentId ? dn.get(e.departmentId) ?? '' : '', designation: e.designationId ? gn.get(e.designationId) ?? '' : '', joined: isoDate(e.joinDate), status: e.isActive ? 'Active' : 'Inactive', basic: fmt(e.basicSalary) }; });
        return { name, title: 'Employee Report', rows, columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' }, { key: 'joined', label: 'Joined', type: 'date' }, { key: 'status', label: 'Status' }, { key: 'basic', label: 'Basic salary', align: 'right', type: 'money' }], summary: [{ label: 'Active payroll (basic)', value: fmt(total) }, { label: 'Employees', value: String(emps.length) }] };
      }
      case 'payroll-report': {
        const run = await tx.payrollRun.findFirst({ where: { companyId, period: q.period ?? '' }, include: { payslips: true } });
        const emps = new Map((await tx.employee.findMany({ where: { companyId } })).map((e) => [e.id, e]));
        return { name, title: 'Payroll Report', subtitle: q.period ? `Period ${q.period} (${run?.status ?? 'no run'})` : 'Pass period=YYYY-MM', rows: (run?.payslips ?? []).map((p) => ({ code: emps.get(p.employeeId)?.code, name: emps.get(p.employeeId)?.name, basic: fmt(p.basic), allowances: fmt(p.allowances), deductions: fmt(p.deductions), net: fmt(p.net) })),
          columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Employee' }, { key: 'basic', label: 'Basic', align: 'right', type: 'money' }, { key: 'allowances', label: 'Allowances', align: 'right', type: 'money' }, { key: 'deductions', label: 'Deductions', align: 'right', type: 'money' }, { key: 'net', label: 'Net pay', align: 'right', type: 'money' }], summary: run ? [{ label: 'Gross', value: fmt(run.totalGross) }, { label: 'Deductions', value: fmt(run.totalDeduction) }, { label: 'Net', value: fmt(run.totalNet) }] : [] };
      }
      case 'expense-budget': {
        const year = Number(q.year) || new Date().getUTCFullYear(), month = Number(q.month) || 0;
        const from = new Date(Date.UTC(year, month ? month - 1 : 0, 1)), to = new Date(Date.UTC(year, month ? month : 12, 0));
        const [cats, budgets, exps] = await Promise.all([tx.expenseCategory.findMany({ where: { companyId } }), tx.expenseBudget.findMany({ where: { companyId, year, month } }), tx.expense.findMany({ where: { companyId, status: { in: ['POSTED', 'REIMBURSED'] }, expenseDate: { gte: from, lte: to } } })]);
        let tb = ZERO, ta = ZERO;
        const rows = cats.map((c) => { const b = budgets.find((x) => x.categoryId === c.id)?.amount ?? ZERO; const a = exps.filter((e) => e.categoryId === c.id).reduce((s, e) => s.add(e.net), ZERO); tb = tb.add(b); ta = ta.add(a); return { category: c.name, budget: fmt(b), actual: fmt(a), variance: fmt(b.sub(a)), used: b.isZero() ? '-' : `${a.div(b).mul(100).toFixed(1)}%` }; });
        return { name, title: 'Expense Budget vs Actual', subtitle: month ? `${year}-${String(month).padStart(2, '0')}` : String(year), rows, columns: [{ key: 'category', label: 'Category' }, { key: 'budget', label: 'Budget', align: 'right', type: 'money' }, { key: 'actual', label: 'Actual', align: 'right', type: 'money' }, { key: 'variance', label: 'Remaining', align: 'right', type: 'money' }, { key: 'used', label: 'Used', align: 'right' }], summary: [{ label: 'Total budget', value: fmt(tb) }, { label: 'Total actual', value: fmt(ta) }] };
      }
      case 'project-profitability': {
        const ps = await tx.project.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
        const rows = [];
        for (const p of ps) { const f = await projectFinancials(tx, companyId, p.id); rows.push({ code: p.code, name: p.name, status: p.status, income: fmt(f.income), cost: fmt(f.cost), profit: fmt(f.profit), margin: f.income.isZero() ? '-' : `${f.profit.div(f.income).mul(100).toFixed(1)}%`, budgetCost: fmt(p.budgetCost) }); }
        return { name, title: 'Project Profitability', rows, columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Project' }, { key: 'status', label: 'Status' }, { key: 'income', label: 'Income', align: 'right', type: 'money' }, { key: 'cost', label: 'Cost', align: 'right', type: 'money' }, { key: 'profit', label: 'Profit', align: 'right', type: 'money' }, { key: 'margin', label: 'Margin', align: 'right' }, { key: 'budgetCost', label: 'Budget cost', align: 'right', type: 'money' }] };
      }
      case 'asset-register': {
        const as = await tx.fixedAsset.findMany({ where: { companyId }, orderBy: { code: 'asc' } });
        const dep = await tx.assetDepreciation.groupBy({ by: ['assetId'], where: { companyId }, _sum: { amount: true } });
        const dm = new Map(dep.map((d) => [d.assetId, D(d._sum.amount)]));
        let c = ZERO, ac = ZERO;
        const rows = as.map((a) => { const acc = dm.get(a.id) ?? ZERO; c = c.add(a.cost); ac = ac.add(acc); return { code: a.code, name: a.name, purchased: isoDate(a.purchaseDate), status: a.status, cost: fmt(a.cost), accumulated: fmt(acc), nbv: fmt(a.cost.sub(acc)) }; });
        return { name, title: 'Fixed Asset Register', rows, columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Asset' }, { key: 'purchased', label: 'Purchased', type: 'date' }, { key: 'status', label: 'Status' }, { key: 'cost', label: 'Cost', align: 'right', type: 'money' }, { key: 'accumulated', label: 'Accum. depr.', align: 'right', type: 'money' }, { key: 'nbv', label: 'Net book value', align: 'right', type: 'money' }], summary: [{ label: 'Total cost', value: fmt(c) }, { label: 'Net book value', value: fmt(c.sub(ac)) }] };
      }
      default: { // depreciation-schedule: projected monthly depreciation for the next N months
        const as = await tx.fixedAsset.findMany({ where: { companyId, status: 'ACTIVE' }, orderBy: { code: 'asc' } });
        const dep = await tx.assetDepreciation.groupBy({ by: ['assetId'], where: { companyId }, _sum: { amount: true } });
        const dm = new Map(dep.map((d) => [d.assetId, D(d._sum.amount)]));
        const rows: any[] = [];
        for (const a of as) { let acc = dm.get(a.id) ?? ZERO; const now = new Date(); let y = now.getUTCFullYear(), m = now.getUTCMonth(); for (let i = 0; i < 12; i++) { const amt = monthlyDepreciation({ cost: a.cost, salvage: a.salvageValue, lifeMonths: a.usefulLifeMonths, method: a.method }, acc); acc = acc.add(amt); rows.push({ code: a.code, name: a.name, period: `${y}-${String(m + 1).padStart(2, '0')}`, depreciation: fmt(amt), accumulated: fmt(acc), nbv: fmt(a.cost.sub(acc)) }); m++; if (m > 11) { m = 0; y++; } } }
        return { name: 'depreciation-schedule', title: 'Depreciation Schedule (next 12 months)', rows, columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Asset' }, { key: 'period', label: 'Period' }, { key: 'depreciation', label: 'Depreciation', align: 'right', type: 'money' }, { key: 'accumulated', label: 'Accumulated', align: 'right', type: 'money' }, { key: 'nbv', label: 'Net book value', align: 'right', type: 'money' }] };
      }
    }
  }
}
