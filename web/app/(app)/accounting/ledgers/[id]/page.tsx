'use client';
import { useParams } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { money } from '@/lib/format';
import { PageHeader, Stat } from '@/components/ui';
import { ReportViewer } from '@/components/ReportViewer';

export default function LedgerStatement() {
  const { id } = useParams<{ id: string }>();
  const { data } = useApi<any>(`/ledgers/${id}`);
  return (
    <div>
      <PageHeader title={data ? `${data.code} · ${data.name}` : 'Ledger'} subtitle={data ? `${data.group?.name} · ${data.type}` : undefined} />
      {data && <div className="mb-4 grid max-w-xl grid-cols-3 gap-3"><Stat label="Debit" value={money(data.debit)} /><Stat label="Credit" value={money(data.credit)} /><Stat label="Balance" value={`${money(data.balance)} ${data.balanceSide ?? ''}`} /></div>}
      <ReportViewer name="ledger-statement" initial={{ accountId: id }} />
    </div>
  );
}
