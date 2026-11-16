'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';

function Inner() {
  const sp = useSearchParams(); const [token, setToken] = useState(sp.get('token') ?? ''); const [pw, setPw] = useState(''); const [ok, setOk] = useState(false); const [err, setErr] = useState('');
  async function submit(e: React.FormEvent) { e.preventDefault(); setErr(''); try { await api.pub('/reset-password', { token, newPassword: pw }); setOk(true); } catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); } }
  return (
    <AuthCard title="Choose a new password" footer={<Link className="text-brand-700 hover:underline" href="/login">Back to sign in</Link>}>
      {ok ? <Alert kind="success">Password updated. You can now sign in.</Alert> : (
        <form onSubmit={submit} className="space-y-4">{err && <Alert>{err}</Alert>}
          <Field label="Reset token"><Input required value={token} onChange={(e) => setToken(e.target.value)} /></Field>
          <Field label="New password" hint="10+ characters with upper case, lower case and a digit"><Input type="password" required minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
          <Button type="submit" className="w-full">Reset password</Button></form>)}
    </AuthCard>
  );
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
