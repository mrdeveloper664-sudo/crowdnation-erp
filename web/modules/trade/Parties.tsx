'use client';
import { useParams, useRouter } from 'next/navigation';
import { ReportViewer } from '@/components/ReportViewer';
import { ResourcePage } from '@/components/ResourcePage';
import { useApi } from '@/hooks/useApi';
import { money } from '@/lib/format';
import { Badge, Card, PageHeader, Spinner, Stat } from '@/components/ui';
import Link from 'next/link';

export function PartyList({ kind }: { kind: 'customers' | 'suppliers' }) {
  const router = useRouter(); const base = kind === 'customers' ? '/sales/customers' : '/purchases/suppliers'; const label = kind === 'customers' ? 'Customer' : 'Supplier';
  return (
    <ResourcePage title={kind === 'customers' ? 'Customers' : 'Suppliers'} subtitle={`Each ${label.toLowerCase()} gets its own ledger account automatically`} endpoint={`/${kind}`} resource={kind === 'customers' ? 'customer' : 'supplier'} createLabel={`New ${label.toLowerCase()}`}
      onRowClick={(r: any) => router.push(`${base}/${r.id}`)}
      columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'trn', label: 'TRN' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'balance', label: 'Balance', align: 'right', render: (r: any) => <b>{money(r.balance)} {r.balanceSide ?? ''}</b> }, { key: 'isActive', label: 'Status', render: (r: any) => <Badge tone={r.isActive ? 'green' : 'red'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> }]}
      createFields={[{ name: 'name', label: 'Name', required: true, span: 2 }, { name: 'trn', label: 'TRN (VAT number)' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone' }, { name: 'contactPerson', label: 'Contact person' },
        ...(kind === 'customers' ? [{ name: 'creditLimit', label: 'Credit limit', type: 'money' as const }] : []), { name: 'paymentTermsDays', label: 'Payment terms (days)', type: 'int', defaultValue: '30' }, { name: 'address', label: 'Address', type: 'textarea' }]} />
  );
}

export function PartyDetail({ kind }: { kind: 'customers' | 'suppliers' }) {
  const { id } = useParams<{ id: string }>();
  const { data: p, loading } = useApi<any>(`/${kind}/${id}`);
  const side = kind === 'customers' ? 'sales' : 'purchases';
  if (loading || !p) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHeader title={`${p.code} · ${p.name}`} subtitle={<span>{p.email} {p.phone && `· ${p.phone}`} {p.trn && `· TRN ${p.trn}`}</span>} actions={<Link className="text-sm text-brand-700 hover:underline" href={`/${side}/documents/new?type=INVOICE&partyId=${id}`}>+ New invoice</Link>} />
      <div className="grid max-w-3xl grid-cols-3 gap-3"><Stat label="Balance" value={`${money(p.balance)} ${p.balanceSide ?? ''}`} /><Stat label="Credit limit" value={p.creditLimit ? money(p.creditLimit) : '—'} /><Stat label="Payment terms" value={`${p.paymentTermsDays} days`} /></div>
      <Card title={`${kind === 'customers' ? 'Customer' : 'Supplier'} statement`} pad={false}><div className="p-3"><ReportViewer name="ledger-statement" initial={{ accountId: p.accountId }} /></div></Card>
    </div>
  );
}
