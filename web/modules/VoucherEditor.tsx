'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { ApiError, api } from '@/lib/api';
import { money, sumMoney, today } from '@/lib/format';
import { Combobox, Option, accountOption } from '@/components/Combobox';
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui';

export const VOUCHER_TYPES = ['PAYMENT', 'RECEIPT', 'CONTRA', 'JOURNAL', 'SALES', 'PURCHASE', 'CREDIT_NOTE', 'DEBIT_NOTE'];
interface Line { accountId: string; accountLabel?: string; accountType?: string; description: string; debit: string; credit: string; taxRateId?: string; taxableAmount?: string }
const blank = (): Line => ({ accountId: '', description: '', debit: '', credit: '' });
const MONEY = /^\d{1,15}(\.\d{1,4})?$/;

const HINT: Record<string, string> = {
  PAYMENT: 'Debit the payee / expense ledgers, credit the cash or bank ledger paying out.', RECEIPT: 'Debit the cash or bank ledger receiving, credit the payer / income ledgers.',
  CONTRA: 'Transfers between cash and bank ledgers only.', JOURNAL: 'Any ledgers; total debit must equal total credit.',
  SALES: 'Debit the customer, credit sales and VAT output.', PURCHASE: 'Debit purchases / expense and VAT input, credit the supplier.', CREDIT_NOTE: 'Reverses a sale: debit sales and VAT output, credit the customer.', DEBIT_NOTE: 'Reverses a purchase: debit the supplier, credit purchases and VAT input.',
};

export function VoucherEditor({ voucher, onSaved, defaultType }: { voucher?: any; onSaved: (id: string, posted: boolean) => void; defaultType?: string }) {
  const taxRates = useApi<any[]>('/vat/rates');
  const [type, setType] = useState(voucher?.type ?? defaultType ?? 'JOURNAL');
  const [date, setDate] = useState(voucher?.voucherDate ?? today());
  const [reference, setReference] = useState(voucher?.reference ?? ''); const [narration, setNarration] = useState(voucher?.narration ?? '');
  const [currency, setCurrency] = useState(voucher?.currency ?? ''); const [rate, setRate] = useState('');
  const [lines, setLines] = useState<Line[]>(() => voucher?.lines?.map((l: any) => ({ accountId: l.accountId, accountLabel: l.account ? `${l.account.code}  ${l.account.name}` : '', accountType: undefined, description: l.description ?? '', debit: l.debit === '0.00' ? '' : l.debit, credit: l.credit === '0.00' ? '' : l.credit, taxRateId: l.taxRateId ?? undefined, taxableAmount: l.taxableAmount ?? undefined })) ?? [blank(), blank()]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const base = voucher?.company?.baseCurrency;
  useEffect(() => { if (voucher) setCurrency(voucher.currency); }, [voucher]);

  const totalDr = useMemo(() => sumMoney(lines.map((l) => l.debit)), [lines]);
  const totalCr = useMemo(() => sumMoney(lines.map((l) => l.credit)), [lines]);
  const diff = sumMoney([totalDr, '-' + totalCr]);
  const balanced = totalDr === totalCr && Number(totalDr) > 0;
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const lineErrors = lines.map((l) => (!l.accountId && (l.debit || l.credit) ? 'Select an account' : (l.debit && !MONEY.test(l.debit)) || (l.credit && !MONEY.test(l.credit)) ? 'Invalid amount' : l.debit && l.credit ? 'Debit or credit, not both' : ''));
  const usable = lines.filter((l) => l.accountId && (l.debit || l.credit || l.taxRateId));

  async function save(post: boolean) {
    setErr('');
    if (lineErrors.some(Boolean)) { setErr('Fix the highlighted lines'); return; }
    if (usable.length < 2) { setErr('At least two lines are required'); return; }
    if (!balanced) { setErr(`Voucher is out of balance by ${money(diff)}`); return; }
    setBusy(true);
    const payload: any = { date, reference: reference || undefined, narration: narration || undefined, lines: usable.map((l) => ({ accountId: l.accountId, description: l.description || undefined, debit: l.debit || undefined, credit: l.credit || undefined, taxRateId: l.taxRateId || undefined, taxableAmount: l.taxRateId ? l.taxableAmount : undefined })) };
    if (currency && currency !== base) { payload.currency = currency; if (rate) payload.exchangeRate = rate; }
    try {
      const saved = voucher ? await api.put(`/vouchers/${voucher.id}`, payload) : await api.post('/vouchers', { type, ...payload });
      const id = saved.data.id;
      if (post) await api.post(`/vouchers/${id}/post`);
      onSaved(id, post);
    } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {err && <Alert>{err}</Alert>}
      <Card>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Voucher type"><Select value={type} disabled={!!voucher} onChange={(e) => setType(e.target.value)}>{VOUCHER_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</Select></Field>
          <Field label="Date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / invoice no." /></Field>
          <Field label="Currency" hint="Leave blank for base currency"><Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} placeholder="AED" /></Field>
          {currency && currency !== base && <Field label="Exchange rate" hint="Blank = latest saved rate"><Input value={rate} inputMode="decimal" onChange={(e) => setRate(e.target.value)} /></Field>}
          <div className="col-span-2 md:col-span-4"><Field label="Narration"><Textarea rows={2} value={narration} onChange={(e) => setNarration(e.target.value)} /></Field></div>
        </div>
        <p className="mt-2 text-xs text-slate-500">{HINT[type]}</p>
      </Card>
      <Card title="Entries" pad={false} actions={<Button size="sm" variant="secondary" onClick={() => setLines((l) => [...l, blank()])}>+ Add line</Button>}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><th className="w-8 px-2 py-2">#</th><th className="min-w-[16rem] px-2 py-2 text-left">Account</th><th className="px-2 py-2 text-left">Description</th><th className="w-36 px-2 py-2 text-right">Debit</th><th className="w-36 px-2 py-2 text-right">Credit</th><th className="w-8" /></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const vatLine = l.accountType?.startsWith('VAT') || !!l.taxRateId;
                return (
                  <React.Fragment key={i}>
                    <tr className="border-b border-slate-50 align-top">
                      <td className="px-2 py-2 text-center text-slate-400">{i + 1}</td>
                      <td className="px-2 py-1.5"><Combobox value={l.accountId} initialLabel={l.accountLabel} endpoint="/chart-of-accounts/accounts?active=true" map={accountOption} onChange={(v, o) => set(i, { accountId: v, accountLabel: o?.label, accountType: o?.hint })} placeholder="Search account…" />{lineErrors[i] && <div className="mt-0.5 text-xs text-red-600">{lineErrors[i]}</div>}</td>
                      <td className="px-2 py-1.5"><Input value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                      <td className="px-2 py-1.5"><Input className="num text-right" inputMode="decimal" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></td>
                      <td className="px-2 py-1.5"><Input className="num text-right" inputMode="decimal" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></td>
                      <td className="px-1 py-2 text-center"><button aria-label="Remove line" className="text-slate-400 hover:text-red-600" onClick={() => setLines((ls) => (ls.length > 2 ? ls.filter((_, k) => k !== i) : ls))}>✕</button></td>
                    </tr>
                    {vatLine && <tr className="border-b border-slate-50 bg-amber-50/40"><td /><td colSpan={5} className="px-2 py-1.5"><div className="flex flex-wrap items-center gap-3 text-xs"><span className="font-medium text-amber-800">VAT details</span>
                      <Select className="w-44" value={l.taxRateId ?? ''} onChange={(e) => set(i, { taxRateId: e.target.value })} aria-label="Tax code"><option value="">Tax code…</option>{taxRates.data?.filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.code} · {r.rate}% ({r.effectiveFrom})</option>)}</Select>
                      <Input className="num w-36 text-right" inputMode="decimal" placeholder="Taxable amount" value={l.taxableAmount ?? ''} onChange={(e) => set(i, { taxableAmount: e.target.value })} aria-label="Taxable amount" />
                      <span className="text-slate-500">Zero-rated / exempt: leave the amounts empty on this line.</span></div></td></tr>}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-semibold"><td /><td className="px-2 py-2 text-right" colSpan={2}>Total</td><td className="num px-2 py-2 text-right">{money(totalDr)}</td><td className="num px-2 py-2 text-right">{money(totalCr)}</td><td /></tr>
              <tr><td /><td colSpan={2} className="px-2 pb-2 text-right text-xs text-slate-500">Difference</td><td colSpan={2} className={`num px-2 pb-2 text-right text-sm font-semibold ${balanced ? 'text-emerald-600' : 'text-red-600'}`}>{balanced ? 'Balanced ✓' : money(diff)}</td><td /></tr>
            </tfoot>
          </table>
        </div>
      </Card>
      <div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => save(false)}>Save as draft</Button><Button disabled={busy || !balanced} onClick={() => save(true)}>Save &amp; post</Button></div>
    </div>
  );
}
