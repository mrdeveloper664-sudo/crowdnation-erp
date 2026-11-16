'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { ApiError, api } from '@/lib/api';
import { money, today } from '@/lib/format';
import { Combobox, accountOption } from '@/components/Combobox';
import { DataTable } from '@/components/DataTable';
import { useSession } from '@/components/Session';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Tabs } from '@/components/ui';

type Mode = 'in' | 'out' | 'transfer' | 'adjust';
interface L { productId: string; label?: string; quantity: string; totalCost: string; batchNo: string; expiryDate: string; serialNos: string }
const blank = (): L => ({ productId: '', quantity: '', totalCost: '', batchNo: '', expiryDate: '', serialNos: '' });

function StockForm({ mode, warehouses, onDone }: { mode: Mode; warehouses: any[]; onDone: () => void }) {
  const [wh, setWh] = useState(''); const [to, setTo] = useState(''); const [date, setDate] = useState(today()); const [offset, setOffset] = useState(''); const [note, setNote] = useState('');
  const [lines, setLines] = useState<L[]>([blank()]); const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false);
  const set = (i: number, p: Partial<L>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  async function submit() {
    setErr(''); setOk(''); setBusy(true);
    const used = lines.filter((l) => l.productId);
    const ml = used.map((l) => ({ productId: l.productId, ...(mode === 'adjust' ? { countedQty: l.quantity, unitCost: l.totalCost || undefined, batchNo: l.batchNo || undefined } : { quantity: l.quantity, totalCost: mode === 'in' ? l.totalCost : undefined, batchNo: l.batchNo || undefined, expiryDate: l.expiryDate || undefined, serialNos: l.serialNos ? l.serialNos.split(/[,\s]+/).filter(Boolean) : undefined }) }));
    try {
      const r = mode === 'in' ? await api.post('/inventory/stock-in', { warehouseId: wh, date, offsetAccountId: offset, note: note || undefined, lines: ml })
        : mode === 'out' ? await api.post('/inventory/stock-out', { warehouseId: wh, date, offsetAccountId: offset, note: note || undefined, lines: ml })
        : mode === 'transfer' ? await api.post('/inventory/transfers', { fromWarehouseId: wh, toWarehouseId: to, date, note: note || undefined, lines: ml })
        : await api.post('/inventory/adjustments', { warehouseId: wh, date, note: note || undefined, lines: ml });
      setOk(mode === 'adjust' ? `Adjusted ${r.data.adjusted.length} item(s); net value ${money(r.data.netValue)}` : 'Done'); setLines([blank()]); onDone();
    } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  }
  const prods = (l: L, i: number) => <Combobox value={l.productId} initialLabel={l.label} endpoint="/inventory/products?active=true" map={(p) => ({ value: p.id, label: `${p.sku} ${p.name}`, hint: `stock ${p.onHand}` })} onChange={(v, o) => set(i, { productId: v, label: o?.label })} placeholder="Product" />;
  return (
    <Card>
      <div className="space-y-4">{err && <Alert>{err}</Alert>}{ok && <Alert kind="success">{ok}</Alert>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label={mode === 'transfer' ? 'From warehouse' : 'Warehouse'} required><Select value={wh} onChange={(e) => setWh(e.target.value)}><option value="">Select…</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
          {mode === 'transfer' && <Field label="To warehouse" required><Select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Select…</option>{warehouses.filter((w) => w.id !== wh).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>}
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          {(mode === 'in' || mode === 'out') && <Field label={mode === 'in' ? 'Credit ledger (offset)' : 'Debit ledger (offset)'} required hint={mode === 'in' ? 'e.g. Owner Capital, Opening balance equity' : 'e.g. an expense for damaged goods'}><Combobox value={offset} endpoint="/chart-of-accounts/accounts?active=true" map={accountOption} onChange={setOffset} /></Field>}
          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
        <table className="min-w-full text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="px-1 py-1 text-left">Product</th><th className="w-28 px-1 py-1 text-right">{mode === 'adjust' ? 'Counted qty' : 'Quantity'}</th>{(mode === 'in' || mode === 'adjust') && <th className="w-32 px-1 py-1 text-right">{mode === 'in' ? 'Total cost' : 'Unit cost (gain)'}</th>}<th className="w-32 px-1 py-1 text-left">Batch</th>{mode === 'in' && <th className="w-36 px-1 py-1 text-left">Expiry</th>}{mode !== 'adjust' && <th className="px-1 py-1 text-left">Serial nos.</th>}<th className="w-6" /></tr></thead>
          <tbody>{lines.map((l, i) => <tr key={i} className="align-top"><td className="min-w-[14rem] px-1 py-1">{prods(l, i)}</td><td className="px-1 py-1"><Input className="num text-right" inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></td>
            {(mode === 'in' || mode === 'adjust') && <td className="px-1 py-1"><Input className="num text-right" inputMode="decimal" value={l.totalCost} onChange={(e) => set(i, { totalCost: e.target.value })} /></td>}
            <td className="px-1 py-1"><Input value={l.batchNo} onChange={(e) => set(i, { batchNo: e.target.value })} /></td>{mode === 'in' && <td className="px-1 py-1"><Input type="date" value={l.expiryDate} onChange={(e) => set(i, { expiryDate: e.target.value })} /></td>}
            {mode !== 'adjust' && <td className="px-1 py-1"><Input value={l.serialNos} onChange={(e) => set(i, { serialNos: e.target.value })} placeholder="SN1, SN2" /></td>}<td><button aria-label="Remove line" className="px-1 pt-2 text-slate-400 hover:text-red-600" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, k) => k !== i) : ls))}>✕</button></td></tr>)}</tbody></table>
        <div className="flex justify-between"><Button variant="secondary" size="sm" onClick={() => setLines((l) => [...l, blank()])}>+ Add line</Button><Button disabled={busy || !wh} onClick={submit}>{busy ? 'Posting…' : 'Post'}</Button></div>
      </div>
    </Card>
  );
}

export default function StockPage() {
  const { can } = useSession(); const [tab, setTab] = useState('balances');
  const wh = useApi<any[]>('/inventory/warehouses'); const [whFilter, setWhFilter] = useState('');
  const stock = useApi<any[]>(`/inventory/stock${whFilter ? `?warehouseId=${whFilter}` : ''}`); const mv = useApi<any[]>(tab === 'movements' ? '/inventory/movements' : null);
  const tabs = [{ id: 'balances', label: 'Stock balances' }, { id: 'movements', label: 'Movements' }, ...(can('inventory', 'create') ? [{ id: 'in', label: 'Stock in' }, { id: 'out', label: 'Stock out' }, { id: 'transfer', label: 'Transfer' }] : []), ...(can('inventory', 'edit') ? [{ id: 'adjust', label: 'Stock count / adjustment' }] : []), { id: 'reports', label: 'Reports' }];
  return (
    <div>
      <PageHeader title="Stock & Operations" subtitle="Valuation uses the company's FIFO / weighted-average setting; every movement integrates with the ledger." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'balances' && <div className="space-y-3"><Select className="max-w-xs" value={whFilter} onChange={(e) => setWhFilter(e.target.value)} aria-label="Warehouse"><option value="">All warehouses</option>{wh.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
        <DataTable rows={stock.data} loading={stock.loading} rowClass={(r: any) => (Number(r.minStock) > 0 && Number(r.qty) <= Number(r.minStock) ? 'bg-red-50' : undefined)} rowKey={(r: any) => r.productId + r.warehouseId} columns={[{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product' }, { key: 'category', label: 'Category' }, { key: 'warehouse', label: 'Warehouse' }, { key: 'qty', label: 'Quantity', align: 'right' }, { key: 'value', label: 'Value', align: 'right', render: (r: any) => money(r.value) }]} /></div>}
      {tab === 'movements' && <DataTable rows={mv.data} loading={mv.loading} columns={[{ key: 'movementDate', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'batchNo', label: 'Batch' }, { key: 'quantity', label: 'Qty', align: 'right' }, { key: 'unitCost', label: 'Unit cost', align: 'right' }, { key: 'totalCost', label: 'Value', align: 'right', render: (m: any) => money(m.totalCost) }, { key: 'sourceType', label: 'Source' }]} />}
      {['in', 'out', 'transfer', 'adjust'].includes(tab) && <StockForm key={tab} mode={tab as Mode} warehouses={wh.data ?? []} onDone={stock.reload} />}
      {tab === 'reports' && <ul className="list-inside list-disc space-y-1 text-sm text-brand-700">{[['stock-summary', 'Stock summary'], ['stock-valuation', 'Stock valuation (reconciled to the inventory ledger)'], ['low-stock', 'Low stock'], ['batch-summary', 'Batch & expiry summary'], ['stock-movements', 'Stock movements']].map(([n, l]) => <li key={n}><a className="hover:underline" href={`/reports/${n}`}>{l}</a></li>)}</ul>}
    </div>
  );
}
