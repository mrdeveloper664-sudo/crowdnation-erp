'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api, qs } from '@/lib/api';
import { money, today } from '@/lib/format';
import { Column, DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/Form';
import { useSession } from '@/components/Session';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Stat, Tabs } from '@/components/ui';

export default function VatPage() {
  const { can } = useSession(); const [tab, setTab] = useState('return');
  const y = new Date().getFullYear(); const [range, setRange] = useState({ from: `${y}-01-01`, to: `${y}-12-31` });
  const [applied, setApplied] = useState(range);
  const ret = useApi<any>(`/vat/return${qs(applied)}`); const rates = useApi<any[]>('/vat/rates');
  const [modal, setModal] = useState(false); const [calc, setCalc] = useState({ code: 'STD', date: today(), amount: '', inclusive: false }); const [res, setRes] = useState<any>(null); const [err, setErr] = useState('');
  const rateCols: Column[] = [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'treatment', label: 'Treatment', render: (r) => <Badge tone="slate">{r.treatment.replace('_', ' ')}</Badge> }, { key: 'rate', label: 'Rate %', align: 'right' }, { key: 'isReverseCharge', label: 'Reverse charge', render: (r) => (r.isReverseCharge ? <Badge tone="amber">Reverse charge</Badge> : '') }, { key: 'effectiveFrom', label: 'From' }, { key: 'effectiveTo', label: 'To', render: (r) => r.effectiveTo ?? 'open' }, { key: 'isActive', label: 'Active', render: (r) => (r.isActive ? 'Yes' : 'No') }];
  const boxCols: Column[] = [{ key: 'box', label: 'Box' }, { key: 'label', label: 'Description' }, { key: 'amount', label: 'Amount (AED)', align: 'right', render: (b) => money(b.amount) }, { key: 'vat', label: 'VAT amount', align: 'right', render: (b) => money(b.vat) }, { key: 'adjustment', label: 'Adjustments', align: 'right', render: (b) => (b.adjustment !== undefined ? money(b.adjustment) : '') }];
  return (
    <div>
      <PageHeader title="UAE VAT" subtitle="Tax codes with effective dates, VAT calculator and VAT 201 return summary" />
      <Tabs tabs={[{ id: 'return', label: 'VAT return' }, { id: 'rates', label: 'Tax codes' }, { id: 'calc', label: 'Calculator' }, { id: 'txns', label: 'Transactions report' }]} value={tab} onChange={setTab} />
      {tab === 'return' && (
        <div className="space-y-4">
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setApplied(range); }}><Field label="From"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field><Field label="To"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field><Button type="submit">Prepare return</Button>
            <a className="text-sm text-brand-700 hover:underline" href={`/api/v1/reports/run/vat${qs({ ...applied, format: 'xlsx' })}`}>Export transactions (Excel)</a></form>
          {ret.data && (<>
            <p className="text-sm text-slate-500">{ret.data.company} · TRN {ret.data.trn ?? 'not set'} · {ret.data.transactionCount} tax transactions</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Output VAT (due)" value={money(ret.data.summary.totalVatDue)} /><Stat label="Input VAT (recoverable)" value={money(ret.data.summary.recoverableVat)} /><Stat label={ret.data.summary.position === 'PAYABLE' ? 'Net VAT payable' : 'Net VAT refundable'} value={money(ret.data.summary.netVatDue)} tone={ret.data.summary.position === 'PAYABLE' ? undefined : 'good'} /><Stat label="Out of scope (supplies)" value={money(ret.data.outOfScope.outputs)} /></div>
            <Card title="Supplies (outputs)" pad={false}><DataTable columns={boxCols} rows={ret.data.outputs} rowKey={(r: any) => r.box} /></Card>
            <Card title="Expenses (inputs)" pad={false}><DataTable columns={boxCols} rows={ret.data.inputs} rowKey={(r: any) => r.box} /></Card></>)}
        </div>)}
      {tab === 'rates' && <div className="space-y-3">{can('vat', 'create') && <div className="flex gap-2"><Button onClick={() => setModal(true)}>+ New tax code / rate version</Button>{!rates.data?.some((r) => r.isReverseCharge) && <Button variant="secondary" onClick={async () => { await api.post('/vat/rates/reverse-charge'); rates.reload(); }}>Enable reverse charge (code RC)</Button>}</div>}<p className="text-sm text-slate-500">Adding a rate with the same code and a later effective date closes the previous version the day before.</p><DataTable columns={rateCols} rows={rates.data} loading={rates.loading} /></div>}
      {tab === 'calc' && (
        <Card title="VAT calculator" className="max-w-xl"><div className="grid grid-cols-2 gap-3">
          <Field label="Tax code"><Select value={calc.code} onChange={(e) => setCalc({ ...calc, code: e.target.value })}>{[...new Set(rates.data?.map((r) => r.code))].map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field><Field label="Date"><Input type="date" value={calc.date} onChange={(e) => setCalc({ ...calc, date: e.target.value })} /></Field>
          <Field label="Amount"><Input inputMode="decimal" value={calc.amount} onChange={(e) => setCalc({ ...calc, amount: e.target.value })} /></Field><Field label="Amount is"><Select value={calc.inclusive ? 'in' : 'ex'} onChange={(e) => setCalc({ ...calc, inclusive: e.target.value === 'in' })}><option value="ex">VAT-exclusive</option><option value="in">VAT-inclusive</option></Select></Field></div>
          <Button className="mt-4" onClick={async () => { setErr(''); try { setRes((await api.post('/vat/calculate', calc)).data); } catch (e: any) { setErr(e.message); } }}>Calculate</Button>
          {err && <div className="mt-3"><Alert>{err}</Alert></div>}
          {res && <dl className="mt-4 grid grid-cols-3 gap-3 text-sm"><div><dt className="text-xs text-slate-500">Net</dt><dd className="num text-lg font-semibold">{money(res.net)}</dd></div><div><dt className="text-xs text-slate-500">VAT @ {res.rate}%</dt><dd className="num text-lg font-semibold">{money(res.vat)}</dd></div><div><dt className="text-xs text-slate-500">Gross</dt><dd className="num text-lg font-semibold">{money(res.gross)}</dd></div></dl>}
        </Card>)}
      {tab === 'txns' && <p className="text-sm"><a className="text-brand-700 hover:underline" href="/reports/vat">Open the VAT transaction report →</a></p>}
      <FormModal open={modal} onClose={() => setModal(false)} title="New tax code / rate version" fields={[{ name: 'code', label: 'Code', required: true, placeholder: 'STD' }, { name: 'name', label: 'Name', required: true }, { name: 'treatment', label: 'Treatment', type: 'select', required: true, options: ['STANDARD', 'ZERO', 'EXEMPT', 'OUT_OF_SCOPE'].map((t) => ({ value: t, label: t.replace('_', ' ') })) }, { name: 'rate', label: 'Rate %', required: true, defaultValue: '5' }, { name: 'effectiveFrom', label: 'Effective from', type: 'date', required: true, defaultValue: today() }, { name: 'effectiveTo', label: 'Effective to', type: 'date' }, { name: 'reverseCharge', label: 'Reverse charge (purchases: VAT is both output and input)', type: 'checkbox' }]} onSubmit={async (v) => { await api.post('/vat/rates', v); rates.reload(); }} />
    </div>
  );
}
