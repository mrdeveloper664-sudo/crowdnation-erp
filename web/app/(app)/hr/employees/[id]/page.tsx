'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { ApiError, api } from '@/lib/api';
import { money } from '@/lib/format';
import { DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/Form';
import { Alert, Button, Card, Input, PageHeader, Select, Spinner } from '@/components/ui';

export default function EmployeeDetail() {
  const { id } = useParams<{ id: string }>(); const { data: e, reload } = useApi<any>(`/hr/employees/${id}`); const comps = useApi<any[]>('/hr/salary-components'); const bal = useApi<any[]>(`/hr/leave/balance/${id}`);
  const [items, setItems] = useState<Array<{ componentId: string; value: string }> | null>(null); const [doc, setDoc] = useState(false); const [comp, setComp] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  if (!e) return <Spinner />;
  const cur = items ?? e.salaryItems.map((i: any) => ({ componentId: i.componentId, value: String(Number(i.value)) }));
  return (
    <div className="space-y-4">
      <PageHeader title={`${e.code} · ${e.name}`} subtitle={`${e.email ?? ''} · joined ${e.joinDate}`} />
      {err && <Alert>{err}</Alert>}{msg && <Alert kind="success">{msg}</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Salary structure" actions={<><Button size="sm" variant="secondary" onClick={() => setComp(true)}>+ Component</Button><Button size="sm" onClick={async () => { setErr(''); try { await api.put(`/hr/employees/${id}/salary-items`, { items: cur.filter((i: any) => i.componentId && i.value) }); setMsg('Salary structure saved'); setItems(null); reload(); } catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); } }}>Save</Button></>}>
          <p className="mb-2 text-sm">Basic salary <b className="num">{money(e.basicSalary)}</b></p>
          <div className="space-y-2">{cur.map((i: any, k: number) => <div key={k} className="flex gap-2"><Select value={i.componentId} onChange={(ev) => setItems(cur.map((x: any, j: number) => (j === k ? { ...x, componentId: ev.target.value } : x)))}><option value="">Component…</option>{comps.data?.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type.toLowerCase()}, {c.calc === 'FIXED' ? 'amount' : '% of basic'})</option>)}</Select><Input className="num w-28 text-right" value={i.value} inputMode="decimal" onChange={(ev) => setItems(cur.map((x: any, j: number) => (j === k ? { ...x, value: ev.target.value } : x)))} /><button className="text-slate-400 hover:text-red-600" aria-label="Remove" onClick={() => setItems(cur.filter((_: any, j: number) => j !== k))}>✕</button></div>)}</div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setItems([...cur, { componentId: '', value: '' }])}>+ Add allowance / deduction</Button>
        </Card>
        <Card title="Leave balances (this year)" pad={false}><DataTable rows={bal.data} rowKey={(r: any) => r.leaveType} columns={[{ key: 'leaveType', label: 'Type' }, { key: 'allowance', label: 'Allowance', align: 'right' }, { key: 'used', label: 'Used', align: 'right' }, { key: 'remaining', label: 'Remaining', align: 'right' }]} /></Card>
      </div>
      <Card title="Documents" actions={<Button size="sm" variant="secondary" onClick={() => setDoc(true)}>+ Add document</Button>} pad={false}><DataTable rows={e.documents} empty="No documents" columns={[{ key: 'docType', label: 'Type' }, { key: 'title', label: 'Title' }, { key: 'expiryDate', label: 'Expiry', render: (d: any) => d.expiryDate?.slice(0, 10) ?? '—' }]} /></Card>
      <FormModal open={doc} onClose={() => setDoc(false)} title="Employee document" fields={[{ name: 'docType', label: 'Type', type: 'select', required: true, options: ['PASSPORT', 'VISA', 'EMIRATES_ID', 'CONTRACT', 'LABOUR_CARD', 'OTHER'].map((t) => ({ value: t, label: t.replace('_', ' ') })) }, { name: 'title', label: 'Title', required: true }, { name: 'expiryDate', label: 'Expiry date', type: 'date' }]} onSubmit={async (v) => { await api.post(`/hr/employees/${id}/documents`, v); reload(); }} />
      <FormModal open={comp} onClose={() => setComp(false)} title="New salary component" fields={[{ name: 'name', label: 'Name', required: true }, { name: 'type', label: 'Type', type: 'select', required: true, options: [{ value: 'ALLOWANCE', label: 'Allowance' }, { value: 'DEDUCTION', label: 'Deduction' }] }, { name: 'calc', label: 'Calculated as', type: 'select', required: true, options: [{ value: 'FIXED', label: 'Fixed amount' }, { value: 'PERCENT_OF_BASIC', label: '% of basic' }] }]} onSubmit={async (v) => { await api.post('/hr/salary-components', v); comps.reload(); }} />
    </div>
  );
}
