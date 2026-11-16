import { Injectable } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { Tx } from '../common/prisma.service';

interface Tpl { code: string; name: string; groupCode: string; type: AccountType }

/** Accounts the engine posts to automatically. Created on demand so existing companies get them too. */
const TEMPLATES: Record<string, Tpl> = {
  COGS: { code: '5102', name: 'Cost of Goods Sold', groupCode: '5100', type: 'EXPENSE' },
  STOCK_ADJUSTMENT: { code: '5208', name: 'Stock Adjustments', groupCode: '5200', type: 'EXPENSE' },
  PPV: { code: '5209', name: 'Purchase Price Variance', groupCode: '5100', type: 'EXPENSE' },
  PAYROLL_EXPENSE: { code: '5210', name: 'Payroll Expense', groupCode: '5200', type: 'EXPENSE' },
  GENERAL_EXPENSE: { code: '5207', name: 'General Expenses', groupCode: '5200', type: 'EXPENSE' },
  GRNI: { code: '2112', name: 'Goods Received Not Invoiced', groupCode: '2110', type: 'GENERAL' },
  SALARIES_PAYABLE: { code: '2113', name: 'Salaries Payable', groupCode: '2110', type: 'GENERAL' },
  EXPENSE_CLAIMS_PAYABLE: { code: '2114', name: 'Employee Expense Claims Payable', groupCode: '2110', type: 'GENERAL' },
  DEDUCTIONS_PAYABLE: { code: '2115', name: 'Employee Deductions Payable', groupCode: '2110', type: 'GENERAL' },
  DISPOSAL_GAIN: { code: '4202', name: 'Gain on Asset Disposal', groupCode: '4200', type: 'INCOME' },
  DISPOSAL_LOSS: { code: '5211', name: 'Loss on Asset Disposal', groupCode: '5200', type: 'EXPENSE' },
};

@Injectable()
export class SystemAccountsService {
  async get(tx: Tx, companyId: string, key: string): Promise<string> {
    const found = await tx.account.findFirst({ where: { companyId, systemKey: key }, select: { id: true } });
    if (found) return found.id;
    const t = TEMPLATES[key];
    if (!t) throw new Error(`Unknown system account ${key}`);
    const byCode = await tx.account.findFirst({ where: { companyId, code: t.code } });
    if (byCode) {
      await tx.account.update({ where: { id: byCode.id }, data: { systemKey: key, isSystem: true } });
      return byCode.id;
    }
    const group = await tx.accountGroup.findFirstOrThrow({ where: { companyId, code: t.groupCode } });
    const a = await tx.account.create({ data: { companyId, groupId: group.id, code: t.code, name: t.name, type: t.type, systemKey: key, isSystem: true } });
    return a.id;
  }
}
