'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { ApiError, api } from '@/lib/api';
import { today } from '@/lib/format';
import { DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/Form';
import { useSession } from '@/components/Session';
import { Alert, Badge, Button, PageHeader } from '@/components/ui';

export default function Leave() {
  const { can } = useSession(); const { data, loading, reload } = useApi<any[]>('/hr/leave'); const types = useApi<any[]>('/hr/leave-types'); const emps = useApi<any[]>('/hr/employees?active=true');
  const [open, setOpen] = useState(false); const [typeModal, setTypeModal] = useState(false); const [err, setErr] = useState('');
  const nm = (id: string) => emps.data?.find((e) => e.id === id)?.name ?? '—'; const tn = (id: string) => types.data?.find((t) => t.id === id)?.name ?? '';
  const act = async (id: string, a: string) => { setErr(''); try { await api.post(`/hr/leave/${id}/${a}`); reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } };
  return (
    <div>
      <PageHeader title="Leave" subtitle="Requests are checked against allowances and overlaps" actions={<>{can('hr', 'create') && <Button variant="secondary" onClick={() => setTypeModal(true)}>+ Leave type</Button>}<Button onClick={() => setOpen(true)}>+ Request leave</Button></>} />
      {err && <Alert>{err}</Alert>}
      <DataTable rows={data} loading={loading} columns={[{ key: 'e', label: 'Employee', render: (r: any) => nm(r.employeeId) }, { key: 't', label: 'Type', render: (r: any) => tn(r.leaveTypeId) }, { key: 'fromDate', label: 'From' }, { key: 'toDate', label: 'To' }, { key: 'days', label: 'Days', align: 'right' }, { key: 'status', label: 'Status', render: (r: any) => <Badge>{r.status}</Badge> },
        { key: 'a', label: '', render: (r: any) => <span className="flex gap-1">{r.status === 'PENDING' && can('hr', 'approve') && <><Button size="sm" onClick={() => act(r.id, 'approve')}>Approve</Button><Button size="sm" variant="danger" onClick={() => act(r.id, 'reject')}>Reject</Button></>}{['PENDING', 'APPROVED'].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => act(r.id, 'cancel')}>Cancel</Button>}</span> }]} />
      <FormModal open={open} onClose={() => setOpen(false)} title="Request leave" fields={[...(can('hr', 'edit') ? [{ name: 'employeeId', label: 'Employee', type: 'select' as const, options: emps.data?.map((e) => ({ value: e.id, label: e.name })), hint: 'Blank = yourself' }] : []), { name: 'leaveTypeId', label: 'Leave type', type: 'select', required: true, options: types.data?.map((t) => ({ value: t.id, label: `${t.name}${t.isPaid ? '' : ' (unpaid)'}` })) }, { name: 'fromDate', label: 'From', type: 'date', required: true, defaultValue: today() }, { name: 'toDate', label: 'To', type: 'date', required: true, defaultValue: today() }, { name: 'reason', label: 'Reason', type: 'textarea' }]} onSubmit={async (v) => { await api.post('/hr/leave', v); reload(); }} />
      <FormModal open={typeModal} onClose={() => setTypeModal(false)} title="New leave type" fields={[{ name: 'name', label: 'Name', required: true }, { name: 'daysPerYear', label: 'Days per year (0 = unlimited)', type: 'int', required: true, defaultValue: '30' }, { name: 'isPaid', label: 'Paid leave', type: 'checkbox', defaultValue: true }]} onSubmit={async (v) => { await api.post('/hr/leave-types', { ...v, isPaid: !!v.isPaid }); types.reload(); }} />
    </div>
  );
}
