'use client';
import { useRouter } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { ResourcePage } from '@/components/ResourcePage';
import { Badge } from '@/components/ui';
import { money } from '@/lib/format';

export default function Projects() {
  const router = useRouter(); const cust = useApi<any[]>('/customers?pageSize=200');
  return (
    <ResourcePage title="Projects" endpoint="/projects" resource="project" createLabel="New project" onRowClick={(p: any) => router.push(`/projects/${p.id}`)}
      extraActions={<a className="text-sm text-brand-700 hover:underline" href="/reports/project-profitability">Profitability report</a>}
      columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Project' }, { key: 'status', label: 'Status', render: (p: any) => <Badge>{p.status}</Badge> }, { key: 'progress', label: 'Progress', render: (p: any) => <div className="flex items-center gap-2"><div className="h-1.5 w-24 rounded bg-slate-200"><div className="h-1.5 rounded bg-brand-500" style={{ width: `${p.progress}%` }} /></div><span className="num text-xs">{p.progress}%</span></div> }, { key: 'budgetRevenue', label: 'Budget revenue', align: 'right', render: (p: any) => money(p.budgetRevenue) }, { key: 'budgetCost', label: 'Budget cost', align: 'right', render: (p: any) => money(p.budgetCost) }]}
      createFields={[{ name: 'name', label: 'Project name', required: true, span: 2 }, { name: 'customerId', label: 'Customer', type: 'select', options: cust.data?.map((c) => ({ value: c.id, label: c.name })) }, { name: 'status', label: 'Status', type: 'select', options: ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED'].map((s) => ({ value: s, label: s })), defaultValue: 'PLANNING' }, { name: 'startDate', label: 'Start', type: 'date' }, { name: 'endDate', label: 'End', type: 'date' }, { name: 'budgetRevenue', label: 'Budget revenue', type: 'money' }, { name: 'budgetCost', label: 'Budget cost', type: 'money' }, { name: 'description', label: 'Description', type: 'textarea' }]} />
  );
}
