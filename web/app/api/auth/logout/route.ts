import { NextRequest, NextResponse } from 'next/server';
import { API_URL, REFRESH_COOKIE, clearSession } from '@/lib/server';

export async function POST(req: NextRequest) {
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  if (refresh) await fetch(`${API_URL}/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: refresh }) }).catch(() => null);
  const res = NextResponse.json({ success: true, data: { loggedOut: true } });
  clearSession(res);
  return res;
}
