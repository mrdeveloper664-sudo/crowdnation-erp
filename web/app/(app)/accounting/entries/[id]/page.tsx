'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { money } from '@/lib/format';
import { DataTable } from '@/components/DataTable';
import { Alert, Badge, Card, PageHeader, Spinner } from '@/components/ui';

export default function EntryPage() {
  const { id } = useParams<{ id: string }>();
  const { data: e, loading, error } = useApi<any>(`/journal-entries/${id}`);
  if (loading) return <Spinner />; if (error) return <Alert>{error}</Alert>; if (!e) return null;
  return (
    <div>
      <PageHeader title={`Journal entry ${e.entryNumber}`} subtitle={`${e.entryDate} · ${e.currency} · immutable posted record`} actions={e.voucher && <Link className="text-sm text-brand-700 hover:underline" href={`/accounting/vouchers/${e.voucher.id}`}>Source voucher {e.voucher.number}</Link>} />
      <div className="mb-3 flex gap-2 text-sm"><Badge tone="slate">{e.sourceType}</Badge>{e.reversalOf && <Link href={`/accounting/entries/${e.reversalOf.id}`}><Badge tone="amber">Reverses {e.reversalOf.entryNumber}</Badge></Link>}{e.reversedBy && <Link href={`/accounting/entries/${e.reversedBy.id}`}><Badge tone="red">Reversed by {e.reversedBy.entryNumber}</Badge></Link>}</div>
      {e.narration && <p className="mb-3 text-sm text-slate-600">{e.narration}</p>}
      <Card pad={false}><DataTable rows={e.lines} columns={[{ key: 'no', label: '#', render: (l: any) => l.lineNo }, { key: 'acc', label: 'Account', render: (l: any) => <Link className="text-brand-700 hover:underline" href={`/accounting/ledgers/${l.accountId}`}>{l.account.code} {l.account.name}</Link> }, { key: 'description', label: 'Description' },
        { key: 'debit', label: 'Debit', align: 'right', render: (l: any) => (l.debit !== '0.00' ? money(l.debit) : '') }, { key: 'credit', label: 'Credit', align: 'right', render: (l: any) => (l.credit !== '0.00' ? money(l.credit) : '') }]} /></Card>
    </div>
  );
}
