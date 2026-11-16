'use client';
import { useParams } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { money } from '@/lib/format';
import { DataTable } from '@/components/DataTable';
import { Badge, Card, PageHeader, Spinner, Stat } from '@/components/ui';

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: p } = useApi<any>(`/inventory/products/${id}`); const mv = useApi<any[]>(`/inventory/movements?productId=${id}`);
  if (!p) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHeader title={`${p.sku} · ${p.name}`} subtitle={p.barcode ? `Barcode ${p.barcode}` : undefined} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="On hand" value={p.onHand} /><Stat label="Sale price" value={money(p.salePrice)} /><Stat label="Purchase price" value={money(p.purchasePrice)} /><Stat label="Min stock" value={p.minStock} /></div>
      <Card title="Stock by warehouse" pad={false}><DataTable rows={p.byWarehouse} columns={[{ key: 'warehouse', label: 'Warehouse' }, { key: 'qty', label: 'Quantity', align: 'right' }, { key: 'value', label: 'Value', align: 'right', render: (r: any) => money(r.value) }]} /></Card>
      <Card title="Movement history" pad={false}><DataTable rows={mv.data} loading={mv.loading} columns={[{ key: 'movementDate', label: 'Date' }, { key: 'type', label: 'Type', render: (m: any) => <Badge tone="slate">{m.type}</Badge> }, { key: 'batchNo', label: 'Batch' }, { key: 'quantity', label: 'Qty', align: 'right' }, { key: 'unitCost', label: 'Unit cost', align: 'right' }, { key: 'totalCost', label: 'Value', align: 'right', render: (m: any) => money(m.totalCost) }]} /></Card>
    </div>
  );
}
