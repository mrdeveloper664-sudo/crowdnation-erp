'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { ApiError, api, qs } from '@/lib/api';
import { money, sumMoney, today } from '@/lib/format';
import { Column, DataTable } from '@/components/DataTable';
import { Combobox, accountOption } from '@/components/Combobox';
import { useSession } from '@/components/Session';
import { Alert, Badge, Button, Field, Input, Modal, PageHeader, Select } from '@/components/ui';

function Inner({ side }: { side: 'sales' | 'purchases' }) {
  const sp = useSearchParams(); const { can } = useSession();
  const isReceipt = side === 'sales'; const path = `/${side}/${isReceipt ? 'receipts' : 'payments'}`; const res = isReceipt ? 'sales' : 'purchase';
  const [page, setPage] = useState(1); const { data, meta, loading, reload } = useApi<any[]>(`${path}${qs({ page })}`);
  const [open, setOpen] = useState(!!sp.get('partyId')); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ partyId: sp.get('partyId') ?? '', date: today(), amount: sp.get('amount') ?? '', accountId: '', method: 'BANK', reference: '', notes: '' });
  const [alloc, setAlloc] = useState<Record<string, string>>(sp.get('invoiceId') ? { [sp.get('invoiceId')!]: sp.get('amount') ?? '' } : {});
  const invoices = useApi<any[]>(open && f.partyId ? `/${side}/documents?type=INVOICE&outstanding=true&partyId=${f.partyId}&pageSize=100` : null);
  const allocated = sumMoney(Object.values(alloc)); const unalloc = sumMoney([f.amount || '0', '-' + allocated]);
  useEffect(() => { if (sp.get('partyId')) setOpen(true); }, [sp]);
  const cols: Column[] = [{ key: 'settleDate', label: 'Date' }, { key: 'number', label: 'Number' }, { key: 'party', label: isReceipt ? 'Customer' : 'Supplier', render: (r) => r.party?.name }, { key: 'method', label: 'Method' }, { key: 'reference', label: 'Reference' }, { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount) }, { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'POSTED' ? 'green' : 'red'}>{r.status}</Badge> }];
  async function submit() {
    setErr(''); setBusy(true);
    try { await api.post(path, { partyId: f.partyId, date: f.date, amount: f.amount, accountId: f.accountId, method: f.method, reference: f.reference || undefined, notes: f.notes || undefined, allocations: Object.entries(alloc).filter(([, v]) => v && Number(v) > 0).map(([documentId, amount]) => ({ documentId, amount })) }); setOpen(false); reload(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <div>
      <PageHeader title={isReceipt ? 'Customer receipts' : 'Supplier payments'} subtitle="Each posts a voucher and can settle several invoices" actions={can(res, 'post') && <Button onClick={() => setOpen(true)}>+ {isReceipt ? 'New receipt' : 'New payment'}</Button>} />
      <DataTable columns={cols} rows={data} loading={loading} meta={meta} onPage={setPage} />
      <Modal wide open={open} onClose={() => setOpen(false)} title={isReceipt ? 'Record receipt' : 'Record payment'} footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Close</Button><Button disabled={busy || !f.partyId || !f.accountId || !f.amount} onClick={submit}>{busy ? 'Posting…' : 'Post'}</Button></>}>
        <div className="space-y-4">{err && <Alert>{err}</Alert>}
          <div className="grid grid-cols-2 gap-4">
            <Field label={isReceipt ? 'Customer' : 'Supplier'} required><Combobox value={f.partyId} endpoint={isReceipt ? '/customers' : '/suppliers'} map={(p) => ({ value: p.id, label: p.name, hint: p.code })} onChange={(v) => { setF({ ...f, partyId: v }); setAlloc({}); }} /></Field>
            <Field label="Date" required><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label={isReceipt ? 'Deposit to' : 'Pay from'} required><Combobox value={f.accountId} endpoint="/chart-of-accounts/accounts?active=true" map={accountOption} onChange={(v) => setF({ ...f, accountId: v })} placeholder="Cash / bank ledger" /></Field>
            <Field label="Amount" required><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="Method"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{['BANK', 'CASH', 'CHEQUE', 'CARD', 'TRANSFER'].map((m) => <option key={m}>{m}</option>)}</Select></Field>
            <Field label="Reference"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Cheque / transfer no." /></Field></div>
          {f.partyId && <div><h4 className="mb-1 text-sm font-semibold">Allocate to invoices</h4>
            <table className="min-w-full text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="py-1 text-left">Invoice</th><th className="py-1 text-left">Due</th><th className="py-1 text-right">Outstanding</th><th className="w-36 py-1 text-right">Allocate</th></tr></thead>
              <tbody>{invoices.data?.map((i) => <tr key={i.id} className="border-b border-slate-50"><td className="py-1">{i.number}</td><td>{i.dueDate}</td><td className="num text-right">{money(i.outstanding)}</td><td className="py-1"><Input className="num text-right" inputMode="decimal" value={alloc[i.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [i.id]: e.target.value })} /></td></tr>)}
                {invoices.data?.length === 0 && <tr><td colSpan={4} className="py-3 text-center text-slate-400">No open invoices — the amount will be kept on account.</td></tr>}</tbody></table>
            <p className="mt-2 text-right text-xs text-slate-500">Allocated {money(allocated)} · on account {money(unalloc)}</p></div>}
        </div>
      </Modal>
    </div>
  );
}
export function SettlementsPage({ side }: { side: 'sales' | 'purchases' }) { return <Suspense><Inner side={side} /></Suspense>; }
