'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { ApiError, api } from '@/lib/api';
import { DataTable } from '@/components/DataTable';
import { FormModal } from '@/components/Form';
import { useSession } from '@/components/Session';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Tabs, Textarea } from '@/components/ui';

const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'post', 'cancel', 'export', 'print'];

function RoleEditor({ role, resources, onClose, onSaved }: { role?: any; resources: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(role?.name ?? ''); const [desc, setDesc] = useState(role?.description ?? ''); const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? ['dashboard:view'])); const [err, setErr] = useState('');
  const toggle = (k: string) => setPerms((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleRow = (r: string) => { const all = ACTIONS.every((a) => perms.has(`${r}:${a}`)); setPerms((p) => { const n = new Set(p); ACTIONS.forEach((a) => (all ? n.delete(`${r}:${a}`) : n.add(`${r}:${a}`))); return n; }); };
  const readOnly = role?.isSystem;
  return (
    <Modal open wide onClose={onClose} title={role ? (readOnly ? `${role.name} (system role)` : `Edit ${role.name}`) : 'New custom role'} footer={<><Button variant="secondary" onClick={onClose}>Close</Button>{!readOnly && <Button onClick={async () => { setErr(''); try { const body = { name, description: desc || undefined, permissions: [...perms].filter((p) => resources.includes(p.split(':')[0])) }; role ? await api.patch(`/roles/${role.id}`, body) : await api.post('/roles', body); onSaved(); onClose(); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } }}>Save role</Button>}</>}>
      {err && <Alert>{err}</Alert>}
      {!readOnly && <div className="mb-3 grid gap-3 sm:grid-cols-2"><Field label="Role name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Description"><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field></div>}
      <div className="max-h-[26rem] overflow-auto"><table className="min-w-full text-xs"><thead className="sticky top-0 bg-white"><tr className="border-b"><th className="py-1 text-left">Module</th>{ACTIONS.map((a) => <th key={a} className="px-2 py-1 capitalize">{a}</th>)}</tr></thead>
        <tbody>{resources.map((r) => <tr key={r} className="border-b border-slate-50"><td className="py-1 font-medium">{readOnly ? r : <button className="hover:underline" onClick={() => toggleRow(r)}>{r}</button>}</td>{ACTIONS.map((a) => <td key={a} className="px-2 py-1 text-center"><input type="checkbox" disabled={readOnly} checked={perms.has(`${r}:${a}`)} onChange={() => toggle(`${r}:${a}`)} aria-label={`${r} ${a}`} /></td>)}</tr>)}</tbody></table></div>
    </Modal>
  );
}

export default function UsersPage() {
  const { can, me } = useSession(); const [tab, setTab] = useState('users');
  const users = useApi<any[]>('/users'); const roles = useApi<any[]>('/roles'); const perms = useApi<any[]>(can('role') ? '/permissions' : null);
  const [invite, setInvite] = useState(false); const [editRole, setEditRole] = useState<any | 'new' | null>(null); const [err, setErr] = useState(''); const [userRoles, setUserRoles] = useState<any>(null);
  const resources = [...new Set(perms.data?.map((p) => p.resource) ?? [])];
  return (
    <div><PageHeader title="Users & Roles" subtitle="Role-based and permission-based access control" actions={tab === 'users' ? can('user', 'create') && <Button onClick={() => setInvite(true)}>+ Invite user</Button> : can('role', 'create') && <Button onClick={() => setEditRole('new')}>+ Custom role</Button>} />
      <Tabs tabs={[{ id: 'users', label: 'Users' }, { id: 'roles', label: 'Roles & permissions' }]} value={tab} onChange={setTab} />{err && <Alert>{err}</Alert>}
      {tab === 'users' ? <DataTable rows={users.data} loading={users.loading} columns={[{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'roles', label: 'Roles', render: (u: any) => u.roles.map((r: any) => r.role.name).join(', ') }, { key: 'emailVerifiedAt', label: 'Email', render: (u: any) => <Badge tone={u.emailVerifiedAt ? 'green' : 'amber'}>{u.emailVerifiedAt ? 'Verified' : 'Unverified'}</Badge> }, { key: 'isActive', label: 'Status', render: (u: any) => <Badge tone={u.isActive ? 'green' : 'red'}>{u.isActive ? 'Active' : 'Disabled'}</Badge> },
        { key: 'a', label: '', render: (u: any) => can('user', 'edit') && <span className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setUserRoles(u)}>Roles</Button>{u.id !== me.id && <Button size="sm" variant="ghost" onClick={async () => { try { await api.patch(`/users/${u.id}`, { isActive: !u.isActive }); users.reload(); } catch (e: any) { setErr(e.message); } }}>{u.isActive ? 'Disable' : 'Enable'}</Button>}</span> }]} />
      : <DataTable rows={roles.data} loading={roles.loading} onRowClick={(r: any) => setEditRole(r)} columns={[{ key: 'name', label: 'Role' }, { key: 'description', label: 'Description' }, { key: 'isSystem', label: 'Type', render: (r: any) => <Badge tone={r.isSystem ? 'blue' : 'slate'}>{r.isSystem ? 'System' : 'Custom'}</Badge> }, { key: 'userCount', label: 'Users', align: 'right' }, { key: 'permissions', label: 'Permissions', align: 'right', render: (r: any) => r.permissions.length }]} />}
      <FormModal open={invite} onClose={() => setInvite(false)} title="Invite user" fields={[{ name: 'email', label: 'Email', type: 'email', required: true, span: 2 }, { name: 'name', label: 'Name' }, { name: 'roleId', label: 'Role', type: 'select', required: true, options: roles.data?.map((r) => ({ value: r.id, label: r.name })) }]} submitLabel="Send invitation" onSubmit={async (v) => { await api.post('/users/invitations', v); }} />
      <FormModal open={!!userRoles} onClose={() => setUserRoles(null)} title={`Roles for ${userRoles?.name}`} fields={[{ name: 'roleId', label: 'Role', type: 'select', required: true, options: roles.data?.map((r) => ({ value: r.id, label: r.name })), defaultValue: userRoles?.roles[0]?.role.id }]} initial={{ roleId: userRoles?.roles[0]?.role.id }} onSubmit={async (v) => { await api.patch(`/users/${userRoles.id}`, { roleIds: [v.roleId] }); users.reload(); }} />
      {editRole && <RoleEditor role={editRole === 'new' ? undefined : editRole} resources={resources} onClose={() => setEditRole(null)} onSaved={roles.reload} />}
    </div>
  );
}
