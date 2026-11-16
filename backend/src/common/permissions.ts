export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'post', 'cancel', 'export', 'print'] as const;
export type Action = (typeof ACTIONS)[number];

export const RESOURCES = [
  'company', 'settings', 'user', 'role', 'branch',
  'period', 'account', 'ledger', 'voucher', 'journal', 'report', 'audit',
  'vat', 'customer', 'supplier', 'sales', 'purchase', 'inventory', 'crm', 'hr', 'expense', 'project', 'asset',
] as const;

type Grant = Partial<Record<(typeof RESOURCES)[number] | '*', readonly Action[] | '*'>>;

const ALL = ACTIONS;
const READ: readonly Action[] = ['view', 'export', 'print'];
const CRUD: readonly Action[] = ['view', 'create', 'edit', 'delete', 'export', 'print'];

/** Default system roles. '*' means every resource/action. */
export const DEFAULT_ROLES: Record<string, { description: string; grants: Grant }> = {
  'Company Administrator': { description: 'Full access to the company', grants: { '*': '*' } },
  Accountant: {
    description: 'Day-to-day bookkeeping',
    grants: {
      account: CRUD, ledger: CRUD, voucher: [...CRUD, 'post', 'cancel'], journal: READ, report: READ, vat: CRUD,
      period: ['view'], customer: CRUD, supplier: CRUD, sales: CRUD, purchase: CRUD, expense: CRUD, company: ['view'], branch: ['view'],
    },
  },
  'Finance Manager': {
    description: 'Approves and posts financial transactions, manages periods',
    grants: {
      account: ALL, ledger: ALL, voucher: ALL, journal: READ, report: READ, vat: ALL, period: ALL, audit: ['view'],
      customer: ALL, supplier: ALL, sales: ALL, purchase: ALL, expense: ALL, company: ['view'], branch: ['view'],
    },
  },
  'Sales Manager': {
    description: 'Sales, customers and CRM',
    grants: { customer: ALL, sales: ALL, crm: ALL, report: READ, ledger: ['view'], inventory: ['view'], voucher: ['view'] },
  },
  'Purchase Manager': {
    description: 'Purchasing and suppliers',
    grants: { supplier: ALL, purchase: ALL, inventory: ['view', 'create', 'edit'], report: READ, ledger: ['view'], voucher: ['view'] },
  },
  'HR Manager': { description: 'HR and payroll', grants: { hr: ALL, expense: ['view', 'approve'], report: READ } },
  Employee: { description: 'Self service', grants: { expense: ['view', 'create', 'edit'], hr: ['view'] } },
  Viewer: {
    description: 'Read-only access',
    grants: Object.fromEntries(RESOURCES.filter((r) => r !== 'user' && r !== 'role' && r !== 'settings').map((r) => [r, ['view']])) as Grant,
  },
};

export function expandGrants(grants: Grant): Array<{ resource: string; action: string }> {
  const out: Array<{ resource: string; action: string }> = [];
  const all = '*' in grants;
  for (const resource of RESOURCES) {
    const g = all ? grants['*'] : grants[resource];
    if (!g) continue;
    const actions = g === '*' ? ALL : g;
    for (const action of actions) out.push({ resource, action });
  }
  return out;
}
