import React from 'react';

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-100 to-brand-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2"><span className="grid h-9 w-9 place-items-center rounded bg-brand-600 font-bold text-white">N</span><span className="text-2xl font-semibold tracking-tight">NEXERP</span></div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><h1 className="text-lg font-semibold">{title}</h1>{subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}<div className="mt-5">{children}</div></div>
        {footer && <div className="mt-4 text-center text-sm text-slate-500">{footer}</div>}
      </div>
    </div>
  );
}
