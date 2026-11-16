import { NextRequest, NextResponse } from 'next/server';
import { API_URL, setSession } from '@/lib/server';

// Tokens never reach browser JavaScript: they are stored in httpOnly cookies.
export async function POST(req: NextRequest) {
  const body = await req.text();
  const r = await fetch(`${API_URL}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': req.headers.get('user-agent') ?? '', 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' }, body });
  const json = await r.json().catch(() => ({ success: false, error: { message: 'Bad response from API' } }));
  if (!r.ok || !json.success) return NextResponse.json(json, { status: r.status });
  const res = NextResponse.json({ success: true, data: { user: json.data.user } });
  setSession(res, json.data);
  return res;
}
