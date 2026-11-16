'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { ApiError, api } from '@/lib/api';
import { money } from '@/lib/format';
import { DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/Form';
import { useSession } from '@/components/Session';
import { Alert, Badge, Button, Card, ConfirmDialog, PageHeader, Spinner } from '@/components/ui';
import { Attachments } from '@/modules/Attachments';
import { VoucherEditor } from '@/modules/VoucherEditor';

export default function VoucherDetail() {
  const { id } = useParams<{ id: string }>(); const router = useRouter(); const { can, me } = useSession();
  const { data: v, loading, error, reload } = useApi<any>(`/vouchers/${id}`);
  const [edit, setEdit] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [reason, setReason] = useState<null | 'reject' | 'cancel' | 'replace'>(null); const [confirm, setConfirm] = useState<null | 'delete' | 'post'>(null);
  if (loading && !v) return <Spinner />; if (error) return <Alert>{error}</Alert>; if (!v) return null;
  const run = async (fn: () => Promise<any>, ok: string) => { setErr(''); setMsg(''); try { await fn(); setMsg(ok); reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } };
  const editable = ['DRAFT', 'REJECTED'].includes(v.status);
  if (edit) return <div><PageHeader title={`Edit ${v.number}`} /><VoucherEditor voucher={{ ...v, company: me.company }} onSaved={() => { setEdit(false); reload(); }} /><Button variant="ghost" className="mt-3" onClick={() => setEdit(false)}>Cancel editing</Button></div>;
  return (
    <div className="space-y-4">
      <PageHeader title={`${v.type.replace('_', ' ')} ${v.number}`} subtitle={<span className="flex items-center gap-2">{v.voucherDate} · <Badge>{v.status}</Badge>{v.replacesId && <Link className="text-brand-700 hover:underline" href={`/accounting/vouchers/${v.replacesId}`}>replaces earlier voucher</Link>}</span>}
        actions={<>
          {can('voucher', 'print') && <><a href={`/api/v1/vouchers/${id}/print`} target="_blank" rel="noreferrer"><Button variant="secondary">Print</Button></a><a href={`/api/v1/vouchers/${id}/print?format=pdf`} target="_blank" rel="noreferrer"><Button variant="secondary">PDF</Button></a></>}
          {editable && can('voucher', 'edit') && <Button variant="secondary" onClick={() => setEdit(true)}>Edit</Button>}
          {editable && can('voucher', 'create') && <Button variant="secondary" onClick={() => run(() => api.post(`/vouchers/${id}/submit`), 'Submitted for approval')}>Submit for approval</Button>}
          {v.status === 'PENDING_APPROVAL' && can('voucher', 'approve') && <><Button onClick={() => run(() => api.post(`/vouchers/${id}/approve`), 'Approved')}>Approve</Button><Button variant="danger" onClick={() => setReason('reject')}>Reject</Button></>}
          {['DRAFT', 'APPROVED'].includes(v.status) && can('voucher', 'post') && <Button onClick={() => setConfirm('post')}>Post</Button>}
          {v.status === 'POSTED' && can('voucher', 'cancel') && <><Button variant="secondary" onClick={() => setReason('replace')}>Reverse &amp; replace</Button><Button variant="danger" onClick={() => setReason('cancel')}>Cancel (reverse)</Button></>}
          {v.status === 'DRAFT' && can('voucher', 'delete') && <Button variant="ghost" onClick={() => setConfirm('delete')}>Delete</Button>}
        </>} />
      {err && <Alert>{err}</Alert>}{msg && <Alert kind="success">{msg}</Alert>}
      {v.status === 'REJECTED' && v.rejectedReason && <Alert>Rejected: {v.rejectedReason}</Alert>}
      {v.status === 'CANCELLED' && <Alert kind="info">Cancelled{v.cancelReason ? `: ${v.cancelReason}` : ''}. {v.journalEntryId && <Link className="underline" href={`/accounting/entries/${v.journalEntryId}`}>Original entry</Link>} {v.reversalEntryId && <> · <Link className="underline" href={`/accounting/entries/${v.reversalEntryId}`}>Reversal entry</Link></>}</Alert>}
      <Card><dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4"><div><dt className="text-xs text-slate-500">Reference</dt><dd>{v.reference || '—'}</dd></div><div><dt className="text-xs text-slate-500">Currency</dt><dd>{v.currency} @ {v.exchangeRate}</dd></div><div><dt className="text-xs text-slate-500">Total</dt><dd className="num font-semibold">{money(v.totalAmount)}</dd></div><div><dt className="text-xs text-slate-500">Journal entry</dt><dd>{v.journalEntryId ? <Link className="text-brand-700 hover:underline" href={`/accounting/entries/${v.journalEntryId}`}>View posting</Link> : 'Not posted'}</dd></div><div className="col-span-2 md:col-span-4"><dt className="text-xs text-slate-500">Narration</dt><dd>{v.narration || '—'}</dd></div></dl></Card>
      <Card pad={false} title="Entries"><DataTable rows={v.lines} columns={[{ key: 'n', label: '#', render: (l: any) => l.lineNo }, { key: 'a', label: 'Account', render: (l: any) => <Link className="text-brand-700 hover:underline" href={`/accounting/ledgers/${l.accountId}`}>{l.account.code} {l.account.name}</Link> }, { key: 'description', label: 'Description' },
        { key: 'debit', label: 'Debit', align: 'right', render: (l: any) => (l.debit !== '0.00' ? money(l.debit) : '') }, { key: 'credit', label: 'Credit', align: 'right', render: (l: any) => (l.credit !== '0.00' ? money(l.credit) : '') }]} /></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Attachments entityType="voucher" entityId={id} canEdit={can('voucher', 'edit') || can('voucher', 'create')} />
        <Card title="History (audit trail)"><ol className="space-y-1.5 text-sm">{v.history?.map((h: any, i: number) => <li key={i} className="flex justify-between"><span>{h.action.replace('voucher.', '')}</span><span className="text-xs text-slate-400">{new Date(h.createdAt).toLocaleString()}</span></li>)}</ol></Card>
      </div>
      <FormModal open={!!reason} onClose={() => setReason(null)} title={reason === 'reject' ? 'Reject voucher' : reason === 'replace' ? 'Reverse and replace' : 'Cancel voucher'} submitLabel="Confirm"
        fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true, span: 2 }, ...(reason !== 'reject' ? [{ name: 'date', label: 'Reversal date (default today)', type: 'date' as const }] : [])]}
        onSubmit={async (b) => { if (reason === 'reject') await api.post(`/vouchers/${id}/reject`, b); else if (reason === 'cancel') await api.post(`/vouchers/${id}/cancel`, b); else { const r = await api.post(`/vouchers/${id}/replace`, b); router.push(`/accounting/vouchers/${r.data.replacement.id}`); } reload(); }} />
      <ConfirmDialog open={confirm === 'delete'} onClose={() => setConfirm(null)} title="Delete draft voucher?" message="This permanently removes the draft." danger confirmLabel="Delete" onConfirm={async () => { await api.del(`/vouchers/${id}`); router.push('/accounting/vouchers'); }} />
      <ConfirmDialog open={confirm === 'post'} onClose={() => setConfirm(null)} title="Post voucher?" message="Posting creates an immutable journal entry. Corrections afterwards require reversal." confirmLabel="Post" onConfirm={async () => { setConfirm(null); await run(() => api.post(`/vouchers/${id}/post`), 'Posted'); }} />
    </div>
  );
}
