'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';

export default function ForgotPage() {
  const [v, setV] = useState({ companyCode: '', email: '' }); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  async function submit(e: React.FormEvent) { e.preventDefault(); setErr(''); try { const r = await api.pub('/forgot-password', v); setMsg(r.data.message); } catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); } }
  return (
    <AuthCard title="Reset your password" footer={<Link className="text-brand-700 hover:underline" href="/login">Back to sign in</Link>}>
      <form onSubmit={submit} className="space-y-4">
        {err && <Alert>{err}</Alert>}{msg && <Alert kind="success">{msg}</Alert>}
        <Field label="Company code"><Input required value={v.companyCode} onChange={(e) => setV({ ...v, companyCode: e.target.value.toUpperCase() })} /></Field>
        <Field label="Email"><Input type="email" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Button type="submit" className="w-full">Send reset link</Button>
      </form>
    </AuthCard>
  );
}
