import { AccountNature, AccountType } from '@prisma/client';

/** Default chart of accounts (generic, works for trading / services / events / retail / construction). */
export interface GroupTpl { code: string; name: string; nature: AccountNature; parent?: string }
export interface AccountTpl { code: string; name: string; group: string; type: AccountType; systemKey?: string }

export const GROUPS: GroupTpl[] = [
  { code: '1000', name: 'Assets', nature: 'ASSET' },
  { code: '1100', name: 'Current Assets', nature: 'ASSET', parent: '1000' },
  { code: '1110', name: 'Cash and Bank', nature: 'ASSET', parent: '1100' },
  { code: '1120', name: 'Accounts Receivable', nature: 'ASSET', parent: '1100' },
  { code: '1130', name: 'Inventory', nature: 'ASSET', parent: '1100' },
  { code: '1140', name: 'Tax Receivable', nature: 'ASSET', parent: '1100' },
  { code: '1200', name: 'Fixed Assets', nature: 'ASSET', parent: '1000' },
  { code: '2000', name: 'Liabilities', nature: 'LIABILITY' },
  { code: '2100', name: 'Current Liabilities', nature: 'LIABILITY', parent: '2000' },
  { code: '2110', name: 'Accounts Payable', nature: 'LIABILITY', parent: '2100' },
  { code: '2120', name: 'Tax Payable', nature: 'LIABILITY', parent: '2100' },
  { code: '2200', name: 'Long-term Liabilities', nature: 'LIABILITY', parent: '2000' },
  { code: '3000', name: 'Equity', nature: 'EQUITY' },
  { code: '4000', name: 'Income', nature: 'INCOME' },
  { code: '4100', name: 'Operating Income', nature: 'INCOME', parent: '4000' },
  { code: '4200', name: 'Other Income', nature: 'INCOME', parent: '4000' },
  { code: '5000', name: 'Expenses', nature: 'EXPENSE' },
  { code: '5100', name: 'Direct Expenses', nature: 'EXPENSE', parent: '5000' },
  { code: '5200', name: 'Indirect Expenses', nature: 'EXPENSE', parent: '5000' },
];

export const ACCOUNTS: AccountTpl[] = [
  { code: '1111', name: 'Cash in Hand', group: '1110', type: 'CASH', systemKey: 'CASH' },
  { code: '1112', name: 'Bank Account', group: '1110', type: 'BANK', systemKey: 'BANK' },
  { code: '1121', name: 'Accounts Receivable (Control)', group: '1120', type: 'CUSTOMER', systemKey: 'AR_CONTROL' },
  { code: '1131', name: 'Inventory', group: '1130', type: 'INVENTORY', systemKey: 'INVENTORY' },
  { code: '1141', name: 'VAT Input (Recoverable)', group: '1140', type: 'VAT_INPUT', systemKey: 'VAT_INPUT' },
  { code: '1201', name: 'Fixed Assets', group: '1200', type: 'FIXED_ASSET', systemKey: 'FIXED_ASSETS' },
  { code: '1202', name: 'Accumulated Depreciation', group: '1200', type: 'ACCUMULATED_DEPRECIATION', systemKey: 'ACC_DEPRECIATION' },
  { code: '2111', name: 'Accounts Payable (Control)', group: '2110', type: 'SUPPLIER', systemKey: 'AP_CONTROL' },
  { code: '2121', name: 'VAT Output (Payable)', group: '2120', type: 'VAT_OUTPUT', systemKey: 'VAT_OUTPUT' },
  { code: '3001', name: 'Owner Capital', group: '3000', type: 'CAPITAL', systemKey: 'CAPITAL' },
  { code: '3002', name: 'Retained Earnings', group: '3000', type: 'RETAINED_EARNINGS', systemKey: 'RETAINED_EARNINGS' },
  { code: '3003', name: 'Opening Balance Difference', group: '3000', type: 'GENERAL', systemKey: 'OPENING_DIFFERENCE' },
  { code: '4101', name: 'Sales', group: '4100', type: 'INCOME', systemKey: 'SALES' },
  { code: '4102', name: 'Service Income', group: '4100', type: 'INCOME' },
  { code: '4201', name: 'Foreign Exchange Gain', group: '4200', type: 'INCOME', systemKey: 'FX_GAIN' },
  { code: '5101', name: 'Purchases / Cost of Sales', group: '5100', type: 'EXPENSE', systemKey: 'PURCHASES' },
  { code: '5201', name: 'Salaries and Wages', group: '5200', type: 'EXPENSE' },
  { code: '5202', name: 'Rent', group: '5200', type: 'EXPENSE' },
  { code: '5203', name: 'Utilities', group: '5200', type: 'EXPENSE' },
  { code: '5204', name: 'Depreciation Expense', group: '5200', type: 'EXPENSE', systemKey: 'DEPRECIATION_EXPENSE' },
  { code: '5205', name: 'Foreign Exchange Loss', group: '5200', type: 'EXPENSE', systemKey: 'FX_LOSS' },
  { code: '5206', name: 'Rounding Differences', group: '5200', type: 'EXPENSE', systemKey: 'ROUNDING' },
  { code: '5207', name: 'General Expenses', group: '5200', type: 'EXPENSE' },
];
