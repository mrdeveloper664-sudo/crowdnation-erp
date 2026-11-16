import { NextRequest, NextResponse } from 'next/server';
import { API_URL } from '@/lib/server';

const ALLOWED = new Set(['register-company', 'forgot-password', 'reset-password', 'verify-email', 'accept-invite']);

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path.length !== 1 || !ALLOWED.has(path[0])) return NextResponse.json({ success: false, error: { message: 'Not found' } }, { status: 404 });
  const r = await fetch(`${API_URL}/auth/${path[0]}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '' }, body: await req.text() });
  return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
}
