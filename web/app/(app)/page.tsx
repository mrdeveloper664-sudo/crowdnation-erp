'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';
import { money } from '@/lib/format';
import { Alert, Card, PageHeader, Select, Spinner, Stat } from '@/components/ui';
import { DataTable } from '@/components/DataTable';

function Bars({ data, color }: { data: Array<{ month: string; amount: string }>; color: string }) {
  if (!data.length) return <div className="py-8 text-center text-sm text-slate-400">No posted documents in this period</div>;
  const max = Math.max(...data.map((d) => Math.abs(Number(d.amount))), 1);
  return (
    <div className="flex h-40 items-end gap-2" role="img" aria-label="Monthly bar chart">
      {data.map((d) => <div key={d.month} className="flex flex-1 flex-col items-center gap-1"><div className="num text-[10px] text-slate-500">{money(d.amount, 0)}</div><div className="w-full rounded-t" style={{ height: `${Math.max(2, (Math.abs(Number(d.amount)) / max) * 100)}%`, background: color }} title={`${d.month}: ${money(d.amount)}`} /><div className="text-[10px] text-slate-500">{d.month.slice(2)}</div></div>)}
    </div>
  );
}

export default function Dashboard() {
  const [fy, setFy] = useState('');
  const fys = useApi<any[]>('/accounting/financial-years');
  const { data: d, loading, error } = useApi<any>(`/dashboard${qs({ financialYearId: fy })}`);
  const neg = (v?: string) => (v && v.startsWith('-') ? 'bad' : undefined) as 'bad' | undefined;
  return (
    <div>
      <PageHeader title="Dashboard" subtitle={d ? `${d.period.label}: ${d.period.from} to ${d.period.to}` : undefined}
        actions={<Select value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year"><option value="">Current financial year</option>{fys.data?.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</Select>} />
      {error && <Alert>{error}</Alert>}
      {loading && !d && <Spinner />}
      {d && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total revenue" value={money(d.revenue)} /><Stat label="Total expenses" value={money(d.expenses)} />
            <Stat label="Net profit" value={money(d.netProfit)} tone={neg(d.netProfit) ?? 'good'} /><Stat label="VAT position" value={money(d.vat.net)} sub={`Output ${money(d.vat.output)} · Input ${money(d.vat.input)}`} />
            <Stat label="Cash balance" value={money(d.cashBalance)} /><Stat label="Bank balance" value={money(d.bankBalance)} />
            <Stat label="Receivables" value={money(d.receivables)} /><Stat label="Payables" value={money(d.payables)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Sales performance (net, monthly)"><Bars data={d.salesPerformance} color="#2f61e0" /></Card>
            <Card title="Purchase performance (net, monthly)"><Bars data={d.purchasePerformance} color="#f59e0b" /></Card>
            <Card title="Inventory value"><div className="num text-3xl font-semibold">{money(d.inventoryValue)}</div><p className="mt-1 text-sm text-slate-500">At cost, from stock movements</p>
              <Link href="/reports/stock-valuation" className="mt-3 inline-block text-sm text-brand-700 hover:underline">Stock valuation report →</Link></Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Top customers" pad={false}><DataTable rows={d.topCustomers} columns={[{ key: 'name', label: 'Customer' }, { key: 'total', label: 'Net sales', align: 'right', render: (r: any) => money(r.total) }]} rowKey={(r: any) => r.name} /></Card>
            <Card title="Needs attention">
              <ul className="space-y-2 text-sm">
                {[['Vouchers awaiting approval', d.alerts.pendingVoucherApprovals, '/accounting/vouchers?status=PENDING_APPROVAL'], ['Draft documents', d.alerts.draftDocuments, '/sales/documents?type=INVOICE'], ['Overdue sales invoices', d.alerts.overdueInvoices, '/reports/customer-outstanding'], ['Expenses awaiting approval', d.alerts.pendingExpenseApprovals, '/expenses'], ['Leave requests pending', d.alerts.pendingLeaveRequests, '/hr/leave'], ['Low stock items', d.alerts.lowStockItems, '/reports/low-stock']].map(([l, n, href]) => (
                  <li key={l as string} className="flex items-center justify-between"><Link href={href as string} className="text-slate-700 hover:text-brand-700">{l}</Link><span className={`num rounded-full px-2 py-0.5 text-xs font-semibold ${Number(n) > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>{n}</span></li>))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
