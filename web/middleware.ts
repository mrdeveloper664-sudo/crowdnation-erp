import { NextRequest, NextResponse } from 'next/server';

const PUBLIC = ['/login', '/register', '/forgot-password', '/reset-password', '/accept-invite', '/verify-email'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next') || pathname === '/favicon.ico') return NextResponse.next();
  const signedIn = req.cookies.has('nx_access') || req.cookies.has('nx_refresh');
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'));
  if (!signedIn && !isPublic) { const url = req.nextUrl.clone(); url.pathname = '/login'; return NextResponse.redirect(url); }
  if (signedIn && isPublic && pathname === '/login') { const url = req.nextUrl.clone(); url.pathname = '/'; return NextResponse.redirect(url); }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
