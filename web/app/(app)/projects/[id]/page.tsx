'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { FormModal } from '@/components/Form';
import { useSession } from '@/components/Session';
import { Attachments } from '@/modules/Attachments';
import { Badge, Button, Card, PageHeader, Select, Spinner, Stat } from '@/components/ui';

const COLS = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>(); const { can } = useSession(); const { data: p, reload: rp } = useApi<any>(`/projects/${id}`); const tasks = useApi<any[]>(`/projects/${id}/tasks`); const users = useApi<any[]>('/users');
  const [open, setOpen] = useState(false); const [member, setMember] = useState(false);
  if (!p) return <Spinner />;
  const reload = () => { rp(); tasks.reload(); };
  return (
    <div className="space-y-4">
      <PageHeader title={`${p.code} · ${p.name}`} subtitle={<Badge>{p.status}</Badge>} actions={can('project', 'create') && <><Button variant="secondary" onClick={() => setMember(true)}>+ Team member</Button><Button onClick={() => setOpen(true)}>+ Task</Button></>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Stat label="Progress" value={`${p.progress}%`} /><Stat label="Income" value={money(p.income)} sub={`Budget ${money(p.budgetRevenue)}`} /><Stat label="Cost" value={money(p.cost)} sub={`Budget ${money(p.budgetCost)}${p.budgetCostUsed ? ` · ${p.budgetCostUsed} used` : ''}`} /><Stat label="Profit" value={money(p.profit)} tone={p.profit.startsWith('-') ? 'bad' : 'good'} /><Stat label="Margin" value={p.margin ?? '—'} /></div>
      <p className="text-xs text-slate-500">Income and cost come from posted sales/purchase documents and approved expenses tagged with this project.</p>
      <div className="grid gap-3 md:grid-cols-4">{COLS.map((c) => <div key={c} className="rounded-lg bg-slate-100 p-2"><div className="mb-2 px-1 text-xs font-semibold uppercase text-slate-600">{c.replace('_', ' ')} · {tasks.data?.filter((t) => t.status === c).length ?? 0}</div><div className="space-y-2">{tasks.data?.filter((t) => t.status === c).map((t) => <Card key={t.id} className="!shadow-none"><div className="text-sm font-medium">{t.title}</div><div className="text-xs text-slate-500">{t.dueDate ? `Due ${t.dueDate}` : ''} {Number(t.estimatedHours) > 0 && `· ${t.estimatedHours}h`}</div>{can('project', 'edit') && <Select className="mt-2 !py-1 text-xs" value={t.status} onChange={async (e) => { await api.patch(`/projects/tasks/${t.id}`, { status: e.target.value }); reload(); }} aria-label={`Status of ${t.title}`}>{COLS.map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</Select>}</Card>)}</div></div>)}</div>
      <Attachments entityType="project" entityId={id} canEdit={can('project', 'edit')} />
      <FormModal open={open} onClose={() => setOpen(false)} title="New task" fields={[{ name: 'title', label: 'Title', required: true, span: 2 }, { name: 'assigneeId', label: 'Assignee', type: 'select', options: users.data?.map((u) => ({ value: u.id, label: u.name })) }, { name: 'priority', label: 'Priority', type: 'select', options: ['LOW', 'MEDIUM', 'HIGH'].map((x) => ({ value: x, label: x })), defaultValue: 'MEDIUM' }, { name: 'dueDate', label: 'Due', type: 'date' }, { name: 'estimatedHours', label: 'Estimated hours', type: 'number' }, { name: 'description', label: 'Description', type: 'textarea' }]} onSubmit={async (v) => { await api.post(`/projects/${id}/tasks`, v); reload(); }} />
      <FormModal open={member} onClose={() => setMember(false)} title="Add team member" fields={[{ name: 'userId', label: 'User', type: 'select', required: true, options: users.data?.map((u) => ({ value: u.id, label: u.name })) }, { name: 'role', label: 'Role', defaultValue: 'MEMBER' }]} onSubmit={async (v) => { await api.post(`/projects/${id}/members`, v); reload(); }} />
    </div>
  );
}
