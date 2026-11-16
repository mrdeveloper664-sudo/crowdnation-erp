'use client';
import React, { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { qs } from '@/lib/api';
import { Column, DataTable } from './DataTable';
import { FieldDef, FormModal } from './Form';
import { Alert, Button, Input, PageHeader } from './ui';
import { api } from '@/lib/api';
import { useSession } from './Session';

/** Generic list + search + pagination + create form for simple master data. */
export function ResourcePage<T = any>({ title, subtitle, endpoint, columns, createFields, createLabel = 'New', resource, searchable = true, onRowClick, extraActions, extraQuery, transform, afterCreate, children }: {
  title: string; subtitle?: string; endpoint: string; columns: Column<T>[]; createFields?: FieldDef[]; createLabel?: string; resource?: string; searchable?: boolean; onRowClick?: (r: T) => void;
  extraActions?: React.ReactNode; extraQuery?: Record<string, string | undefined>; transform?: (v: Record<string, any>) => Record<string, any>; afterCreate?: (r: any) => void; children?: React.ReactNode;
}) {
  const { can } = useSession();
  const [search, setSearch] = useState(''); const [page, setPage] = useState(1); const [open, setOpen] = useState(false);
  const { data, meta, loading, error, reload } = useApi<T[]>(`${endpoint}${qs({ search: searchable ? search : undefined, page, ...extraQuery })}`);
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={<>{extraActions}{createFields && (!resource || can(resource, 'create')) && <Button onClick={() => setOpen(true)}>+ {createLabel}</Button>}</>} />
      {searchable && <div className="mb-3 max-w-xs"><Input placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search" /></div>}
      {error && <Alert>{error}</Alert>}
      {children}
      <DataTable columns={columns} rows={data} loading={loading} meta={meta} onPage={setPage} onRowClick={onRowClick} />
      {createFields && <FormModal open={open} onClose={() => setOpen(false)} title={createLabel} fields={createFields} onSubmit={async (v) => { const r = await api.post(endpoint, transform ? transform(v) : v); reload(); afterCreate?.(r.data); }} />}
    </div>
  );
}
