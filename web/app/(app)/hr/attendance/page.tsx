'use client';
import { useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { today } from '@/lib/format';
import { Input, PageHeader, Select } from '@/components/ui';
import { DataTable } from '@/components/DataTable';

export default function Attendance() {
  const [date, setDate] = useState(today()); const emps = useApi<any[]>('/hr/employees?active=true'); const att = useApi<any[]>(`/hr/attendance?from=${date}&to=${date}`);
  const status = (id: string) => att.data?.find((a) => a.employeeId === id)?.status ?? '';
  return (
    <div>
      <PageHeader title="Attendance" subtitle="Mark attendance per day. Absences and half days reduce pay in the payroll run." actions={<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />} />
      <DataTable rows={emps.data} loading={emps.loading} columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Employee' }, { key: 's', label: 'Status', render: (e: any) => <Select className="max-w-[10rem]" value={status(e.id)} onChange={async (ev) => { if (!ev.target.value) return; await api.put('/hr/attendance', { employeeId: e.id, date, status: ev.target.value }); att.reload(); }} aria-label={`Attendance of ${e.name}`}><option value="">— not marked —</option>{['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY', 'HOLIDAY'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select> }]} />
    </div>
  );
}
