'use client';
import React from 'react';
import { Meta } from '@/lib/api';
import { Button, Spinner, cx } from './ui';

export interface Column<T = any> { key: string; label: string; align?: 'left' | 'right'; render?: (row: T) => React.ReactNode; className?: string }

export function DataTable<T = any>({ columns, rows, loading, empty = 'No records found', onRowClick, meta, onPage, rowKey, rowClass }: {
  columns: Column<T>[]; rows?: T[]; loading?: boolean; empty?: string; onRowClick?: (r: T) => void; meta?: Meta; onPage?: (p: number) => void; rowKey?: (r: T, i: number) => string; rowClass?: (r: T) => string | undefined;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>{columns.map((c) => <th key={c.key} scope="col" className={cx('whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500', c.align === 'right' ? 'text-right' : 'text-left')}>{c.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows?.map((r, i) => (
              <tr key={rowKey ? rowKey(r, i) : (r as any)?.id ?? i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx(onRowClick && 'cursor-pointer hover:bg-brand-50/40', rowClass?.(r))}>
                {columns.map((c) => <td key={c.key} className={cx('px-3 py-2', c.align === 'right' && 'num text-right', c.className)}>{c.render ? c.render(r) : String((r as any)[c.key] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <Spinner />}
        {!loading && rows && rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">{empty}</div>}
      </div>
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
          <span>{meta.total} records · page {meta.page} of {meta.totalPages}</span>
          <div className="flex gap-1"><Button size="sm" variant="secondary" disabled={meta.page <= 1} onClick={() => onPage?.(meta.page - 1)}>Previous</Button><Button size="sm" variant="secondary" disabled={meta.page >= meta.totalPages} onClick={() => onPage?.(meta.page + 1)}>Next</Button></div>
        </div>
      )}
    </div>
  );
}
