'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { money, today } from '@/lib/format';
import { accountOption } from '@/components/Combobox';
import { DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/Form';
import { useSession } from '@/components/Session';
import { Attachments } from '@/modules/Attachments';
import { Alert, Badge, Button, Card, PageHeader, Spinner, Stat } from '@/components/ui';

export default function AssetDetail() {
  const { id } = useParams<{ id: string }>(); const { can } = useSession(); const { data: a, reload } = useApi<any>(`/assets/${id}`); const [modal, setModal] = useState<string | null>(null); const [msg, setMsg] = useState('');
  if (!a) return <Spinner />;
  const active = a.status === 'ACTIVE';
  return (
    <div className="space-y-4">
      <PageHeader title={`${a.code} · ${a.name}`} subtitle={<span><Badge>{a.status}</Badge> {a.location && `· ${a.location}`}</span>} actions={active && <>{can('asset', 'edit') && <Button variant="secondary" onClick={() => setModal('transfer')}>Transfer</Button>}{can('asset', 'create') && <Button variant="secondary" onClick={() => setModal('maint')}>Log maintenance</Button>}{can('asset', 'post') && <Button variant="danger" onClick={() => setModal('dispose')}>Dispose</Button>}</>} />
      {msg && <Alert kind="success">{msg}</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Cost" value={money(a.cost)} /><Stat label="Accumulated depreciation" value={money(a.accumulatedDepreciation)} /><Stat label="Net book value" value={money(a.netBookValue)} /><Stat label="Method" value={a.method === 'SL' ? 'Straight line' : 'Double declining'} sub={`${a.usefulLifeMonths} months · salvage ${money(a.salvageValue)}`} /></div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Depreciation history" pad={false}><DataTable rows={a.depreciations} rowKey={(r: any) => r.period} columns={[{ key: 'period', label: 'Period' }, { key: 'amount', label: 'Amount', align: 'right', render: (r: any) => money(r.amount) }]} empty="No depreciation posted yet" /></Card>
        <Card title="Transfers" pad={false}><DataTable rows={a.transfers} columns={[{ key: 'transferDate', label: 'Date', render: (t: any) => t.transferDate.slice(0, 10) }, { key: 'fromLocation', label: 'From' }, { key: 'toLocation', label: 'To' }]} empty="No transfers" /></Card>
        <Card title="Maintenance" pad={false}><DataTable rows={a.maintenance} columns={[{ key: 'serviceDate', label: 'Date', render: (t: any) => t.serviceDate.slice(0, 10) }, { key: 'description', label: 'Work' }, { key: 'cost', label: 'Cost', align: 'right', render: (t: any) => money(t.cost) }]} empty="No maintenance logged" /></Card>
      </div>
      <Attachments entityType="asset" entityId={id} canEdit={can('asset', 'edit')} />
      <FormModal open={modal === 'transfer'} onClose={() => setModal(null)} title="Transfer asset" fields={[{ name: 'date', label: 'Date', type: 'date', required: true, defaultValue: today() }, { name: 'toLocation', label: 'New location' }, { name: 'note', label: 'Note', type: 'textarea', span: 2 }]} onSubmit={async (v) => { await api.post(`/assets/${id}/transfer`, v); reload(); }} />
      <FormModal open={modal === 'maint'} onClose={() => setModal(null)} title="Log maintenance" fields={[{ name: 'date', label: 'Date', type: 'date', required: true, defaultValue: today() }, { name: 'description', label: 'Work done', required: true }, { name: 'cost', label: 'Cost', type: 'money' }, { name: 'paidFromId', label: 'Paid from', type: 'combo', endpoint: '/chart-of-accounts/accounts?active=true', map: accountOption, hint: 'Required when a cost is entered' }, { name: 'nextDueDate', label: 'Next service due', type: 'date' }]} onSubmit={async (v) => { await api.post(`/assets/${id}/maintenance`, v); reload(); }} />
      <FormModal open={modal === 'dispose'} onClose={() => setModal(null)} title="Dispose asset" fields={[{ name: 'date', label: 'Disposal date', type: 'date', required: true, defaultValue: today() }, { name: 'proceeds', label: 'Sale proceeds', type: 'money', required: true, defaultValue: '0' }, { name: 'proceedsAccountId', label: 'Proceeds received in', type: 'combo', endpoint: '/chart-of-accounts/accounts?active=true', map: accountOption, span: 2, hint: 'Required when proceeds > 0. Depreciation must be up to date.' }]} submitLabel="Dispose" onSubmit={async (v) => { const r = await api.post(`/assets/${id}/dispose`, v); setMsg(`Disposed. NBV ${money(r.data.netBookValue)}, gain/(loss) ${money(r.data.gainLoss)}`); reload(); }} />
    </div>
  );
}
