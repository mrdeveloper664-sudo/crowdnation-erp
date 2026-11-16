'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/Form';
import { useSession } from '@/components/Session';
import { Badge, Button, PageHeader } from '@/components/ui';

export default function Payroll() {
  const router = useRouter(); const { can } = useSession(); const { data, loading, reload } = useApi<any[]>('/hr/payroll'); const [open, setOpen] = useState(false);
  const d = new Date(); const cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return (
    <div>
      <PageHeader title="Payroll" subtitle="Generate → approve → post to the ledger → pay" actions={can('hr', 'create') && <Button onClick={() => setOpen(true)}>+ Generate payroll</Button>} />
      <DataTable rows={data} loading={loading} onRowClick={(r: any) => router.push(`/hr/payroll/${r.id}`)} columns={[{ key: 'period', label: 'Period' }, { key: 'status', label: 'Status', render: (r: any) => <Badge>{r.status}</Badge> }, { key: 'totalGross', label: 'Gross', align: 'right', render: (r: any) => money(r.totalGross) }, { key: 'totalDeduction', label: 'Deductions', align: 'right', render: (r: any) => money(r.totalDeduction) }, { key: 'totalNet', label: 'Net pay', align: 'right', render: (r: any) => money(r.totalNet) }]} />
      <FormModal open={open} onClose={() => setOpen(false)} title="Generate payroll" fields={[{ name: 'period', label: 'Period (YYYY-MM)', required: true, defaultValue: cur, span: 2, hint: 'Replaces an existing draft for the same month' }]} onSubmit={async (v) => { const r = await api.post('/hr/payroll/generate', v); router.push(`/hr/payroll/${r.data.id}`); reload(); }} />
    </div>
  );
}
