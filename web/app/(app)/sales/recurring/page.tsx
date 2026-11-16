'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { today } from '@/lib/format';
import { DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/Form';
import { Alert, Badge, Button, PageHeader } from '@/components/ui';

export default function Recurring() {
  const { data, loading, reload } = useApi<any[]>('/sales/recurring'); const [open, setOpen] = useState(false); const [msg, setMsg] = useState('');
  return (
    <div>
      <PageHeader title="Recurring invoices" subtitle="Templates that generate invoices on a schedule" actions={<><Button variant="secondary" onClick={async () => { const r = await api.post('/sales/recurring/run', { asOf: today() }); setMsg(`Generated ${r.data.generated} invoice(s)`); reload(); }}>Run due now</Button><Button onClick={() => setOpen(true)}>+ New schedule</Button></>} />
      {msg && <Alert kind="success">{msg}</Alert>}
      <DataTable rows={data} loading={loading} columns={[{ key: 'frequency', label: 'Frequency' }, { key: 'nextRunDate', label: 'Next run' }, { key: 'endDate', label: 'Ends', render: (r: any) => r.endDate ?? '—' }, { key: 'autoPost', label: 'Auto-post', render: (r: any) => (r.autoPost ? 'Yes' : 'No') }, { key: 'lines', label: 'Lines', render: (r: any) => r.template.lines.length }, { key: 'isActive', label: 'Status', render: (r: any) => <Badge tone={r.isActive ? 'green' : 'slate'}>{r.isActive ? 'Active' : 'Stopped'}</Badge> },
          { key: 'a', label: '', render: (r: any) => <Button size="sm" variant="ghost" onClick={async () => { await api.patch(`/sales/recurring/${r.id}/active`, { isActive: !r.isActive }); reload(); }}>{r.isActive ? 'Stop' : 'Resume'}</Button> }]} />
      <FormModal open={open} onClose={() => setOpen(false)} title="New recurring invoice" fields={[{ name: 'partyId', label: 'Customer', type: 'combo', required: true, endpoint: '/customers', span: 2 }, { name: 'frequency', label: 'Frequency', type: 'select', required: true, options: ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'].map((x) => ({ value: x, label: x })) }, { name: 'startDate', label: 'First run', type: 'date', required: true, defaultValue: today() }, { name: 'endDate', label: 'End date', type: 'date' }, { name: 'autoPost', label: 'Post automatically', type: 'checkbox' }, { name: 'description', label: 'Line description', required: true, span: 2 }, { name: 'unitPrice', label: 'Amount (excl. VAT)', type: 'money', required: true }, { name: 'quantity', label: 'Quantity', defaultValue: '1', required: true }]}
        onSubmit={async (v) => { await api.post('/sales/recurring', { partyId: v.partyId, frequency: v.frequency, startDate: v.startDate, endDate: v.endDate, autoPost: !!v.autoPost, lines: [{ description: v.description, quantity: v.quantity, unitPrice: v.unitPrice, taxCode: 'STD' }] }); reload(); }} />
    </div>
  );
}
