import { Injectable } from '@nestjs/common';
import { Tx } from '../common/prisma.service';
import { DEFAULT_ROLES, expandGrants } from '../common/permissions';
import { ACCOUNTS, GROUPS } from '../accounting/coa-template';

export const DEFAULT_VOUCHER_PREFIXES = {
  PAYMENT: 'PV', RECEIPT: 'RV', CONTRA: 'CV', JOURNAL: 'JV', SALES: 'SV', PURCHASE: 'PU', CREDIT_NOTE: 'CN', DEBIT_NOTE: 'DN',
};

/** Creates everything a new company needs: settings, roles, chart of accounts, financial year. */
@Injectable()
export class CompanyBootstrapService {
  async bootstrap(tx: Tx, companyId: string, fiscalStartMonth: number, now = new Date()) {
    await tx.companySetting.create({ data: { companyId, voucherPrefixes: DEFAULT_VOUCHER_PREFIXES } });

    // roles + permissions
    const catalogue = await tx.permission.findMany();
    const permId = new Map(catalogue.map((p) => [`${p.resource}:${p.action}`, p.id]));
    const roles: Record<string, string> = {};
    for (const [name, def] of Object.entries(DEFAULT_ROLES)) {
      const role = await tx.role.create({ data: { companyId, name, description: def.description, isSystem: true } });
      roles[name] = role.id;
      const grants = expandGrants(def.grants);
      await tx.rolePermission.createMany({
        data: grants.map((g) => ({ companyId, roleId: role.id, permissionId: permId.get(`${g.resource}:${g.action}`)! })),
      });
    }

    // chart of accounts
    const groupIds = new Map<string, string>();
    for (const g of GROUPS) {
      const created = await tx.accountGroup.create({
        data: { companyId, code: g.code, name: g.name, nature: g.nature, parentId: g.parent ? groupIds.get(g.parent) : null, isSystem: true },
      });
      groupIds.set(g.code, created.id);
    }
    for (const a of ACCOUNTS) {
      await tx.account.create({
        data: { companyId, code: a.code, name: a.name, groupId: groupIds.get(a.group)!, type: a.type, systemKey: a.systemKey, isSystem: !!a.systemKey },
      });
    }

    await this.createFinancialYear(tx, companyId, fiscalStartMonth, now);
    return { roles };
  }

  /** FY containing `now`, starting at the company's fiscal start month, with 12 monthly periods. */
  async createFinancialYear(tx: Tx, companyId: string, startMonth: number, ref: Date) {
    let startYear = ref.getUTCFullYear();
    if (ref.getUTCMonth() + 1 < startMonth) startYear -= 1;
    return this.createFinancialYearFrom(tx, companyId, new Date(Date.UTC(startYear, startMonth - 1, 1)));
  }

  async createFinancialYearFrom(tx: Tx, companyId: string, start: Date, name?: string) {
    const end = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), 0));
    const fyName = name ?? (start.getUTCMonth() === 0 ? `FY${start.getUTCFullYear()}` : `FY${start.getUTCFullYear()}-${String(end.getUTCFullYear()).slice(2)}`);
    const fy = await tx.financialYear.create({ data: { companyId, name: fyName, startDate: start, endDate: end } });
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let i = 0; i < 12; i++) {
      const ps = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      const pe = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i + 1, 0));
      await tx.accountingPeriod.create({
        data: { companyId, financialYearId: fy.id, name: `${months[ps.getUTCMonth()]} ${ps.getUTCFullYear()}`, startDate: ps, endDate: pe },
      });
    }
    return fy;
  }
}
