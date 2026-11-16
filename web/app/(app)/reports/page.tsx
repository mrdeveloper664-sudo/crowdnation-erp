'use client';
import Link from 'next/link';
import { useApi } from '@/hooks/useApi';
import { Card, PageHeader, Spinner } from '@/components/ui';

const GROUPS: Array<[string, string[]]> = [
  ['Financial statements', ['trial-balance', 'profit-and-loss', 'balance-sheet', 'cash-flow']], ['Books & ledgers', ['general-ledger', 'day-book', 'cash-book', 'bank-book', 'ledger-statement']],
  ['Receivables & payables', ['customer-outstanding', 'supplier-outstanding', 'accounts-receivable', 'accounts-payable']], ['Tax, income & expense', ['vat', 'income-report', 'expense-report', 'expense-budget']],
  ['Inventory', ['stock-summary', 'stock-valuation', 'low-stock', 'batch-summary', 'stock-movements']], ['People, CRM & projects', ['employee-report', 'payroll-report', 'lead-report', 'project-profitability']], ['Assets', ['asset-register', 'depreciation-schedule']],
];

export default function Reports() {
  const { data } = useApi<Array<{ name: string; title: string }>>('/reports/catalog');
  if (!data) return <Spinner />;
  const by = new Map(data.map((r) => [r.name, r.title]));
  return (
    <div><PageHeader title="Reports" subtitle="Generated live from posted journal entries and documents — export to Excel, PDF or print" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{GROUPS.map(([g, names]) => <Card key={g} title={g}><ul className="space-y-1.5 text-sm">{names.filter((n) => by.has(n)).map((n) => <li key={n}><Link className="text-brand-700 hover:underline" href={`/reports/${n}`}>{by.get(n)}</Link></li>)}</ul></Card>)}</div></div>
  );
}
