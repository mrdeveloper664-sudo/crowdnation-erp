'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { ApiError, api } from '@/lib/api';
import { FormModal } from './Form';
import { SessionProvider, useSession } from './Session';
import { Alert, Button, Modal, cx } from './ui';

interface NavItem { label: string; href: string; resource?: string }
interface NavGroup { label: string; icon: string; href?: string; resource?: string; items?: NavItem[] }

const NAV: NavGroup[] = [
  { label: 'Dashboard', icon: '◧', href: '/' },
  { label: 'Accounting', icon: '⚖', items: [
    { label: 'Chart of Accounts', href: '/accounting/chart', resource: 'account' }, { label: 'Ledgers', href: '/accounting/ledgers', resource: 'ledger' },
    { label: 'Vouchers', href: '/accounting/vouchers', resource: 'voucher' }, { label: 'Opening Balances', href: '/accounting/opening-balances', resource: 'ledger' },
    { label: 'Periods & Currency', href: '/accounting/periods', resource: 'period' }, { label: 'VAT', href: '/accounting/vat', resource: 'vat' } ] },
  { label: 'Sales', icon: '↗', items: [
    { label: 'Customers', href: '/sales/customers', resource: 'customer' }, { label: 'Quotations', href: '/sales/documents?type=QUOTATION', resource: 'sales' }, { label: 'Sales Orders', href: '/sales/documents?type=ORDER', resource: 'sales' },
    { label: 'Invoices', href: '/sales/documents?type=INVOICE', resource: 'sales' }, { label: 'Credit Notes', href: '/sales/documents?type=CREDIT_NOTE', resource: 'sales' }, { label: 'Receipts', href: '/sales/receipts', resource: 'sales' }, { label: 'Recurring Invoices', href: '/sales/recurring', resource: 'sales' } ] },
  { label: 'Purchases', icon: '↙', items: [
    { label: 'Suppliers', href: '/purchases/suppliers', resource: 'supplier' }, { label: 'Purchase Requests', href: '/purchases/documents?type=REQUEST', resource: 'purchase' }, { label: 'Purchase Orders', href: '/purchases/documents?type=ORDER', resource: 'purchase' },
    { label: 'Goods Received', href: '/purchases/documents?type=GRN', resource: 'purchase' }, { label: 'Purchase Invoices', href: '/purchases/documents?type=INVOICE', resource: 'purchase' }, { label: 'Debit Notes', href: '/purchases/documents?type=DEBIT_NOTE', resource: 'purchase' }, { label: 'Payments', href: '/purchases/payments', resource: 'purchase' } ] },
  { label: 'Inventory', icon: '▣', items: [{ label: 'Products', href: '/inventory/products', resource: 'inventory' }, { label: 'Stock & Operations', href: '/inventory/stock', resource: 'inventory' }, { label: 'Warehouses', href: '/inventory/warehouses', resource: 'inventory' }] },
  { label: 'CRM', icon: '☏', items: [{ label: 'Leads & Pipeline', href: '/crm/leads', resource: 'crm' }, { label: 'Activities', href: '/crm/activities', resource: 'crm' }] },
  { label: 'HR', icon: '☺', items: [{ label: 'Employees', href: '/hr/employees', resource: 'hr' }, { label: 'Attendance', href: '/hr/attendance', resource: 'hr' }, { label: 'Leave', href: '/hr/leave', resource: 'hr' }, { label: 'Payroll', href: '/hr/payroll', resource: 'hr' }] },
  { label: 'Projects', icon: '☰', href: '/projects', resource: 'project' },
  { label: 'Expenses', icon: '$', href: '/expenses', resource: 'expense' },
  { label: 'Assets', icon: '⌂', href: '/assets', resource: 'asset' },
  { label: 'Reports', icon: '▤', href: '/reports', resource: 'report' },
  { label: 'Settings', icon: '⚙', items: [{ label: 'Company', href: '/settings/company', resource: 'company' }, { label: 'Users & Roles', href: '/settings/users', resource: 'user' }, { label: 'Branches', href: '/settings/branches', resource: 'branch' }, { label: 'Audit Log', href: '/settings/audit', resource: 'audit' }] },
];

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { can } = useSession();
  const path = usePathname();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const visible = NAV.map((g) => ({ ...g, items: g.items?.filter((i) => !i.resource || can(i.resource)) })).filter((g) => (g.items ? g.items.length > 0 : !g.resource || can(g.resource)));
  const active = (href: string) => (href === '/' ? path === '/' : path === href.split('?')[0] || path.startsWith(href.split('?')[0] + '/'));
  return (
    <aside className={cx('fixed inset-y-0 left-0 z-30 w-60 shrink-0 overflow-y-auto border-r border-slate-800 bg-slate-900 text-slate-300 transition-transform lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')} aria-label="Main navigation">
      <div className="flex h-14 items-center gap-2 px-4 text-white"><span className="grid h-7 w-7 place-items-center rounded bg-brand-500 text-sm font-bold">N</span><span className="text-lg font-semibold tracking-tight">NEXERP</span></div>
      <nav className="px-2 pb-6">
        {visible.map((g) => {
          const isOpen = expanded[g.label] ?? g.items?.some((i) => active(i.href));
          if (!g.items) return <Link key={g.label} href={g.href!} onClick={onNavigate} className={cx('mt-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm', active(g.href!) ? 'bg-brand-600 text-white' : 'hover:bg-slate-800')}><span className="w-4 text-center text-slate-400">{g.icon}</span>{g.label}</Link>;
          return (
            <div key={g.label} className="mt-0.5">
              <button onClick={() => setExpanded((e) => ({ ...e, [g.label]: !isOpen }))} aria-expanded={!!isOpen} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-slate-800"><span className="flex items-center gap-2.5"><span className="w-4 text-center text-slate-400">{g.icon}</span>{g.label}</span><span className="text-xs text-slate-500">{isOpen ? '▾' : '▸'}</span></button>
              {isOpen && <div className="ml-4 border-l border-slate-700 pl-2">{g.items.map((i) => <Link key={i.href} href={i.href} onClick={onNavigate} className={cx('block rounded-md px-3 py-1.5 text-[13px]', active(i.href) && (!i.href.includes('?') || (typeof window !== 'undefined' && location.search === '?' + i.href.split('?')[1])) ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white')}>{i.label}</Link>)}</div>}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const { data, meta, reload } = useApi<any[]>('/notifications?unread=false');
  useEffect(() => { const t = setInterval(reload, 60_000); return () => clearInterval(t); }, [reload]);
  const unread = meta?.unread ?? 0;
  return (
    <div className="relative">
      <button onClick={() => { setOpen((o) => !o); if (!open) reload(); }} aria-label={`Notifications (${unread} unread)`} className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100">🔔{unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread}</span>}</button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-80 rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-sm font-semibold">Notifications<button className="text-xs font-normal text-brand-700" onClick={async () => { await api.post('/notifications/read-all'); reload(); }}>Mark all read</button></div>
          <ul className="max-h-80 overflow-auto">
            {data?.map((n) => <li key={n.id} className={cx('border-b border-slate-50 px-3 py-2 text-sm', !n.readAt && 'bg-brand-50/50')}><Link href={n.link ?? '#'} onClick={async () => { setOpen(false); await api.post(`/notifications/${n.id}/read`); reload(); }}><div className="font-medium">{n.title}</div>{n.body && <div className="text-xs text-slate-500">{n.body}</div>}</Link></li>)}
            {data?.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">You&apos;re all caught up</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function Header({ onMenu }: { onMenu: () => void }) {
  const { me } = useSession();
  const router = useRouter();
  const [q, setQ] = useState(''); const [menu, setMenu] = useState(false); const [pwd, setPwd] = useState(false); const [help, setHelp] = useState(false);
  async function logout() { await api.post('/auth/logout', {}).catch(() => 0); await fetch('/api/auth/logout', { method: 'POST' }); router.push('/login'); router.refresh(); }
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
      <button className="rounded p-2 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={onMenu} aria-label="Open menu">☰</button>
      <div className="hidden text-sm sm:block"><div className="font-semibold leading-tight text-slate-900">{me.company.name}</div><div className="text-xs leading-tight text-slate-500">{me.company.code} · {me.company.baseCurrency}{me.company.trn ? ` · TRN ${me.company.trn}` : ''}</div></div>
      <form className="mx-auto w-full max-w-md" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/accounting/vouchers?search=${encodeURIComponent(q.trim())}`); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vouchers by number, reference or narration…" aria-label="Search" className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-brand-500 focus:bg-white focus:outline-none" />
      </form>
      <button className="rounded-md p-2 text-slate-500 hover:bg-slate-100" onClick={() => setHelp(true)} aria-label="Help">?</button>
      <Notifications />
      <div className="relative">
        <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-100" aria-haspopup="menu"><span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">{me.name.slice(0, 1).toUpperCase()}</span><span className="hidden text-left text-sm md:block"><span className="block font-medium leading-tight">{me.name}</span><span className="block text-xs leading-tight text-slate-500">{me.roles.map((r) => r.name).join(', ')}</span></span></button>
        {menu && <div className="absolute right-0 z-40 mt-1 w-48 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg" role="menu"><div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">{me.email}</div><button className="block w-full px-3 py-2 text-left hover:bg-slate-50" onClick={() => { setMenu(false); setPwd(true); }}>Change password</button><button className="block w-full px-3 py-2 text-left text-red-600 hover:bg-slate-50" onClick={logout}>Sign out</button></div>}
      </div>
      <FormModal open={pwd} onClose={() => setPwd(false)} title="Change password" fields={[{ name: 'currentPassword', label: 'Current password', type: 'password', required: true, span: 2 }, { name: 'newPassword', label: 'New password', type: 'password', required: true, span: 2, hint: '10+ characters with upper case, lower case and a digit' }]} onSubmit={async (v) => { await api.post('/auth/change-password', v); await logout(); }} submitLabel="Change & sign out" />
      <Modal open={help} onClose={() => setHelp(false)} title="Help & shortcuts">
        <ul className="space-y-2 text-sm text-slate-600">
          <li>• <b>Vouchers</b> post through the central accounting engine; posted vouchers are immutable — cancel (reverse) or <i>replace</i> to correct them.</li>
          <li>• Amounts are exact decimals. Debit must equal credit before a voucher can be saved.</li>
          <li>• Click any ledger or voucher name in a report to drill down to its transactions.</li>
          <li>• Reports can be exported to Excel, PDF and CSV, or printed.</li>
          <li>• Press <kbd className="rounded border px-1">Esc</kbd> to close dialogs.</li>
        </ul>
      </Modal>
    </header>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <Sidebar open={open} onNavigate={() => setOpen(false)} />
      {open && <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col"><Header onMenu={() => setOpen(true)} /><main className="flex-1 p-4 sm:p-6">{children}</main></div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return <SessionProvider><Shell>{children}</Shell></SessionProvider>;
}
