'use client';
import React, { createContext, useContext, useMemo } from 'react';
import { useApi } from '@/hooks/useApi';
import { Spinner } from './ui';

export interface Me { id: string; name: string; email: string; roles: Array<{ id: string; name: string }>; permissions: string[]; company: { id: string; code: string; name: string; baseCurrency: string; trn: string | null } }
interface Ctx { me: Me; can: (resource: string, action?: string) => boolean; reload: () => void }
const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { data, error, loading, reload } = useApi<Me>('/auth/me');
  const value = useMemo<Ctx | null>(() => {
    if (!data) return null;
    const set = new Set(data.permissions);
    return { me: data, reload, can: (r, a = 'view') => set.has(`${r}:${a}`) };
  }, [data, reload]);
  if (loading && !data) return <Spinner />;
  if (error || !value) return <div className="p-10 text-center text-sm text-red-600">Could not load your session. <a className="underline" href="/login">Sign in again</a></div>;
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
}

/** Hides children unless the user holds resource:action. */
export function Can({ resource, action = 'view', children }: { resource: string; action?: string; children: React.ReactNode }) {
  return useSession().can(resource, action) ? <>{children}</> : null;
}
