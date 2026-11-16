'use client';
import { useMemo, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api, qs } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { Column, DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/Form';
import { useSession } from '@/components/Session';
import { Alert, Badge, Button, Card, ConfirmDialog, Input, PageHeader, Select } from '@/components/ui';

const TYPES = ['GENERAL', 'CASH', 'BANK', 'CUSTOMER', 'SUPPLIER', 'VAT_INPUT', 'VAT_OUTPUT', 'FIXED_ASSET', 'ACCUMULATED_DEPRECIATION', 'INVENTORY', 'CAPITAL', 'RETAINED_EARNINGS', 'INCOME', 'EXPENSE'];

export default function ChartPage() {
  const { can } = useSession(); const router = useRouter();
  const [search, setSearch] = useState(''); const [groupId, setGroupId] = useState('');
  const groups = useApi<any[]>('/chart-of-accounts/groups');
  const accounts = useApi<any[]>(`/chart-of-accounts/accounts${qs({ search, groupId })}`);
  const [modal, setModal] = useState<'group' | 'account' | null>(null); const [toggle, setToggle] = useState<any>(null); const [err, setErr] = useState('');
  const tree = useMemo(() => {
    const g = groups.data ?? []; const kids = new Map<string | null, any[]>();
    g.forEach((x) => kids.set(x.parentId, [...(kids.get(x.parentId) ?? []), x]));
    const out: Array<any & { depth: number }> = []; const walk = (p: string | null, depth: number) => (kids.get(p) ?? []).forEach((x) => { out.push({ ...x, depth }); walk(x.id, depth + 1); });
    walk(null, 0); return out;
  }, [groups.data]);
  const cols: Column[] = [
    { key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'group', label: 'Group', render: (a) => a.group?.name }, { key: 'type', label: 'Type', render: (a) => <Badge tone="slate">{a.type}</Badge> },
    { key: 'status', label: 'Status', render: (a) => <Badge tone={a.isActive ? 'green' : 'red'}>{a.isActive ? 'Active' : 'Inactive'}</Badge> },
    { key: 'act', label: '', align: 'right', render: (a) => can('account', 'edit') && !a.isSystem && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setToggle(a); }}>{a.isActive ? 'Deactivate' : 'Activate'}</Button> },
  ];
  const reload = () => { groups.reload(); accounts.reload(); };
  return (
    <div>
      <PageHeader title="Chart of Accounts" subtitle="Hierarchical groups and postable accounts (ledgers)" actions={can('account', 'create') && <><Button variant="secondary" onClick={() => setModal('group')}>+ Group</Button><Button onClick={() => setModal('account')}>+ Account</Button></>} />
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card title="Groups" pad={false}>
          <ul className="max-h-[32rem] overflow-auto py-1 text-sm">
            <li><button onClick={() => setGroupId('')} className={`w-full px-3 py-1.5 text-left hover:bg-slate-50 ${!groupId ? 'font-semibold text-brand-700' : ''}`}>All accounts</button></li>
            {tree.map((g) => <li key={g.id}><button onClick={() => setGroupId(g.id)} style={{ paddingLeft: 12 + g.depth * 14 }} className={`w-full py-1.5 pr-3 text-left hover:bg-slate-50 ${groupId === g.id ? 'font-semibold text-brand-700' : ''}`}><span className="text-slate-400">{g.code}</span> {g.name}</button></li>)}
          </ul>
        </Card>
        <div>
          <div className="mb-3 max-w-xs"><Input placeholder="Search code or name…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search accounts" /></div>
          <DataTable columns={cols} rows={accounts.data} loading={accounts.loading} onRowClick={(a) => router.push(`/accounting/ledgers/${a.id}`)} rowClass={(a) => (a.isActive ? undefined : 'opacity-60')} />
        </div>
      </div>
      <FormModal open={modal === 'group'} onClose={() => setModal(null)} title="New account group" onSubmit={async (v) => { await api.post('/chart-of-accounts/groups', v); reload(); }}
        fields={[{ name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true }, { name: 'parentId', label: 'Parent group', type: 'combo', options: tree.map((g) => ({ value: g.id, label: `${g.code} ${g.name}` })), span: 2 },
          { name: 'nature', label: 'Nature (top-level only)', type: 'select', options: ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'].map((n) => ({ value: n, label: n })), showIf: (v) => !v.parentId, span: 2 }]} />
      <FormModal open={modal === 'account'} onClose={() => setModal(null)} title="New account" onSubmit={async (v) => { await api.post('/chart-of-accounts/accounts', v); reload(); }}
        fields={[{ name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true }, { name: 'groupId', label: 'Group', type: 'combo', required: true, options: tree.map((g) => ({ value: g.id, label: `${g.code} ${g.name}` })) },
          { name: 'type', label: 'Account type', type: 'select', options: TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })), defaultValue: 'GENERAL' }, { name: 'currency', label: 'Currency (optional)', placeholder: 'AED' }, { name: 'description', label: 'Description', type: 'textarea' }]} />
      <ConfirmDialog open={!!toggle} onClose={() => setToggle(null)} title={toggle?.isActive ? 'Deactivate account?' : 'Activate account?'} message={toggle && <>{toggle.code} {toggle.name}. {toggle.isActive ? 'Inactive accounts cannot be used in new transactions; history is kept.' : ''}</>} confirmLabel={toggle?.isActive ? 'Deactivate' : 'Activate'} danger={toggle?.isActive}
        onConfirm={async () => { try { await api.post(`/chart-of-accounts/accounts/${toggle.id}/${toggle.isActive ? 'deactivate' : 'activate'}`); setToggle(null); reload(); } catch (e: any) { setErr(e.message); setToggle(null); } }} />
    </div>
  );
}
