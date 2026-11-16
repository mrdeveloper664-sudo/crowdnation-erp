'use client';
import { ResourcePage } from '@/components/ResourcePage';
import { Badge } from '@/components/ui';

export default function Warehouses() {
  return <ResourcePage title="Warehouses" endpoint="/inventory/warehouses" resource="inventory" searchable={false} createLabel="New warehouse"
    columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'address', label: 'Address' }, { key: 'isDefault', label: 'Default', render: (w: any) => (w.isDefault ? <Badge tone="blue">Default</Badge> : '') }, { key: 'isActive', label: 'Status', render: (w: any) => <Badge tone={w.isActive ? 'green' : 'red'}>{w.isActive ? 'Active' : 'Inactive'}</Badge> }]}
    createFields={[{ name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true }, { name: 'address', label: 'Address', span: 2 }, { name: 'isDefault', label: 'Default warehouse', type: 'checkbox' }]} />;
}
