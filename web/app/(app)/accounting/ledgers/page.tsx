'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';
import { money } from '@/lib/format';
import { Column, DataTable } from '@/components/DataTable';
import { Badge, Input, PageHeader, Select } from '@/components/ui';

const TYPES = ['CASH', 'BANK', 'CUSTOMER', 'SUPPLIER', 'VAT_INPUT', 'VAT_OUTPUT', 'FIXED_ASSET', 'INVENTORY', 'CAPITAL', 'INCOME', 'EXPENSE', 'GENERAL'];

export default function LedgersPage() {
  const router = useRouter(); const [type, setType] = useState(''); const [search, setSearch] = useState('');
  const { data, loading } = useApi<any[]>(`/ledgers${qs({ type, search })}`);
  const cols: Column[] = [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Ledger' }, { key: 'groupName', label: 'Group' }, { key: 'type', label: 'Type', render: (r) => <Badge tone="slate">{r.type}</Badge> },
    { key: 'debit', label: 'Debit', align: 'right', render: (r) => money(r.debit) }, { key: 'credit', label: 'Credit', align: 'right', render: (r) => money(r.credit) }, { key: 'balance', label: 'Balance', align: 'right', render: (r) => <b>{money(r.balance)} {r.balanceSide ?? ''}</b> }];
  return (
    <div>
      <PageHeader title="Ledgers" subtitle="Live balances computed from posted journal entries. Click a ledger for its statement." />
      <div className="mb-3 flex flex-wrap gap-2"><Input className="max-w-xs" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" /><Select className="max-w-[12rem]" value={type} onChange={(e) => setType(e.target.value)} aria-label="Ledger type"><option value="">All ledger types</option>{TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</Select></div>
      <DataTable columns={cols} rows={data} loading={loading} onRowClick={(r) => router.push(`/accounting/ledgers/${r.id}`)} />
    </div>
  );
}
