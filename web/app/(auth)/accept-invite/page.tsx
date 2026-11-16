'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';

function Inner() {
  const sp = useSearchParams(); const [v, setV] = useState({ token: sp.get('token') ?? '', name: '', password: '' }); const [ok, setOk] = useState(false); const [err, setErr] = useState('');
  async function submit(e: React.FormEvent) { e.preventDefault(); setErr(''); try { await api.pub('/accept-invite', v); setOk(true); } catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); } }
  return (
    <AuthCard title="Accept your invitation" footer={<Link className="text-brand-700 hover:underline" href="/login">Go to sign in</Link>}>
      {ok ? <Alert kind="success">Account created. Sign in with your company code and email.</Alert> : (
        <form onSubmit={submit} className="space-y-4">{err && <Alert>{err}</Alert>}
          <Field label="Invitation token"><Input required value={v.token} onChange={(e) => setV({ ...v, token: e.target.value })} /></Field>
          <Field label="Your name"><Input required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label="Password" hint="10+ characters with upper case, lower case and a digit"><Input type="password" required minLength={10} value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete="new-password" /></Field>
          <Button type="submit" className="w-full">Join company</Button></form>)}
    </AuthCard>
  );
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
