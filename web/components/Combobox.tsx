'use client';
import React, { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { cx } from './ui';

export interface Option { value: string; label: string; hint?: string }

/** Searchable dropdown. Either static `options`, or remote: `endpoint` (+ `searchParam`) returning an array or {data:[]}. */
export function Combobox({ value, onChange, options, endpoint, map, searchParam = 'search', placeholder = 'Select…', disabled, className, initialLabel }: {
  value?: string; onChange: (v: string, opt?: Option) => void; options?: Option[]; endpoint?: string; map?: (row: any) => Option; searchParam?: string; placeholder?: string; disabled?: boolean; className?: string; initialLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<Option[]>([]);
  const [label, setLabel] = useState(initialLabel ?? '');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  useEffect(() => {
    if (!endpoint || !open) return;
    const t = setTimeout(async () => {
      try { const sep = endpoint.includes('?') ? '&' : '?'; const r = await api.get<any[]>(`${endpoint}${sep}${searchParam}=${encodeURIComponent(q)}&pageSize=30`); setRemote((r.data ?? []).slice(0, 50).map((x) => (map ? map(x) : { value: x.id, label: x.name }))); } catch { setRemote([]); }
    }, 200);
    return () => clearTimeout(t);
  }, [endpoint, q, open, map, searchParam]);

  const list = (endpoint ? remote : (options ?? []).filter((o) => !q || (o.label + (o.hint ?? '')).toLowerCase().includes(q.toLowerCase()))).slice(0, 100);
  const selected = options?.find((o) => o.value === value)?.label ?? (value ? label : '');

  return (
    <div ref={box} className={cx('relative', className)}>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100" aria-haspopup="listbox" aria-expanded={open}>
        <span className={cx('truncate', !selected && 'text-slate-400')}>{selected || placeholder}</span><span className="ml-2 text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-[14rem] rounded-md border border-slate-200 bg-white shadow-lg">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full border-b border-slate-100 px-3 py-2 text-sm focus:outline-none" />
          <ul role="listbox" className="max-h-60 overflow-auto py-1">
            {list.map((o) => <li key={o.value} role="option" aria-selected={o.value === value} onClick={() => { setLabel(o.label); onChange(o.value, o); setOpen(false); setQ(''); }} className={cx('cursor-pointer px-3 py-1.5 text-sm hover:bg-brand-50', o.value === value && 'bg-brand-50 font-medium')}>{o.label}{o.hint && <span className="ml-2 text-xs text-slate-400">{o.hint}</span>}</li>)}
            {list.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export const accountOption = (a: any): Option => ({ value: a.id, label: `${a.code}  ${a.name}`, hint: a.type });
