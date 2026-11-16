'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/hooks/useApi';
import { ApiError, api, qs } from '@/lib/api';
import { money, today } from '@/lib/format';
import { Combobox, accountOption } from './Combobox';
import { Alert, Button, Card, Field, Input, Select, Spinner, cx } from './ui';
import { useSession } from './Session';

interface Col { key: string; label: string; align?: string; type?: string }
interface Report { name: string; title: string; subtitle?: string; columns: Col[]; rows: any[]; summary?: Array<{ label: string; value: string }>; paging?: { page: number; totalPages: number; total: number } }

const DRILL: Record<string, (id: string) => string> = { ledger: (id) => `/accounting/ledgers/${id}`, voucher: (id) => `/accounting/vouchers/${id}`, entry: (id) => `/accounting/entries/${id}` };
const VTYPES = ['PAYMENT', 'RECEIPT', 'CONTRA', 'JOURNAL', 'SALES', 'PURCHASE', 'CREDIT_NOTE', 'DEBIT_NOTE'];

export function ReportViewer({ name, initial }: { name: string; initial?: Record<string, string> }) {
  const { can } = useSession();
  const catalog = useApi<Array<{ name: string; title: string; params: string[] }>>('/reports/catalog');
  const fys = useApi<any[]>('/accounting/financial-years');
  const branches = useApi<any[]>('/branches');
  const meta = catalog.data?.find((r) => r.name === name);
  const params = meta?.params ?? [];
  const [f, setF] = useState<Record<string, string>>({ asOf: today(), ...initial });
  const [applied, setApplied] = useState<Record<string, string>>({ asOf: today(), ...initial });
  const [page, setPage] = useState(1);
  const path = meta ? `/reports/run/${name}${qs({ ...applied, page })}` : null;
  const { data, loading, error } = useApi<Report>(path);
  useEffect(() => { setPage(1); }, [applied]);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const exportUrl = (format: string) => `/api/v1/reports/run/${name}${qs({ ...applied, format })}`;

  const has = (p: string) => params.includes(p);
  return (
    <div className="space-y-4">
      {meta && (
        <Card pad>
          <form className="grid grid-cols-2 items-end gap-3 md:grid-cols-4 lg:grid-cols-6" onSubmit={(e) => { e.preventDefault(); setApplied({ ...f }); }}>
            {has('financialYearId') && <Field label="Financial year"><Select value={f.financialYearId ?? ''} onChange={(e) => set('financialYearId', e.target.value)}><option value="">Any</option>{fys.data?.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</Select></Field>}
            {has('from') && <Field label="From"><Input type="date" value={f.from ?? ''} onChange={(e) => set('from', e.target.value)} /></Field>}
            {has('to') && <Field label="To"><Input type="date" value={f.to ?? ''} onChange={(e) => set('to', e.target.value)} /></Field>}
            {has('asOf') && <Field label="As of"><Input type="date" value={f.asOf ?? ''} onChange={(e) => set('asOf', e.target.value)} /></Field>}
            {has('branchId') && <Field label="Branch"><Select value={f.branchId ?? ''} onChange={(e) => set('branchId', e.target.value)}><option value="">All branches</option>{branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>}
            {has('accountId') && <Field label="Ledger"><Combobox value={f.accountId} endpoint="/chart-of-accounts/accounts" map={accountOption} onChange={(v) => set('accountId', v)} placeholder="All ledgers" /></Field>}
            {has('voucherType') && <Field label="Voucher type"><Select value={f.voucherType ?? ''} onChange={(e) => set('voucherType', e.target.value)}><option value="">All</option>{VTYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</Select></Field>}
            {has('period') && <Field label="Period"><Input placeholder="YYYY-MM" value={f.period ?? ''} onChange={(e) => set('period', e.target.value)} /></Field>}
            {has('year') && <Field label="Year"><Input placeholder="2026" value={f.year ?? ''} onChange={(e) => set('year', e.target.value)} /></Field>}
            {has('search') && <Field label="Search"><Input value={f.search ?? ''} onChange={(e) => set('search', e.target.value)} /></Field>}
            {has('hideZero') && <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={f.hideZero === 'true'} onChange={(e) => set('hideZero', e.target.checked ? 'true' : '')} /> Hide zero rows</label>}
            <Button type="submit">Run report</Button>
          </form>
        </Card>
      )}
      <Card pad={false} title={data?.title ?? meta?.title ?? 'Report'}
        actions={data && <>
          {can('report', 'export') && <><a className="text-sm text-brand-700 hover:underline" href={exportUrl('xlsx')}>Excel</a><a className="text-sm text-brand-700 hover:underline" href={exportUrl('pdf')}>PDF</a><a className="text-sm text-brand-700 hover:underline" href={exportUrl('csv')}>CSV</a></>}
          {can('report', 'print') && <a className="text-sm text-brand-700 hover:underline" href={exportUrl('html')} target="_blank" rel="noreferrer">Print</a>}
        </>}>
        {data?.subtitle && <p className="px-4 pt-3 text-xs text-slate-500">{data.subtitle}</p>}
        {error && <div className="p-4"><Alert>{error}</Alert></div>}
        {loading && <Spinner />}
        {data && !loading && (
          <div className="overflow-x-auto p-2">
            <table className="min-w-full text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">{data.columns.map((c) => <th key={c.key} className={cx('px-3 py-2', c.align === 'right' ? 'text-right' : 'text-left')}>{c.label}</th>)}</tr></thead>
              <tbody>
                {data.rows.map((r, i) => {
                  const bold = r._kind && r._kind !== 'row';
                  const drill = r._drill ? DRILL[r._drill.type]?.(r._drill.id) : undefined;
                  return (
                    <tr key={i} className={cx('border-b border-slate-50', bold && 'bg-slate-50 font-semibold', r._kind === 'total' && 'border-t-2 border-slate-300')}>
                      {data.columns.map((c, ci) => {
                        const raw = r[c.key]; const text = c.type === 'money' && raw !== undefined && raw !== '' ? money(raw) : String(raw ?? '');
                        return <td key={c.key} className={cx('px-3 py-1.5', c.align === 'right' && 'num text-right')}>{drill && ci === (c.key === 'date' ? 1 : data.columns.findIndex((x) => ['name', 'particulars', 'voucher', 'account'].includes(x.key))) ? <Link className="text-brand-700 hover:underline" href={drill}>{text}</Link> : text}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.rows.length === 0 && <div className="py-8 text-center text-sm text-slate-400">No data for the selected filters</div>}
          </div>
        )}
        {data?.summary && data.summary.length > 0 && <div className="flex flex-wrap gap-x-8 gap-y-1 border-t border-slate-100 px-4 py-3 text-sm">{data.summary.map((s) => <div key={s.label}><span className="text-slate-500">{s.label}: </span><span className="num font-semibold">{/^-?\d+\.\d+$/.test(s.value) ? money(s.value) : s.value}</span></div>)}</div>}
        {data?.paging && data.paging.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-500"><span>{data.paging.total} rows · page {data.paging.page}/{data.paging.totalPages}</span>
            <div className="flex gap-1"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="secondary" disabled={page >= data.paging.totalPages} onClick={() => setPage(page + 1)}>Next</Button></div></div>
        )}
      </Card>
    </div>
  );
}
