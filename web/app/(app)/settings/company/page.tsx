'use client';
import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/components/Session';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '@/components/ui';

export default function CompanySettings() {
  const { can, reload } = useSession(); const co = useApi<any>('/company'); const st = useApi<any>(can('settings') ? '/company/settings' : null);
  const [c, setC] = useState<any>(null); const [s, setS] = useState<any>(null); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { if (co.data) setC(co.data); }, [co.data]); useEffect(() => { if (st.data) setS(st.data); }, [st.data]);
  if (!c) return <Spinner />;
  const save = async (fn: () => Promise<any>) => { setMsg(''); setErr(''); try { await fn(); setMsg('Saved'); reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } };
  const prefixes: Record<string, string> = s?.voucherPrefixes ?? {};
  return (
    <div className="max-w-4xl space-y-4"><PageHeader title="Company" subtitle={`Login code ${c.code} · base currency ${c.baseCurrency}`} />
      {err && <Alert>{err}</Alert>}{msg && <Alert kind="success">{msg}</Alert>}
      <Card title="Profile" actions={can('company', 'edit') && <Button size="sm" onClick={() => save(() => api.patch('/company', { name: c.name, legalName: c.legalName || undefined, trn: c.trn ?? '', address: c.address || undefined, phone: c.phone || undefined, logoUrl: c.logoUrl || undefined }))}>Save</Button>}>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Company name"><Input value={c.name ?? ''} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field><Field label="Legal name"><Input value={c.legalName ?? ''} onChange={(e) => setC({ ...c, legalName: e.target.value })} /></Field>
          <Field label="VAT registration number (TRN)"><Input value={c.trn ?? ''} onChange={(e) => setC({ ...c, trn: e.target.value })} /></Field><Field label="Phone"><Input value={c.phone ?? ''} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Address"><Textarea rows={2} value={c.address ?? ''} onChange={(e) => setC({ ...c, address: e.target.value })} /></Field></div><div className="sm:col-span-2"><Field label="Logo URL" hint="Shown on printed documents"><Input value={c.logoUrl ?? ''} onChange={(e) => setC({ ...c, logoUrl: e.target.value })} /></Field></div></div>
      </Card>
      {s && <Card title="Accounting preferences" actions={can('settings', 'edit') && <Button size="sm" onClick={() => save(() => api.patch('/company/settings', { requireVoucherApproval: s.requireVoucherApproval, allowSelfApproval: s.allowSelfApproval, allowBackdatedPosting: s.allowBackdatedPosting, amountDecimals: Number(s.amountDecimals), emirate: s.emirate, inventoryMethod: s.inventoryMethod, voucherPrefixes: s.voucherPrefixes }))}>Save</Button>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {[['requireVoucherApproval', 'Require approval before vouchers can be posted'], ['allowSelfApproval', 'Allow users to approve their own vouchers, expenses and payroll'], ['allowBackdatedPosting', 'Allow back-dated posting']].map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={!!s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />{l}</label>)}
          <Field label="Amount decimals"><Select value={s.amountDecimals} onChange={(e) => setS({ ...s, amountDecimals: e.target.value })}>{[0, 1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</Select></Field>
          <Field label="Emirate (VAT return)"><Select value={s.emirate} onChange={(e) => setS({ ...s, emirate: e.target.value })}>{['ABU_DHABI', 'DUBAI', 'SHARJAH', 'AJMAN', 'UMM_AL_QUWAIN', 'RAS_AL_KHAIMAH', 'FUJAIRAH'].map((n) => <option key={n} value={n}>{n.replace(/_/g, ' ')}</option>)}</Select></Field>
          <Field label="Inventory valuation"><Select value={s.inventoryMethod} onChange={(e) => setS({ ...s, inventoryMethod: e.target.value })}><option value="WAVG">Weighted average</option><option value="FIFO">FIFO</option></Select></Field>
          <div className="sm:col-span-2"><div className="mb-1 text-xs font-medium text-slate-600">Voucher number prefixes</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(prefixes).map(([t, p]) => <Field key={t} label={t.replace('_', ' ')}><Input value={p} maxLength={6} onChange={(e) => setS({ ...s, voucherPrefixes: { ...prefixes, [t]: e.target.value.toUpperCase() } })} /></Field>)}</div></div>
        </div></Card>}
    </div>
  );
}
