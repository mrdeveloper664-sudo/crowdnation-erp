'use client';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { ApiError, api } from '@/lib/api';
import { estimateLine, money, sumMoney, today } from '@/lib/format';
import { Combobox, accountOption } from '@/components/Combobox';
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui';

interface L { productId?: string; productLabel?: string; description: string; quantity: string; unitPrice: string; discountPct: string; taxCode: string; accountId?: string; accountLabel?: string; warehouseId?: string; batchNo?: string; serial?: string }
const blank = (): L => ({ description: '', quantity: '1', unitPrice: '', discountPct: '', taxCode: 'STD' });

export function DocumentEditor({ side, type, doc, partyId, onSaved }: { side: 'sales' | 'purchases'; type: string; doc?: any; partyId?: string; onSaved: (id: string) => void }) {
  const rates = useApi<any[]>('/vat/rates'); const warehouses = useApi<any[]>('/inventory/warehouses'); const projects = useApi<any[]>('/projects');
  const [f, setF] = useState({ partyId: doc?.partyId ?? partyId ?? '', partyLabel: doc?.party?.name ?? '', date: doc?.docDate ?? today(), dueDate: doc?.dueDate ?? '', currency: doc?.currency ?? '', exchangeRate: '', pricesIncludeVat: !!doc?.pricesIncludeVat, reference: doc?.reference ?? '', notes: doc?.notes ?? '', warehouseId: doc?.warehouseId ?? '', projectId: doc?.projectId ?? '', sourceDocId: doc?.sourceDocId ?? '' });
  const [lines, setLines] = useState<L[]>(() => doc?.lines?.map((l: any) => ({ productId: l.productId ?? undefined, description: l.description, quantity: l.quantity, unitPrice: String(Number(l.unitPrice)), discountPct: l.discountPct === '0' ? '' : l.discountPct, taxCode: 'STD', accountId: l.accountId ?? undefined })) ?? [blank()]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const isSales = side === 'sales'; const partyEndpoint = isSales ? '/customers?active=true' : '/suppliers?active=true';
  const rateOf = (code: string) => Number(rates.data?.filter((r) => r.code === code && r.isActive).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)).find((r) => r.effectiveFrom <= f.date)?.rate ?? 0);
  useEffect(() => { if (doc?.lines && rates.data) { api.get('/vat/rates').then((r) => setLines((ls) => ls.map((l, i) => { const tr = doc.lines[i]?.taxRateId ? r.data.find((x: any) => x.id === doc.lines[i].taxRateId) : null; return tr ? { ...l, taxCode: tr.code } : l; }))); } }, [doc, rates.data !== undefined]); // eslint-disable-line react-hooks/exhaustive-deps
  const est = useMemo(() => lines.map((l) => estimateLine(l.quantity, l.unitPrice, l.discountPct, rateOf(l.taxCode), f.pricesIncludeVat)), [lines, f.pricesIncludeVat, f.date, rates.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const net = sumMoney(est.map((e) => e.net)), vat = sumMoney(est.map((e) => e.vat)), total = sumMoney(est.map((e) => e.gross));
  const set = (i: number, p: Partial<L>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const codes = [...new Set(rates.data?.map((r) => r.code) ?? ['STD'])];

  async function save(post: boolean) {
    setErr('');
    if (!f.partyId) { setErr(`Select a ${isSales ? 'customer' : 'supplier'}`); return; }
    const used = lines.filter((l) => l.description || l.productId);
    if (!used.length) { setErr('Add at least one line'); return; }
    setBusy(true);
    const payload: any = { date: f.date, dueDate: f.dueDate || undefined, pricesIncludeVat: f.pricesIncludeVat, reference: f.reference || undefined, notes: f.notes || undefined, warehouseId: f.warehouseId || undefined, projectId: f.projectId || undefined,
      lines: used.map((l) => ({ productId: l.productId, description: l.description || undefined, quantity: l.quantity || '1', unitPrice: l.unitPrice || undefined, discountPct: l.discountPct || undefined, taxCode: l.taxCode, accountId: l.accountId, batchNo: l.batchNo || undefined, serialNos: l.serial ? l.serial.split(/[,\s]+/).filter(Boolean) : undefined })) };
    try {
      let id: string;
      if (doc) { id = (await api.put(`/${side}/documents/${doc.id}`, payload)).data.id; }
      else { const body = { type, partyId: f.partyId, currency: f.currency || undefined, exchangeRate: f.exchangeRate || undefined, sourceDocId: f.sourceDocId || undefined, ...payload }; id = (await api.post(`/${side}/documents`, body)).data.id; }
      if (post) await api.post(`/${side}/documents/${id}/post`);
      onSaved(id);
    } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  }
  const postable = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(type);
  return (
    <div className="space-y-4">
      {err && <Alert>{err}</Alert>}
      <Card><div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="col-span-2"><Field label={isSales ? 'Customer' : 'Supplier'} required><Combobox disabled={!!doc} value={f.partyId} initialLabel={f.partyLabel} endpoint={partyEndpoint} map={(p) => ({ value: p.id, label: p.name, hint: p.code })} onChange={(v) => setF({ ...f, partyId: v })} placeholder={`Search ${isSales ? 'customers' : 'suppliers'}…`} /></Field></div>
        <Field label="Date" required><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Due date" hint="Default: payment terms"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <Field label="Reference"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Currency" hint="Blank = base"><Input disabled={!!doc} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase().slice(0, 3) })} /></Field>
        {f.currency && !doc && <Field label="Exchange rate"><Input inputMode="decimal" value={f.exchangeRate} onChange={(e) => setF({ ...f, exchangeRate: e.target.value })} /></Field>}
        <Field label="Warehouse"><Select value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">Default</option>{warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        <Field label="Project"><Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">None</option>{projects.data?.map((p: any) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</Select></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.pricesIncludeVat} onChange={(e) => setF({ ...f, pricesIncludeVat: e.target.checked })} /> Prices include VAT</label>
      </div></Card>
      <Card title="Lines" pad={false} actions={<Button size="sm" variant="secondary" onClick={() => setLines((l) => [...l, blank()])}>+ Add line</Button>}>
        <div className="overflow-x-auto"><table className="min-w-full text-sm">
          <thead><tr className="border-b text-xs uppercase text-slate-500"><th className="px-2 py-2 text-left">Product</th><th className="px-2 py-2 text-left">Description</th><th className="w-20 px-2 py-2 text-right">Qty</th><th className="w-28 px-2 py-2 text-right">Unit price</th><th className="w-16 px-2 py-2 text-right">Disc %</th><th className="w-24 px-2 py-2">Tax</th>{!isSales && <th className="px-2 py-2 text-left">Ledger</th>}<th className="w-24 px-2 py-2 text-right">Net</th><th className="w-24 px-2 py-2 text-right">VAT</th><th className="w-24 px-2 py-2 text-right">Total</th><th className="w-6" /></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={i} className="border-b border-slate-50 align-top">
              <td className="min-w-[11rem] px-2 py-1.5"><Combobox value={l.productId} initialLabel={l.productLabel} endpoint="/inventory/products?active=true" map={(p) => ({ value: p.id, label: `${p.sku} ${p.name}`, hint: `stock ${p.onHand}` })} placeholder="Optional" onChange={async (v, o) => { const p = (await api.get(`/inventory/products/${v}`)).data; set(i, { productId: v, productLabel: o?.label, description: l.description || p.name, unitPrice: l.unitPrice || String(Number(isSales ? p.salePrice : p.purchasePrice)), taxCode: p.taxCode ?? 'STD' }); }} /></td>
              <td className="min-w-[12rem] px-2 py-1.5"><Input value={l.description} onChange={(e) => set(i, { description: e.target.value })} />{(l.productId) && <Input className="mt-1 text-xs" placeholder="Batch no. / serial nos. (if tracked)" value={l.batchNo ?? l.serial ?? ''} onChange={(e) => set(i, e.target.value.includes(',') || e.target.value.includes(' ') ? { serial: e.target.value, batchNo: undefined } : { batchNo: e.target.value, serial: e.target.value })} />}</td>
              <td className="px-2 py-1.5"><Input className="num text-right" inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></td>
              <td className="px-2 py-1.5"><Input className="num text-right" inputMode="decimal" value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} /></td>
              <td className="px-2 py-1.5"><Input className="num text-right" inputMode="decimal" value={l.discountPct} onChange={(e) => set(i, { discountPct: e.target.value })} /></td>
              <td className="px-2 py-1.5"><Select value={l.taxCode} onChange={(e) => set(i, { taxCode: e.target.value })}>{codes.map((c) => <option key={c}>{c}</option>)}</Select></td>
              {!isSales && <td className="min-w-[10rem] px-2 py-1.5"><Combobox value={l.accountId} initialLabel={l.accountLabel} endpoint="/chart-of-accounts/accounts?active=true" map={accountOption} placeholder="Default" onChange={(v, o) => set(i, { accountId: v, accountLabel: o?.label })} /></td>}
              <td className="num px-2 py-3 text-right">{money(est[i].net)}</td><td className="num px-2 py-3 text-right">{money(est[i].vat)}</td><td className="num px-2 py-3 text-right font-medium">{money(est[i].gross)}</td>
              <td className="px-1 py-3"><button aria-label="Remove line" className="text-slate-400 hover:text-red-600" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, k) => k !== i) : ls))}>✕</button></td>
            </tr>))}</tbody>
          <tfoot><tr className="border-t-2"><td colSpan={isSales ? 6 : 7} className="px-2 py-2 text-right text-xs text-slate-500">Estimated totals (final amounts are calculated by the server)</td><td className="num px-2 py-2 text-right font-semibold">{money(net)}</td><td className="num px-2 py-2 text-right font-semibold">{money(vat)}</td><td className="num px-2 py-2 text-right text-base font-bold">{money(total)}</td><td /></tr></tfoot>
        </table></div>
      </Card>
      <Card><Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></Card>
      <div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => save(false)}>Save as draft</Button>{postable && <Button disabled={busy} onClick={() => save(true)}>Save &amp; post</Button>}</div>
    </div>
  );
}
