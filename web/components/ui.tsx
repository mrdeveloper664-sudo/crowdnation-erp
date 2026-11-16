'use client';
import React, { useEffect } from 'react';

export const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(' ');

export function Button({ variant = 'primary', size = 'md', className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' | 'md' }) {
  const v = { primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50', secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50', danger: 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50', ghost: 'text-slate-600 hover:bg-slate-100 disabled:opacity-50' }[variant];
  return <button {...p} className={cx('inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm', v, className)} />;
}

const inputCls = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100';
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) { return <input ref={ref} {...p} className={cx(inputCls, className)} />; });
export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select {...p} className={cx(inputCls, 'pr-8', className)}>{children}</select>; }
export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea rows={3} {...p} className={cx(inputCls, className)} />; }

export function Field({ label, error, hint, required, children }: { label: string; error?: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}{required && <span className="text-red-500"> *</span>}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('rounded-lg border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold text-slate-800">{title}</h2><div className="flex items-center gap-2">{actions}</div></header>}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

const tones: Record<string, string> = { green: 'bg-emerald-50 text-emerald-700 ring-emerald-200', red: 'bg-red-50 text-red-700 ring-red-200', amber: 'bg-amber-50 text-amber-800 ring-amber-200', blue: 'bg-blue-50 text-blue-700 ring-blue-200', slate: 'bg-slate-100 text-slate-700 ring-slate-200' };
const statusTone: Record<string, string> = { POSTED: 'green', APPROVED: 'green', PAID: 'green', ACTIVE: 'green', WON: 'green', REIMBURSED: 'green', DONE: 'green', OPEN: 'green', DRAFT: 'slate', PENDING: 'amber', PENDING_APPROVAL: 'amber', SUBMITTED: 'amber', CONFIRMED: 'blue', CONVERTED: 'blue', CANCELLED: 'red', REJECTED: 'red', LOST: 'red', LOCKED: 'red', DISPOSED: 'slate' };
export function Badge({ children, tone }: { children: React.ReactNode; tone?: keyof typeof tones }) {
  const key = typeof children === 'string' ? statusTone[children] : undefined;
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[(tone as string) ?? key ?? 'slate'])}>{typeof children === 'string' ? children.replace(/_/g, ' ') : children}</span>;
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  const c = { error: 'border-red-200 bg-red-50 text-red-800', success: 'border-emerald-200 bg-emerald-50 text-emerald-800', info: 'border-blue-200 bg-blue-50 text-blue-800' }[kind];
  return <div role={kind === 'error' ? 'alert' : 'status'} className={cx('rounded-md border px-3 py-2 text-sm', c)}>{children}</div>;
}

export function Spinner() { return <div className="flex justify-center py-10" aria-label="Loading"><div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" /></div>; }

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }) {
  useEffect(() => { if (!open) return; const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx('w-full rounded-lg bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3"><h3 className="text-base font-semibold">{title}</h3><button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100">✕</button></header>
        <div className="p-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose, busy }: { open: boolean; title: string; message: React.ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  return <Modal open={open} onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</Button></>}><div className="text-sm text-slate-600">{message}</div></Modal>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-xl font-semibold text-slate-900">{title}</h1>{subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}</div><div className="flex flex-wrap items-center gap-2">{actions}</div></div>;
}

export function Tabs({ tabs, value, onChange }: { tabs: Array<{ id: string; label: string }>; value: string; onChange: (id: string) => void }) {
  return <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">{tabs.map((t) => <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={cx('whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', value === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>{t.label}</button>)}</div>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'good' | 'bad' }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div><div className={cx('num mt-1 text-2xl font-semibold', tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-600' : 'text-slate-900')}>{value}</div>{sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}</div>;
}
