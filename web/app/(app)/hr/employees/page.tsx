'use client';
import { useRouter } from 'next/navigation';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import { money, today } from '@/lib/format';
import { ResourcePage } from '@/components/ResourcePage';
import { Badge } from '@/components/ui';

export default function Employees() {
  const router = useRouter(); const depts = useApi<any[]>('/hr/departments'); const desigs = useApi<any[]>('/hr/designations');
  return (
    <ResourcePage title="Employees" endpoint="/hr/employees" resource="hr" createLabel="New employee" onRowClick={(e: any) => router.push(`/hr/employees/${e.id}`)}
      columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'joinDate', label: 'Joined' }, { key: 'basicSalary', label: 'Basic salary', align: 'right', render: (e: any) => money(e.basicSalary) }, { key: 'isActive', label: 'Status', render: (e: any) => <Badge tone={e.isActive ? 'green' : 'slate'}>{e.isActive ? 'Active' : 'Inactive'}</Badge> }]}
      createFields={[{ name: 'name', label: 'Full name', required: true, span: 2 }, { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone' }, { name: 'departmentId', label: 'Department', type: 'select', options: depts.data?.map((d) => ({ value: d.id, label: d.name })) }, { name: 'designationId', label: 'Designation', type: 'select', options: desigs.data?.map((d) => ({ value: d.id, label: d.name })) },
        { name: 'joinDate', label: 'Join date', type: 'date', required: true, defaultValue: today() }, { name: 'basicSalary', label: 'Basic salary (monthly)', type: 'money', required: true }, { name: 'nationality', label: 'Nationality' }, { name: 'emiratesId', label: 'Emirates ID' }, { name: 'passportNo', label: 'Passport no.' }, { name: 'bankName', label: 'Bank' }, { name: 'iban', label: 'IBAN', span: 2 }]}
      extraActions={<><a className="text-sm text-brand-700 hover:underline" href="/reports/employee-report">Employee report</a></>} />
  );
}
