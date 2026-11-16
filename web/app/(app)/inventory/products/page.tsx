'use client';
import { useRouter } from 'next/navigation';
import { ResourcePage } from '@/components/ResourcePage';
import { Badge } from '@/components/ui';
import { money } from '@/lib/format';
import { useApi } from '@/hooks/useApi';

export default function Products() {
  const router = useRouter(); const cats = useApi<any[]>('/inventory/categories');
  return (
    <ResourcePage title="Products" subtitle="Stocked items and services. Scan or type a barcode into the search box." endpoint="/inventory/products" resource="inventory" createLabel="New product" onRowClick={(p: any) => router.push(`/inventory/products/${p.id}`)}
      columns={[{ key: 'sku', label: 'SKU' }, { key: 'barcode', label: 'Barcode' }, { key: 'name', label: 'Name' }, { key: 'trackInventory', label: 'Type', render: (p: any) => <Badge tone="slate">{p.trackInventory ? 'Stocked' : 'Service'}{p.trackBatch ? ' · batch' : ''}{p.trackSerial ? ' · serial' : ''}</Badge> }, { key: 'salePrice', label: 'Sale price', align: 'right', render: (p: any) => money(p.salePrice) }, { key: 'onHand', label: 'On hand', align: 'right', render: (p: any) => (p.trackInventory ? <span className={Number(p.onHand) <= Number(p.minStock) && Number(p.minStock) > 0 ? 'font-semibold text-red-600' : ''}>{p.onHand}</span> : '—') }, { key: 'stockValue', label: 'Stock value', align: 'right', render: (p: any) => (p.trackInventory ? money(p.stockValue) : '') }]}
      createFields={[{ name: 'name', label: 'Name', required: true, span: 2 }, { name: 'sku', label: 'SKU', hint: 'Blank = auto' }, { name: 'barcode', label: 'Barcode' }, { name: 'categoryId', label: 'Category', type: 'combo', options: cats.data?.map((c) => ({ value: c.id, label: c.name })) },
        { name: 'taxCode', label: 'Tax code', type: 'select', options: ['STD', 'ZERO', 'EXEMPT', 'OOS'].map((c) => ({ value: c.toString(), label: c })), defaultValue: 'STD' }, { name: 'salePrice', label: 'Sale price', type: 'money' }, { name: 'purchasePrice', label: 'Purchase price', type: 'money' }, { name: 'minStock', label: 'Minimum stock', type: 'number', hint: 'Low-stock alert level' }, { name: 'reorderQty', label: 'Reorder quantity', type: 'number' },
        { name: 'trackInventory', label: 'Stocked item (uncheck for services)', type: 'checkbox', defaultValue: true }, { name: 'trackBatch', label: 'Track batches / expiry', type: 'checkbox' }, { name: 'trackSerial', label: 'Track serial numbers', type: 'checkbox' }, { name: 'description', label: 'Description', type: 'textarea' }]} />
  );
}
