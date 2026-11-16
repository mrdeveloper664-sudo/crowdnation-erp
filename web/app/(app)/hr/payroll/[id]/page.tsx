'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { ApiError, api } from '@/lib/api';
import { money, today } from '@/lib/format';
import { DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/Form';
import { accountOption } from '@/components/Combobox';
import { useSession } from '@/components/Session';
import { Alert, Badge, Button, Card, PageHeader, Spinner, Stat } from '@/components/ui';

export default function PayrollRun() {
  const { id } = useParams<{ id: string }>(); const { can } = useSession(); const { data: r, reload } = useApi<any>(`/hr/payroll/${id}`);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [pay, setPay] = useState(false);
  if (!r) return <Spinner />;
  const act = async (a: string, ok: string) => { setErr(''); setMsg(''); try { await api.post(`/hr/payroll/${id}/${a}`); setMsg(ok); reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } };
  return (
    <div className="space-y-4">
      <PageHeader title={`Payroll ${r.period}`} subtitle={<Badge>{r.status}</Badge>} actions={<>
        {r.status === 'DRAFT' && can('hr', 'approve') && <Button onClick={() => act('approve', 'Approved')}>Approve</Button>}
        {r.status === 'APPROVED' && can('hr', 'post') && <Button onClick={() => act('post', 'Posted to the ledger')}>Post to ledger</Button>}
        {r.status === 'POSTED' && can('hr', 'post') && <Button onClick={() => setPay(true)}>Pay salaries</Button>}
        {['DRAFT', 'APPROVED', 'POSTED'].includes(r.status) && can('hr', 'cancel') && <Button variant="danger" onClick={() => act('cancel', 'Cancelled')}>Cancel</Button>}
        <a className="text-sm text-brand-700 hover:underline" href={`/reports/payroll-report?period=${r.period}`}>Payroll report</a></>} />
      {err && <Alert>{err}</Alert>}{msg && <Alert kind="success">{msg}</Alert>}
      <div className="grid grid-cols-3 gap-3"><Stat label="Gross pay" value={money(r.totalGross)} /><Stat label="Deductions" value={money(r.totalDeduction)} /><Stat label="Net pay" value={money(r.totalNet)} /></div>
      <Card pad={false} title="Payslips"><DataTable rows={r.payslips} columns={[{ key: 'code', label: 'Code' }, { key: 'employee', label: 'Employee' }, { key: 'basic', label: 'Basic', align: 'right', render: (p: any) => money(p.basic) }, { key: 'allowances', label: 'Allowances', align: 'right', render: (p: any) => money(p.allowances) }, { key: 'unpaidDays', label: 'Unpaid days', align: 'right' }, { key: 'deductions', label: 'Deductions', align: 'right', render: (p: any) => money(p.deductions) }, { key: 'net', label: 'Net', align: 'right', render: (p: any) => <b>{money(p.net)}</b> }]} /></Card>
      <FormModal open={pay} onClose={() => setPay(false)} title="Pay salaries" fields={[{ name: 'accountId', label: 'Pay from (cash / bank ledger)', type: 'combo', required: true, endpoint: '/chart-of-accounts/accounts?active=true', map: accountOption, span: 2 }, { name: 'date', label: 'Payment date', type: 'date', required: true, defaultValue: today() }]} submitLabel="Pay" onSubmit={async (v) => { await api.post(`/hr/payroll/${id}/pay`, v); reload(); }} />
    </div>
  );
}
