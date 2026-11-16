'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, Meta, api } from '@/lib/api';

/** Minimal data-fetching hook: { data, meta, error, loading, reload }. `path` = null skips the request. */
export function useApi<T = any>(path: string | null) {
  const [state, setState] = useState<{ data?: T; meta?: Meta; error?: string; loading: boolean }>({ loading: !!path });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) { setState({ loading: false }); return; }
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    try { const r = await api.get<T>(path); if (id === seq.current) setState({ data: r.data, meta: r.meta, loading: false }); }
    catch (e) { if (id === seq.current) setState({ loading: false, error: e instanceof ApiError ? e.message : String(e) }); }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
