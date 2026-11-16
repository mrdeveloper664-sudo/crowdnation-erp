import { NextResponse } from 'next/server';

export const API_URL = process.env.API_URL ?? 'http://localhost:4000/api/v1';
export const ACCESS_COOKIE = 'nx_access';
export const REFRESH_COOKIE = 'nx_refresh';
// Secure cookies in production; set COOKIE_SECURE=false for plain-http local runs of the production build
const secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';

export function setSession(res: NextResponse, tokens: { accessToken: string; refreshToken: string }) {
  const base = { httpOnly: true, sameSite: 'lax' as const, secure, path: '/' };
  res.cookies.set(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: 60 * 60 * 24 * 7 });
  res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, { ...base, maxAge: 60 * 60 * 24 * 30 });
}

export function clearSession(res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, '', { path: '/', maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, '', { path: '/', maxAge: 0 });
}
