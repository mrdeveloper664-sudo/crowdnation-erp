'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';

export default function RegisterPage() {
  const [v, setV] = useState({ companyName: '', companyCode: '', trn: '', adminName: '', adminEmail: '', password: '' });
  const [err, setErr] = useState(''); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.pub('/register-company', { ...v, trn: v.trn || undefined }); setDone(true); } catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); } finally { setBusy(false); }
  }
  if (done) return <AuthCard title="Company created" subtitle="Check your email to verify your address, then sign in." footer={<Link className="text-brand-700 hover:underline" href="/login">Go to sign in</Link>}><Alert kind="success">Your company <b>{v.companyCode.toUpperCase()}</b> is ready. Use this code when signing in.</Alert></AuthCard>;
  return (
    <AuthCard title="Register your company" subtitle="Creates an isolated company workspace with a default chart of accounts and a financial year." footer={<>Already registered? <Link className="text-brand-700 hover:underline" href="/login">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        <Field label="Company name" required><Input required value={v.companyName} onChange={(e) => set('companyName', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Company code" required hint="3-32 letters/digits"><Input required value={v.companyCode} onChange={(e) => set('companyCode', e.target.value.toUpperCase())} /></Field><Field label="VAT TRN"><Input value={v.trn} onChange={(e) => set('trn', e.target.value)} /></Field></div>
        <Field label="Your name" required><Input required value={v.adminName} onChange={(e) => set('adminName', e.target.value)} /></Field>
        <Field label="Email" required><Input type="email" required value={v.adminEmail} onChange={(e) => set('adminEmail', e.target.value)} /></Field>
        <Field label="Password" required hint="10+ characters with upper case, lower case and a digit"><Input type="password" required minLength={10} value={v.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" /></Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Creating…' : 'Create company'}</Button>
      </form>
    </AuthCard>
  );
}
