import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE, clearSession, setSession } from '@/lib/server';

/** Authenticated proxy: attaches the bearer token from the httpOnly cookie and transparently refreshes it once on 401. */
async function forward(req: NextRequest, path: string[], access: string | undefined, body: ArrayBuffer | undefined) {
  const url = `${API_URL}/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers = new Headers();
  const ct = req.headers.get('content-type'); if (ct) headers.set('content-type', ct);
  if (access) headers.set('authorization', `Bearer ${access}`);
  headers.set('x-forwarded-for', req.headers.get('x-forwarded-for') ?? '');
  return fetch(url, { method: req.method, headers, body, redirect: 'manual' });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();
  let access = req.cookies.get(ACCESS_COOKIE)?.value;
  let upstream = await forward(req, path, access, body);
  let refreshed: { accessToken: string; refreshToken: string } | null = null;

  if (upstream.status === 401) {
    const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
    if (refresh) {
      const r = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: refresh }) });
      if (r.ok) {
        refreshed = (await r.json()).data;
        access = refreshed!.accessToken;
        upstream = await forward(req, path, access, body);
      }
    }
  }
  const out = new Headers();
  for (const h of ['content-type', 'content-disposition', 'cache-control', 'x-content-type-options']) { const v = upstream.headers.get(h); if (v) out.set(h, v); }
  const res = new NextResponse(upstream.body, { status: upstream.status, headers: out });
  if (refreshed) setSession(res, refreshed);
  else if (upstream.status === 401) clearSession(res);
  return res;
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
