'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { money, today } from '@/lib/format';
import { accountOption } from '@/components/Combobox';
import { DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/Form';
import { useSession } from '@/components/Session';
import { Alert, Badge, Button, PageHeader } from '@/components/ui';

export default function Assets() {
  const router = useRouter(); const { can } = useSession(); const { data, loading, reload } = useApi<any[]>('/assets'); const cats = useApi<any[]>('/assets/categories');
  const [modal, setModal] = useState<string | null>(null); const [msg, setMsg] = useState('');
  const d = new Date(); const cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return (
    <div>
      <PageHeader title="Fixed Assets" subtitle="Register, depreciate, transfer, maintain and dispose" actions={<>{can('asset', 'post') && <Button variant="secondary" onClick={() => setModal('dep')}>Run depreciation</Button>}{can('asset', 'create') && <><Button variant="secondary" onClick={() => setModal('cat')}>+ Category</Button><Button onClick={() => setModal('asset')}>+ Register asset</Button></>}<a className="text-sm text-brand-700 hover:underline" href="/reports/asset-register">Asset register</a></>} />
      {msg && <Alert kind="success">{msg}</Alert>}
      <DataTable rows={data} loading={loading} onRowClick={(a: any) => router.push(`/assets/${a.id}`)} columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Asset' }, { key: 'purchaseDate', label: 'Purchased' }, { key: 'cost', label: 'Cost', align: 'right', render: (a: any) => money(a.cost) }, { key: 'accumulatedDepreciation', label: 'Accum. depr.', align: 'right', render: (a: any) => money(a.accumulatedDepreciation) }, { key: 'netBookValue', label: 'Net book value', align: 'right', render: (a: any) => <b>{money(a.netBookValue)}</b> }, { key: 'status', label: 'Status', render: (a: any) => <Badge>{a.status}</Badge> }]} />
      <FormModal open={modal === 'cat'} onClose={() => setModal(null)} title="Asset category" fields={[{ name: 'name', label: 'Name', required: true }, { name: 'usefulLifeMonths', label: 'Useful life (months)', type: 'int', required: true, defaultValue: '60' }, { name: 'method', label: 'Depreciation method', type: 'select', options: [{ value: 'SL', label: 'Straight line' }, { value: 'DB', label: 'Double declining balance' }], defaultValue: 'SL' }]} onSubmit={async (v) => { await api.post('/assets/categories', v); cats.reload(); }} />
      <FormModal open={modal === 'asset'} onClose={() => setModal(null)} title="Register fixed asset" fields={[{ name: 'name', label: 'Asset name', required: true, span: 2 }, { name: 'categoryId', label: 'Category', type: 'select', required: true, options: cats.data?.map((c) => ({ value: c.id, label: `${c.name} (${c.usefulLifeMonths} mo)` })) }, { name: 'purchaseDate', label: 'Purchase date', type: 'date', required: true, defaultValue: today() }, { name: 'cost', label: 'Cost', type: 'money', required: true }, { name: 'salvageValue', label: 'Salvage value', type: 'money' }, { name: 'location', label: 'Location' }, { name: 'fundingAccountId', label: 'Credit ledger (bank / supplier / capital)', type: 'combo', endpoint: '/chart-of-accounts/accounts?active=true', map: accountOption, span: 2, hint: 'Posts Dr asset / Cr this ledger. Leave empty if already booked via a purchase invoice.' }]} onSubmit={async (v) => { await api.post('/assets', v); reload(); }} />
      <FormModal open={modal === 'dep'} onClose={() => setModal(null)} title="Run depreciation" fields={[{ name: 'period', label: 'Period (YYYY-MM)', required: true, defaultValue: cur, span: 2, hint: 'Posts one journal for all active assets; already-depreciated months are skipped.' }]} submitLabel="Post depreciation" onSubmit={async (v) => { const r = await api.post('/assets/depreciation/run', v); setMsg(`Depreciation ${v.period}: ${r.data.assets} asset(s), total ${money(r.data.total)}`); reload(); }} />
    </div>
  );
}
