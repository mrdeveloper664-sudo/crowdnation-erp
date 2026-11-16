'use client';
import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { ApiError, api } from '@/lib/api';
import { money, sumMoney } from '@/lib/format';
import { Combobox, accountOption } from '@/components/Combobox';
import { Alert, Button, Card, ConfirmDialog, Input, PageHeader, Select } from '@/components/ui';

interface Row { accountId: string; label: string; debit: string; credit: string }

export default function OpeningBalances() {
  const fys = useApi<any[]>('/accounting/financial-years');
  const [fy, setFy] = useState('');
  useEffect(() => { if (!fy && fys.data?.length) setFy(fys.data[0].id); }, [fys.data, fy]);
  const ob = useApi<any>(fy ? `/ledgers/opening-balances?financialYearId=${fy}` : null);
  const [rows, setRows] = useState<Row[]>([]); const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (ob.data) setRows(ob.data.items.map((i: any) => ({ accountId: i.accountId, label: `${i.account.code} ${i.account.name}`, debit: i.debit === '0' || i.debit === '0.0000' ? '' : String(Number(i.debit)), credit: i.credit === '0' || i.credit === '0.0000' ? '' : String(Number(i.credit)) }))); }, [ob.data]);
  const dr = sumMoney(rows.map((r) => r.debit)), cr = sumMoney(rows.map((r) => r.credit)); const posted = ob.data?.posted;
  const set = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  async function save() { setErr(''); setMsg(''); try { await api.put('/ledgers/opening-balances', { financialYearId: fy, items: rows.filter((r) => r.accountId).map((r) => ({ accountId: r.accountId, debit: r.debit || '0', credit: r.credit || '0' })) }); setMsg('Saved'); ob.reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } }
  async function post() { setConfirm(false); setErr(''); try { const r = await api.post('/ledgers/opening-balances/post', { financialYearId: fy }); setMsg(`Posted as ${r.data.entryNumber}${r.data.difference !== '0.00' ? ` — difference ${money(r.data.difference)} parked in Opening Balance Difference` : ''}`); ob.reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } }
  return (
    <div>
      <PageHeader title="Opening Balances" subtitle="Enter balances brought forward, then post them as one balanced journal." actions={<Select value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year">{fys.data?.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</Select>} />
      {err && <Alert>{err}</Alert>}{msg && <Alert kind="success">{msg}</Alert>}{posted && <Alert kind="info">Opening balances are posted and locked. Correct them with a journal voucher.</Alert>}
      <Card pad={false} className="mt-3" actions={!posted && <Button size="sm" variant="secondary" onClick={() => setRows((r) => [...r, { accountId: '', label: '', debit: '', credit: '' }])}>+ Add ledger</Button>}>
        <table className="min-w-full text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="px-3 py-2 text-left">Ledger</th><th className="w-40 px-3 py-2 text-right">Debit</th><th className="w-40 px-3 py-2 text-right">Credit</th><th className="w-8" /></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-slate-50"><td className="px-3 py-1.5"><Combobox disabled={posted} value={r.accountId} initialLabel={r.label} endpoint="/chart-of-accounts/accounts?active=true" map={accountOption} onChange={(v) => set(i, { accountId: v })} /></td>
            <td className="px-3 py-1.5"><Input disabled={posted} className="num text-right" inputMode="decimal" value={r.debit} onChange={(e) => set(i, { debit: e.target.value, credit: '' })} /></td><td className="px-3 py-1.5"><Input disabled={posted} className="num text-right" inputMode="decimal" value={r.credit} onChange={(e) => set(i, { credit: e.target.value, debit: '' })} /></td>
            <td>{!posted && <button className="text-slate-400 hover:text-red-600" aria-label="Remove" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>✕</button>}</td></tr>)}</tbody>
          <tfoot><tr className="font-semibold"><td className="px-3 py-2 text-right">Totals</td><td className="num px-3 py-2 text-right">{money(dr)}</td><td className="num px-3 py-2 text-right">{money(cr)}</td><td /></tr><tr><td className="px-3 pb-2 text-right text-xs text-slate-500">Difference</td><td colSpan={2} className={`num px-3 pb-2 text-right ${dr === cr ? 'text-emerald-600' : 'text-amber-700'}`}>{dr === cr ? 'Balanced ✓' : money(sumMoney([dr, '-' + cr]))}</td><td /></tr></tfoot></table>
      </Card>
      {!posted && <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={save}>Save</Button><Button onClick={() => setConfirm(true)} disabled={!rows.length}>Post opening balances</Button></div>}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Post opening balances?" message={dr === cr ? 'This creates one balanced journal entry dated the first day of the year.' : `Debits and credits differ by ${money(sumMoney([dr, '-' + cr]))}. The difference will be posted to "Opening Balance Difference".`} confirmLabel="Post" onConfirm={async () => { await save(); await post(); }} />
    </div>
  );
}
