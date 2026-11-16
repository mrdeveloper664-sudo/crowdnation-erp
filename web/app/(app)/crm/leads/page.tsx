'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/Form';
import { useSession } from '@/components/Session';
import { Badge, Button, Card, PageHeader, Select, Tabs } from '@/components/ui';

const STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];

export default function Leads() {
  const { can } = useSession(); const [tab, setTab] = useState('pipeline'); const [open, setOpen] = useState(false); const [lost, setLost] = useState<any>(null);
  const leads = useApi<any[]>('/crm/leads?pageSize=200'); const pipe = useApi<any[]>('/crm/pipeline'); const sources = useApi<any[]>('/crm/sources'); const users = useApi<any[]>('/users');
  const reload = () => { leads.reload(); pipe.reload(); };
  const move = async (l: any, stage: string) => { if (stage === 'LOST') { setLost(l); return; } await api.post(`/crm/leads/${l.id}/stage`, { stage }); reload(); };
  return (
    <div>
      <PageHeader title="Leads & Pipeline" actions={can('crm', 'create') && <Button onClick={() => setOpen(true)}>+ New lead</Button>} />
      <Tabs tabs={[{ id: 'pipeline', label: 'Pipeline' }, { id: 'list', label: 'List' }, { id: 'report', label: 'Lead report' }]} value={tab} onChange={setTab} />
      {tab === 'pipeline' && (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {STAGES.map((s) => { const p = pipe.data?.find((x) => x.stage === s); const items = leads.data?.filter((l) => l.stage === s) ?? [];
            return <div key={s} className="w-64 shrink-0 rounded-lg bg-slate-100 p-2"><div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase text-slate-600"><span>{s}</span><span>{p?.count ?? 0} · {money(p?.value ?? '0', 0)}</span></div>
              <div className="space-y-2">{items.map((l) => <Card key={l.id} className="!shadow-none"><Link href={`/crm/leads/${l.id}`} className="block text-sm font-medium text-brand-700 hover:underline">{l.name}</Link><div className="text-xs text-slate-500">{l.companyName}</div><div className="num mt-1 text-xs">{money(l.value)}</div>
                {can('crm', 'edit') && !l.convertedPartyId && <Select className="mt-2 !py-1 text-xs" value={l.stage} onChange={(e) => move(l, e.target.value)} aria-label={`Stage of ${l.name}`}>{STAGES.map((x) => <option key={x}>{x}</option>)}</Select>}</Card>)}</div></div>; })}
        </div>)}
      {tab === 'list' && <DataTable rows={leads.data} loading={leads.loading} columns={[{ key: 'name', label: 'Lead', render: (l: any) => <Link className="text-brand-700 hover:underline" href={`/crm/leads/${l.id}`}>{l.name}</Link> }, { key: 'companyName', label: 'Company' }, { key: 'email', label: 'Email' }, { key: 'stage', label: 'Stage', render: (l: any) => <Badge>{l.stage}</Badge> }, { key: 'value', label: 'Value', align: 'right', render: (l: any) => money(l.value) }, { key: 'expectedClose', label: 'Expected close' }]} />}
      {tab === 'report' && <p className="text-sm"><a className="text-brand-700 hover:underline" href="/reports/lead-report">Open the lead report (by source, conversion rate) →</a></p>}
      <FormModal open={open} onClose={() => setOpen(false)} title="New lead" fields={[{ name: 'name', label: 'Contact name', required: true }, { name: 'companyName', label: 'Company' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone' }, { name: 'sourceId', label: 'Source', type: 'select', options: sources.data?.map((s) => ({ value: s.id, label: s.name })) }, { name: 'value', label: 'Estimated value', type: 'money' }, { name: 'assignedTo', label: 'Assign to', type: 'select', options: users.data?.map((u) => ({ value: u.id, label: u.name })) }, { name: 'expectedClose', label: 'Expected close', type: 'date' }, { name: 'notes', label: 'Notes', type: 'textarea' }]} onSubmit={async (v) => { await api.post('/crm/leads', v); reload(); }} />
      <FormModal open={!!lost} onClose={() => setLost(null)} title={`Mark ${lost?.name} as lost`} fields={[{ name: 'lostReason', label: 'Reason', required: true, type: 'textarea', span: 2 }]} onSubmit={async (v) => { await api.post(`/crm/leads/${lost.id}/stage`, { stage: 'LOST', ...v }); reload(); }} />
    </div>
  );
}
