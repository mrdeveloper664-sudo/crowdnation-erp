'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';
import { money } from '@/lib/format';
import { Column, DataTable } from '@/components/DataTable';
import { useSession } from '@/components/Session';
import { Badge, Button, Input, PageHeader, Select } from '@/components/ui';
import { VOUCHER_TYPES } from '@/modules/VoucherEditor';

const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'POSTED', 'CANCELLED'];

function Inner() {
  const router = useRouter(); const sp = useSearchParams(); const { can } = useSession();
  const [f, setF] = useState({ type: sp.get('type') ?? '', status: sp.get('status') ?? '', from: '', to: '', search: sp.get('search') ?? '' }); const [page, setPage] = useState(1);
  const { data, meta, loading } = useApi<any[]>(`/vouchers${qs({ ...f, page })}`);
  const set = (k: string, v: string) => { setF((x) => ({ ...x, [k]: v })); setPage(1); };
  const cols: Column[] = [{ key: 'voucherDate', label: 'Date' }, { key: 'number', label: 'Number', render: (v) => <span className="font-medium text-brand-700">{v.number}</span> }, { key: 'type', label: 'Type', render: (v) => v.type.replace('_', ' ') },
    { key: 'reference', label: 'Reference' }, { key: 'narration', label: 'Narration', className: 'max-w-xs truncate' }, { key: 'totalAmount', label: 'Amount', align: 'right', render: (v) => `${money(v.totalAmount)} ${v.currency}` }, { key: 'status', label: 'Status', render: (v) => <Badge>{v.status}</Badge> }];
  return (
    <div>
      <PageHeader title="Vouchers" subtitle="Payment, receipt, contra, journal, sales, purchase, credit and debit notes" actions={can('voucher', 'create') && <Link href="/accounting/vouchers/new"><Button>+ New voucher</Button></Link>} />
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Input placeholder="Search number, reference, narration…" value={f.search} onChange={(e) => set('search', e.target.value)} aria-label="Search" className="col-span-2 md:col-span-1" />
        <Select value={f.type} onChange={(e) => set('type', e.target.value)} aria-label="Type"><option value="">All types</option>{VOUCHER_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</Select>
        <Select value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</Select>
        <Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} aria-label="From date" /><Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} aria-label="To date" />
      </div>
      <DataTable columns={cols} rows={data} loading={loading} meta={meta} onPage={setPage} onRowClick={(v) => router.push(`/accounting/vouchers/${v.id}`)} />
    </div>
  );
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
