'use client';
import Link from 'next/link';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { DataTable } from '@/components/DataTable';
import { Badge, Button, PageHeader } from '@/components/ui';

export default function Activities() {
  const { data, loading, reload } = useApi<any[]>('/crm/activities?open=true');
  return (
    <div>
      <PageHeader title="Follow-ups" subtitle="Open tasks and reminders" actions={<Button variant="secondary" onClick={async () => { await api.post('/crm/reminders/run'); reload(); }}>Send due reminders</Button>} />
      <DataTable rows={data} loading={loading} empty="No open follow-ups" rowClass={(a: any) => (a.dueAt && new Date(a.dueAt) < new Date() ? 'bg-red-50' : undefined)}
        columns={[{ key: 'subject', label: 'Task', render: (a: any) => (a.leadId ? <Link className="text-brand-700 hover:underline" href={`/crm/leads/${a.leadId}`}>{a.subject}</Link> : a.subject) }, { key: 'dueAt', label: 'Due', render: (a: any) => (a.dueAt ? new Date(a.dueAt).toLocaleString() : '—') }, { key: 'status', label: '', render: (a: any) => (a.dueAt && new Date(a.dueAt) < new Date() ? <Badge tone="red">Overdue</Badge> : null) }, { key: 'act', label: '', render: (a: any) => <Button size="sm" variant="secondary" onClick={async () => { await api.post(`/crm/activities/${a.id}/done`); reload(); }}>Done</Button> }]} />
    </div>
  );
}
