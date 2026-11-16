'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { today } from '@/lib/format';
import { Column, DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/Form';
import { useSession } from '@/components/Session';
import { Alert, Badge, Button, Card, ConfirmDialog, PageHeader, Tabs } from '@/components/ui';

export default function Periods() {
  const { can } = useSession(); const [tab, setTab] = useState('years');
  const fys = useApi<any[]>('/accounting/financial-years'); const rates = useApi<any[]>('/accounting/exchange-rates');
  const [modal, setModal] = useState<'fy' | 'rate' | null>(null); const [lock, setLock] = useState<any>(null); const [err, setErr] = useState('');
  const rateCols: Column[] = [{ key: 'rateDate', label: 'Date', render: (r) => r.rateDate.slice(0, 10) }, { key: 'currency', label: 'Currency' }, { key: 'rate', label: 'Rate (base per 1 unit)', align: 'right' }];
  return (
    <div>
      <PageHeader title="Periods & Currency" subtitle="Financial years, accounting periods and exchange rates" />
      <Tabs tabs={[{ id: 'years', label: 'Financial years & periods' }, { id: 'fx', label: 'Exchange rates' }]} value={tab} onChange={setTab} />
      {err && <Alert>{err}</Alert>}
      {tab === 'years' ? (
        <div className="space-y-4">
          {can('period', 'create') && <Button onClick={() => setModal('fy')}>+ New financial year</Button>}
          {fys.data?.map((y) => (
            <Card key={y.id} title={<>{y.name} <span className="ml-2 text-xs font-normal text-slate-500">{y.startDate.slice(0, 10)} → {y.endDate.slice(0, 10)}</span></>}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {y.periods.map((p: any) => <div key={p.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm"><div><div className="font-medium">{p.name}</div><Badge tone={p.status === 'OPEN' ? 'green' : 'red'}>{p.status}</Badge></div>{can('period', 'approve') && <Button size="sm" variant="ghost" onClick={() => setLock(p)}>{p.status === 'OPEN' ? 'Lock' : 'Unlock'}</Button>}</div>)}
              </div>
            </Card>))}
        </div>
      ) : (
        <div className="space-y-3">{can('period', 'edit') && <Button onClick={() => setModal('rate')}>+ Set exchange rate</Button>}<DataTable columns={rateCols} rows={rates.data} loading={rates.loading} empty="No exchange rates yet" /></div>
      )}
      <FormModal open={modal === 'fy'} onClose={() => setModal(null)} title="New financial year" fields={[{ name: 'startDate', label: 'Start date', type: 'date', required: true, hint: 'The year runs 12 months from this date' }, { name: 'name', label: 'Name (optional)' }]} onSubmit={async (v) => { await api.post('/accounting/financial-years', v); fys.reload(); }} />
      <FormModal open={modal === 'rate'} onClose={() => setModal(null)} title="Exchange rate" fields={[{ name: 'currency', label: 'Currency', required: true, placeholder: 'USD' }, { name: 'rateDate', label: 'Effective date', type: 'date', required: true, defaultValue: today() }, { name: 'rate', label: 'Rate (base currency per 1 unit)', required: true, hint: 'e.g. 3.6725' }]} onSubmit={async (v) => { await api.put('/accounting/exchange-rates', { ...v, currency: String(v.currency).toUpperCase() }); rates.reload(); }} />
      <ConfirmDialog open={!!lock} onClose={() => setLock(null)} title={lock?.status === 'OPEN' ? `Lock ${lock?.name}?` : `Unlock ${lock?.name}?`} message={lock?.status === 'OPEN' ? 'No entries can be posted or reversed in a locked period.' : 'Entries can be posted in this period again.'} confirmLabel={lock?.status === 'OPEN' ? 'Lock period' : 'Unlock'} danger={lock?.status === 'OPEN'}
        onConfirm={async () => { try { await api.post(`/accounting/periods/${lock.id}/${lock.status === 'OPEN' ? 'lock' : 'unlock'}`); setLock(null); fys.reload(); } catch (e: any) { setErr(e.message); setLock(null); } }} />
    </div>
  );
}
