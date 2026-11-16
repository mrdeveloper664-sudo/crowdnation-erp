'use client';
import { ResourcePage } from '@/components/ResourcePage';
import { Badge } from '@/components/ui';

export default function Branches() {
  return <ResourcePage title="Branches" subtitle="Branch-level filtering is available in reports" endpoint="/branches" resource="branch" searchable={false} createLabel="New branch"
    columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'address', label: 'Address' }, { key: 'isActive', label: 'Status', render: (b: any) => <Badge tone={b.isActive ? 'green' : 'red'}>{b.isActive ? 'Active' : 'Inactive'}</Badge> }]}
    createFields={[{ name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true }, { name: 'address', label: 'Address', span: 2 }]} />;
}
