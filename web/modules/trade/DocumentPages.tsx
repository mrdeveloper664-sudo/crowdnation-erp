'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { ApiError, api, qs } from '@/lib/api';
import { money } from '@/lib/format';
import { Column, DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/Form';
import { useSession } from '@/components/Session';
import { Alert, Badge, Button, Card, ConfirmDialog, Input, PageHeader, Select, Spinner } from '@/components/ui';
import { Attachments } from '@/modules/Attachments';
import { DocumentEditor } from './DocumentEditor';

type Side = 'sales' | 'purchases';
const TITLES: Record<string, string> = { QUOTATION: 'Quotations', ORDER: 'Orders', INVOICE: 'Invoices', CREDIT_NOTE: 'Credit Notes', REQUEST: 'Purchase Requests', GRN: 'Goods Received Notes', DEBIT_NOTE: 'Debit Notes' };
const SINGULAR: Record<string, string> = { QUOTATION: 'Quotation', ORDER: 'Order', INVOICE: 'Invoice', CREDIT_NOTE: 'Credit note', REQUEST: 'Purchase request', GRN: 'Goods received note', DEBIT_NOTE: 'Debit note' };
const resourceOf = (s: Side) => (s === 'sales' ? 'sales' : 'purchase');

function ListInner({ side }: { side: Side }) {
  const router = useRouter(); const sp = useSearchParams(); const { can } = useSession();
  const type = sp.get('type') ?? 'INVOICE';
  const [f, setF] = useState({ status: '', search: '', outstanding: '' }); const [page, setPage] = useState(1);
  const { data, meta, loading } = useApi<any[]>(`/${side}/documents${qs({ type, ...f, page })}`);
  const cols: Column[] = [{ key: 'docDate', label: 'Date' }, { key: 'number', label: 'Number', render: (d) => <span className="font-medium text-brand-700">{d.number}</span> }, { key: 'party', label: side === 'sales' ? 'Customer' : 'Supplier', render: (d) => d.party?.name },
    { key: 'reference', label: 'Reference' }, { key: 'total', label: 'Total', align: 'right', render: (d) => `${money(d.total)} ${d.currency}` }, ...(['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(type) ? [{ key: 'outstanding', label: 'Outstanding', align: 'right' as const, render: (d: any) => (d.outstanding ? money(d.outstanding) : '') }] : []), { key: 'status', label: 'Status', render: (d) => <Badge>{d.status}</Badge> }];
  return (
    <div>
      <PageHeader title={TITLES[type] ?? type} actions={can(resourceOf(side), 'create') && <Link href={`/${side}/documents/new?type=${type}`}><Button>+ New {SINGULAR[type]?.toLowerCase()}</Button></Link>} />
      <div className="mb-3 flex flex-wrap gap-2"><Input className="max-w-xs" placeholder="Search number, reference, party…" value={f.search} onChange={(e) => { setF({ ...f, search: e.target.value }); setPage(1); }} aria-label="Search" />
        <Select className="max-w-[10rem]" value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }} aria-label="Status"><option value="">All statuses</option>{['DRAFT', 'CONFIRMED', 'POSTED', 'CONVERTED', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}</Select>
        {type === 'INVOICE' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.outstanding} onChange={(e) => { setF({ ...f, outstanding: e.target.checked ? 'true' : '' }); setPage(1); }} /> Outstanding only</label>}</div>
      <DataTable columns={cols} rows={data} loading={loading} meta={meta} onPage={setPage} onRowClick={(d) => router.push(`/${side}/documents/${d.id}`)} />
    </div>
  );
}
export function DocumentList({ side }: { side: Side }) { return <Suspense><ListInner side={side} /></Suspense>; }

function NewInner({ side }: { side: Side }) {
  const router = useRouter(); const sp = useSearchParams(); const type = sp.get('type') ?? 'INVOICE';
  return <div><PageHeader title={`New ${SINGULAR[type]?.toLowerCase() ?? type}`} /><DocumentEditor side={side} type={type} partyId={sp.get('partyId') ?? undefined} onSaved={(id) => router.push(`/${side}/documents/${id}`)} /></div>;
}
export function NewDocument({ side }: { side: Side }) { return <Suspense><NewInner side={side} /></Suspense>; }

export function DocumentDetail({ side }: { side: Side }) {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const { can } = useSession(); const res = resourceOf(side);
  const { data: d, loading, error, reload } = useApi<any>(`/${side}/documents/${id}`);
  const [edit, setEdit] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [modal, setModal] = useState<null | 'cancel' | 'apply' | 'convert'>(null); const [confirm, setConfirm] = useState<null | 'post' | 'delete'>(null);
  const open = useApi<any[]>(d && modal === 'apply' ? `/${side}/documents?type=INVOICE&outstanding=true&partyId=${d.partyId}` : null);
  if (loading && !d) return <Spinner />; if (error) return <Alert>{error}</Alert>; if (!d) return null;
  const run = async (fn: () => Promise<any>, ok: string) => { setErr(''); setMsg(''); try { await fn(); setMsg(ok); reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } };
  const postable = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(d.type);
  const conv: Record<string, string[]> = { 'sales:QUOTATION': ['ORDER', 'INVOICE'], 'sales:ORDER': ['INVOICE'], 'purchases:REQUEST': ['ORDER'], 'purchases:ORDER': ['GRN', 'INVOICE'], 'purchases:GRN': ['INVOICE'] };
  const targets = conv[`${side}:${d.type}`] ?? [];
  if (edit) return <div><PageHeader title={`Edit ${d.number}`} /><DocumentEditor side={side} type={d.type} doc={d} onSaved={() => { setEdit(false); reload(); }} /><Button variant="ghost" className="mt-3" onClick={() => setEdit(false)}>Cancel editing</Button></div>;
  const isNote = ['CREDIT_NOTE', 'DEBIT_NOTE'].includes(d.type);
  return (
    <div className="space-y-4">
      <PageHeader title={`${SINGULAR[d.type]} ${d.number}`} subtitle={<span className="flex items-center gap-2"><Link className="text-brand-700 hover:underline" href={`/${side === 'sales' ? 'sales/customers' : 'purchases/suppliers'}/${d.partyId}`}>{d.party?.name}</Link> · {d.docDate}{d.dueDate && ` · due ${d.dueDate}`} <Badge>{d.status}</Badge></span>}
        actions={<>
          {can(res, 'print') && <><a href={`/api/v1/${side}/documents/${id}/print`} target="_blank" rel="noreferrer"><Button variant="secondary">Print</Button></a><a href={`/api/v1/${side}/documents/${id}/print?format=pdf`} target="_blank" rel="noreferrer"><Button variant="secondary">PDF</Button></a></>}
          {d.status === 'DRAFT' && can(res, 'edit') && <Button variant="secondary" onClick={() => setEdit(true)}>Edit</Button>}
          {d.status === 'DRAFT' && !postable && can(res, 'edit') && <Button variant="secondary" onClick={() => run(() => api.post(`/${side}/documents/${id}/confirm`), d.type === 'GRN' ? 'Goods received into stock' : 'Confirmed')}>{d.type === 'GRN' ? 'Confirm receipt' : 'Confirm'}</Button>}
          {targets.length > 0 && ['DRAFT', 'CONFIRMED'].includes(d.status) && can(res, 'create') && <Button variant="secondary" onClick={() => setModal('convert')}>Convert…</Button>}
          {d.status === 'DRAFT' && postable && can(res, 'post') && <Button onClick={() => setConfirm('post')}>Post</Button>}
          {d.status === 'POSTED' && isNote && can(res, 'post') && <Button variant="secondary" onClick={() => setModal('apply')}>Apply to invoice</Button>}
          {d.status === 'POSTED' && d.type === 'INVOICE' && Number(d.outstanding) > 0 && can(res, 'post') && <Link href={`/${side}/${side === 'sales' ? 'receipts' : 'payments'}?partyId=${d.partyId}&invoiceId=${id}&amount=${d.outstanding}`}><Button>{side === 'sales' ? 'Record receipt' : 'Record payment'}</Button></Link>}
          {['DRAFT', 'CONFIRMED', 'POSTED'].includes(d.status) && can(res, 'cancel') && <Button variant="danger" onClick={() => setModal('cancel')}>Cancel</Button>}
          {d.status === 'DRAFT' && can(res, 'delete') && <Button variant="ghost" onClick={() => setConfirm('delete')}>Delete</Button>}
        </>} />
      {err && <Alert>{err}</Alert>}{msg && <Alert kind="success">{msg}</Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" pad={false} title="Lines"><DataTable rows={d.lines} columns={[{ key: 'description', label: 'Description' }, { key: 'quantity', label: 'Qty', align: 'right' }, { key: 'unitPrice', label: 'Unit price', align: 'right', render: (l: any) => money(l.unitPrice) }, { key: 'discountPct', label: 'Disc %', align: 'right' }, { key: 'net', label: 'Net', align: 'right', render: (l: any) => money(l.net) }, { key: 'vat', label: 'VAT', align: 'right', render: (l: any) => money(l.vat) }, { key: 'gross', label: 'Total', align: 'right', render: (l: any) => money(l.gross) }]} /></Card>
        <Card title="Totals"><dl className="space-y-2 text-sm"><div className="flex justify-between"><dt className="text-slate-500">Net</dt><dd className="num">{money(d.net)}</dd></div><div className="flex justify-between"><dt className="text-slate-500">VAT</dt><dd className="num">{money(d.vat)}</dd></div><div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>Total {d.currency}</dt><dd className="num">{money(d.total)}</dd></div>
          {d.outstanding !== null && <><div className="flex justify-between"><dt className="text-slate-500">{isNote ? 'Applied' : 'Paid'}</dt><dd className="num">{money(d.paid)}</dd></div><div className="flex justify-between font-semibold"><dt>{isNote ? 'Unapplied' : 'Outstanding'}</dt><dd className="num">{money(d.outstanding)}</dd></div></>}
          {d.voucher && <div className="flex justify-between border-t pt-2"><dt className="text-slate-500">Ledger voucher</dt><dd>{d.voucherId ? <Link className="text-brand-700 hover:underline" href={`/accounting/vouchers/${d.voucherId}`}>{d.voucher.number}</Link> : d.voucher.number}</dd></div>}
          {d.sourceDocId && <div className="flex justify-between"><dt className="text-slate-500">Created from</dt><dd><Link className="text-brand-700 hover:underline" href={`/${side}/documents/${d.sourceDocId}`}>source document</Link></dd></div>}</dl></Card>
      </div>
      {d.notes && <Card title="Notes"><p className="text-sm text-slate-600">{d.notes}</p></Card>}
      <Attachments entityType="document" entityId={id} canEdit={can(res, 'edit')} />
      <FormModal open={modal === 'cancel'} onClose={() => setModal(null)} title={`Cancel ${d.number}`} fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true, span: 2 }]} submitLabel="Cancel document" onSubmit={async (b) => { await api.post(`/${side}/documents/${id}/cancel`, b); reload(); }} />
      <FormModal open={modal === 'convert'} onClose={() => setModal(null)} title="Convert document" fields={[{ name: 'to', label: 'Convert to', type: 'select', required: true, options: targets.map((t) => ({ value: t, label: SINGULAR[t] })), span: 2 }]} submitLabel="Convert" onSubmit={async (b) => { const r = await api.post(`/${side}/documents/${id}/convert`, b); router.push(`/${side}/documents/${r.data.id}`); }} />
      <FormModal open={modal === 'apply'} onClose={() => setModal(null)} title="Apply to an open invoice" fields={[{ name: 'invoiceId', label: 'Invoice', type: 'select', required: true, options: open.data?.map((i) => ({ value: i.id, label: `${i.number} — outstanding ${money(i.outstanding)}` })) ?? [], span: 2 }, { name: 'amount', label: 'Amount', type: 'money', required: true, defaultValue: d.outstanding }]} submitLabel="Apply" onSubmit={async (b) => { await api.post(`/${side}/documents/${id}/apply`, b); reload(); }} />
      <ConfirmDialog open={confirm === 'post'} onClose={() => setConfirm(null)} title="Post to the ledger?" message="Creates the accounting entries, VAT entries and stock movements. A posted document is corrected by cancelling it (reversal) or with a credit/debit note." confirmLabel="Post" onConfirm={async () => { setConfirm(null); await run(() => api.post(`/${side}/documents/${id}/post`), 'Posted'); }} />
      <ConfirmDialog open={confirm === 'delete'} onClose={() => setConfirm(null)} title="Delete draft?" message="This permanently removes the draft." danger confirmLabel="Delete" onConfirm={async () => { await api.del(`/${side}/documents/${id}`); router.push(`/${side}/documents?type=${d.type}`); }} />
    </div>
  );
}
