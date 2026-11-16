'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';
import { DataTable } from '@/components/DataTable';
import { Input, Modal, PageHeader } from '@/components/ui';

export default function Audit() {
  const [action, setAction] = useState(''); const [page, setPage] = useState(1); const [sel, setSel] = useState<any>(null);
  const { data, meta, loading } = useApi<any[]>(`/audit-logs${qs({ action, page })}`);
  return (
    <div><PageHeader title="Audit log" subtitle="Append-only record of financial and administrative actions" />
      <Input className="mb-3 max-w-xs" placeholder="Filter by action, e.g. voucher.posted" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Action filter" />
      <DataTable rows={data} meta={meta} loading={loading} onPage={setPage} onRowClick={setSel} columns={[{ key: 'createdAt', label: 'When', render: (a: any) => new Date(a.createdAt).toLocaleString() }, { key: 'userName', label: 'User', render: (a: any) => a.userName ?? '—' }, { key: 'action', label: 'Action' }, { key: 'entityType', label: 'Entity' }, { key: 'ip', label: 'IP' }]} />
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel?.action ?? ''} wide><pre className="max-h-96 overflow-auto rounded bg-slate-50 p-3 text-xs">{JSON.stringify({ entity: `${sel?.entityType} ${sel?.entityId ?? ''}`, before: sel?.before, after: sel?.after }, null, 2)}</pre></Modal>
    </div>
  );
}
