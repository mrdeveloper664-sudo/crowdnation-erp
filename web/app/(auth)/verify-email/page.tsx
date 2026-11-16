'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError, api } from '@/lib/api';

function Inner() {
  const sp = useSearchParams(); const [token, setToken] = useState(sp.get('token') ?? ''); const [ok, setOk] = useState(false); const [err, setErr] = useState('');
  async function submit(e: React.FormEvent) { e.preventDefault(); setErr(''); try { await api.pub('/verify-email', { token }); setOk(true); } catch (x) { setErr(x instanceof ApiError ? x.message : String(x)); } }
  return (
    <AuthCard title="Verify your email" footer={<Link className="text-brand-700 hover:underline" href="/login">Go to sign in</Link>}>
      {ok ? <Alert kind="success">Email verified.</Alert> : <form onSubmit={submit} className="space-y-4">{err && <Alert>{err}</Alert>}<Field label="Verification token"><Input required value={token} onChange={(e) => setToken(e.target.value)} /></Field><Button type="submit" className="w-full">Verify</Button></form>}
    </AuthCard>
  );
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
