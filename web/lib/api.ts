export interface Meta { page: number; pageSize: number; total: number; totalPages: number; [k: string]: any }
export interface ApiResult<T> { data: T; meta?: Meta }
export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown, publicRoute = false): Promise<ApiResult<T>> {
  const base = publicRoute ? '/api/public' : '/api/v1';
  const res = await fetch(`${base}${path}`, {
    method, credentials: 'same-origin', headers: body instanceof FormData ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (res.status === 401 && typeof window !== 'undefined' && !publicRoute && !location.pathname.startsWith('/login')) { location.href = '/login'; }
  if (!res.ok || !json?.success) {
    const err = json?.error;
    throw new ApiError(Array.isArray(err?.details) && err.details.length ? err.details.join('; ') : err?.message ?? `Request failed (${res.status})`, res.status, err?.details);
  }
  return { data: json.data as T, meta: json.meta };
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T = any>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  del: <T = any>(p: string) => request<T>('DELETE', p),
  upload: <T = any>(p: string, f: FormData) => request<T>('POST', p, f),
  pub: <T = any>(p: string, b: unknown) => request<T>('POST', p, b, true),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const t = s.toString();
  return t ? `?${t}` : '';
}
