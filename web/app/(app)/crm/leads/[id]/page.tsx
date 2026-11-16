'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { ApiError, api } from '@/lib/api';
import { money } from '@/lib/format';
import { FormModal } from '@/components/Form';
import { Alert, Badge, Button, Card, PageHeader, Spinner } from '@/components/ui';

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>(); const { data: l, reload } = useApi<any>(`/crm/leads/${id}`); const [open, setOpen] = useState(false); const [err, setErr] = useState('');
  if (!l) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHeader title={l.name} subtitle={<span>{l.companyName} {l.email && `· ${l.email}`} {l.phone && `· ${l.phone}`}</span>} actions={<>{!l.convertedPartyId ? <Button onClick={async () => { setErr(''); try { await api.post(`/crm/leads/${id}/convert`); reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } }}>Convert to customer</Button> : <Link href={`/sales/customers/${l.convertedPartyId}`}><Button variant="secondary">Open customer</Button></Link>}<Button variant="secondary" onClick={() => setOpen(true)}>+ Log activity</Button></>} />
      {err && <Alert>{err}</Alert>}
      <div className="flex items-center gap-3"><Badge>{l.stage}</Badge><span className="num text-sm">Value {money(l.value)}</span>{l.expectedClose && <span className="text-sm text-slate-500">Close by {l.expectedClose.slice(0, 10)}</span>}</div>
      <Card title="Activity history"><ol className="space-y-3">{l.activities.map((a: any) => <li key={a.id} className="border-l-2 border-brand-200 pl-3 text-sm"><div className="flex items-center gap-2"><Badge tone="slate">{a.type}</Badge><b>{a.subject}</b>{a.type === 'TASK' && !a.doneAt && <Button size="sm" variant="ghost" onClick={async () => { await api.post(`/crm/activities/${a.id}/done`); reload(); }}>Mark done</Button>}{a.doneAt && <Badge tone="green">Done</Badge>}</div>{a.notes && <p className="text-slate-600">{a.notes}</p>}<div className="text-xs text-slate-400">{new Date(a.activityDate).toLocaleString()}{a.dueAt && ` · due ${new Date(a.dueAt).toLocaleString()}`}</div></li>)}{l.activities.length === 0 && <li className="text-sm text-slate-400">No activity yet</li>}</ol></Card>
      <FormModal open={open} onClose={() => setOpen(false)} title="Log activity or follow-up" fields={[{ name: 'type', label: 'Type', type: 'select', required: true, options: ['CALL', 'EMAIL', 'MEETING', 'NOTE', 'TASK'].map((t) => ({ value: t, label: t === 'TASK' ? 'TASK (follow-up reminder)' : t })) }, { name: 'subject', label: 'Subject', required: true }, { name: 'dueAt', label: 'Due (for tasks)', type: 'datetime', showIf: (v) => v.type === 'TASK' }, { name: 'notes', label: 'Notes', type: 'textarea' }]} onSubmit={async (v) => { await api.post('/crm/activities', { ...v, leadId: id }); reload(); }} />
    </div>
  );
}
