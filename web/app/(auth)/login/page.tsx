'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Alert, Button, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [v, setV] = useState({ companyCode: '', email: '', password: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) { setErr(j?.error?.message ?? 'Sign in failed'); setBusy(false); return; }
    router.push('/'); router.refresh();
  }
  return (
    <AuthCard title="Sign in" subtitle="Each company has its own login." footer={<>New company? <Link className="text-brand-700 hover:underline" href="/register">Register</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {err && <Alert>{err}</Alert>}
        <Field label="Company code"><Input autoFocus required value={v.companyCode} onChange={(e) => setV({ ...v, companyCode: e.target.value.toUpperCase() })} placeholder="e.g. ACME" autoComplete="organization" /></Field>
        <Field label="Email"><Input type="email" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} autoComplete="username" /></Field>
        <Field label="Password"><Input type="password" required value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete="current-password" /></Field>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
        <div className="text-center text-sm"><Link href="/forgot-password" className="text-slate-500 hover:underline">Forgot password?</Link></div>
      </form>
    </AuthCard>
  );
}
