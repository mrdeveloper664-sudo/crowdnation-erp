import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Frequency } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { isoDate, parseDate } from '../common/dates';
import { paged } from '../common/interceptors/response.interceptor';
import { D, ZERO, fmt } from '../common/money';
import { NotificationsService } from '../common/notifications.service';
import { PrismaService, Tx } from '../common/prisma.service';
import { IsMoney, IsoDate } from '../common/validators';
import { SequenceService } from '../accounting/sequence.service';
import { SystemAccountsService } from '../accounting/system-accounts.service';
import { VatService } from '../vat/vat.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { advance } from '../trade/recurring.service';

class CategoryDto { @IsString() @Length(2, 80) name: string; @IsUUID() accountId: string; @IsOptional() @IsBoolean() requiresReceipt?: boolean }
class ExpenseDto {
  @IsIn(['DIRECT', 'CLAIM']) kind: string; @IsUUID() categoryId: string; @Matches(IsoDate) date: string; @IsString() @Length(2, 300) description: string;
  @IsMoney() amount: string; @IsOptional() @IsBoolean() includesVat?: boolean; @IsOptional() @IsString() taxCode?: string;
  @IsOptional() @IsUUID() paidFromId?: string; @IsOptional() @IsUUID() employeeId?: string; @IsOptional() @IsUUID() projectId?: string;
}
class ReasonDto { @IsString() @Length(3, 300) reason: string }
class ReimburseDto { @IsUUID() accountId: string; @Matches(IsoDate) date: string }
class RecurringDto {
  @IsUUID() categoryId: string; @IsString() @Length(2, 300) description: string; @IsMoney() net: string; @IsOptional() @IsString() taxCode?: string; @IsUUID() paidFromId: string;
  @IsEnum(Frequency) frequency: Frequency; @Matches(IsoDate) startDate: string; @IsOptional() @Matches(IsoDate) endDate?: string; @IsOptional() @IsBoolean() autoPost?: boolean;
}
class BudgetDto { @IsUUID() categoryId: string; @IsInt() @Min(2000) @Max(2100) year: number; @IsInt() @Min(0) @Max(12) month: number; @IsMoney() amount: string }

@Controller('expenses')
export class ExpensesController {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private vat: VatService, private vouchers: VouchersService, private sys: SystemAccountsService, private notes: NotificationsService) {}

  @Get('categories') @RequirePermission('expense', 'view') categories(@CurrentUser() u: AuthUser) { return this.prisma.tenant(u.companyId, (tx) => tx.expenseCategory.findMany({ orderBy: { name: 'asc' } })); }
  @Post('categories') @RequirePermission('expense', 'edit')
  addCategory(@CurrentUser() u: AuthUser, @Body() d: CategoryDto) {
    return this.prisma.tenant(u.companyId, async (tx) => { const a = await tx.account.findUnique({ where: { id: d.accountId }, include: { group: true } }); if (a?.group.nature !== 'EXPENSE') throw new BadRequestException('accountId must be an expense ledger'); return tx.expenseCategory.create({ data: { ...d, companyId: u.companyId } }); });
  }

  private present(e: any) { return { ...e, expenseDate: isoDate(e.expenseDate), net: fmt(e.net), vat: fmt(e.vat), total: fmt(e.total) }; }

  @Get() @RequirePermission('expense', 'view')
  list(@CurrentUser() u: AuthUser, @Query() q: any) {
    const page = Math.max(1, Number(q.page) || 1), pageSize = Math.min(200, Number(q.pageSize) || 25);
    return this.prisma.tenant(u.companyId, async (tx) => {
      const where: any = { ...(q.status ? { status: q.status } : {}), ...(q.kind ? { kind: q.kind } : {}), ...(q.categoryId ? { categoryId: q.categoryId } : {}), ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.from || q.to ? { expenseDate: { ...(q.from ? { gte: parseDate(q.from) } : {}), ...(q.to ? { lte: parseDate(q.to) } : {}) } } : {}) };
      // users without approve rights only see their own claims
      if (!(await tx.rolePermission.count({ where: { role: { users: { some: { userId: u.userId } } }, permission: { resource: 'expense', action: 'approve' } } }))) where.createdBy = u.userId;
      const [t, r] = await Promise.all([tx.expense.count({ where }), tx.expense.findMany({ where, orderBy: [{ expenseDate: 'desc' }, { number: 'desc' }], skip: (page - 1) * pageSize, take: pageSize })]);
      return paged(r.map((e) => this.present(e)), page, pageSize, t);
    });
  }

  @Get(':id') @RequirePermission('expense', 'view')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.prisma.tenant(u.companyId, async (tx) => this.present(await tx.expense.findUniqueOrThrow({ where: { id } }))); }

  private async build(tx: Tx, u: AuthUser, d: ExpenseDto, recurringId?: string) {
    const date = parseDate(d.date);
    const cat = await tx.expenseCategory.findUnique({ where: { id: d.categoryId } });
    if (!cat?.isActive) throw new BadRequestException('Active expense category required');
    if (d.kind === 'DIRECT') { const a = d.paidFromId ? await tx.account.findUnique({ where: { id: d.paidFromId } }) : null; if (!a || !['CASH', 'BANK'].includes(a.type)) throw new BadRequestException('Direct expenses need paidFromId (cash/bank ledger)'); }
    let employeeId = d.employeeId;
    if (d.kind === 'CLAIM' && !employeeId) { employeeId = (await tx.employee.findFirst({ where: { userId: u.userId } }))?.id; if (!employeeId) throw new BadRequestException('Claims need an employee (your user is not linked to one)'); }
    const code = d.taxCode ?? 'OOS';
    const calc = await this.vat.calculate(tx, u.companyId, { code, date, amount: d.amount, inclusive: !!d.includesVat });
    const fy = await tx.financialYear.findFirst({ where: { startDate: { lte: date }, endDate: { gte: date } } });
    if (!fy) throw new BadRequestException('Date is outside every financial year');
    const number = `EXP-${fy.startDate.getUTCFullYear()}-${this.seq.pad(await this.seq.next(tx, u.companyId, 'EXPENSE', fy.id))}`;
    return tx.expense.create({ data: { companyId: u.companyId, number, kind: d.kind, categoryId: d.categoryId, employeeId, projectId: d.projectId, expenseDate: date, description: d.description, net: D(calc.net), vat: D(calc.vat), total: D(calc.gross), taxRateId: calc.taxRateId, paidFromId: d.paidFromId, createdBy: u.userId, recurringId } });
  }

  @Post() @RequirePermission('expense', 'create')
  create(@CurrentUser() u: AuthUser, @Body() d: ExpenseDto) {
    return this.prisma.tenant(u.companyId, async (tx) => { const e = await this.build(tx, u, d); await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'expense.created', entityType: 'expense', entityId: e.id, after: { number: e.number, total: e.total.toString() } }); return this.present(e); });
  }

  private async lock(tx: Tx, id: string) { await tx.$queryRaw`SELECT id FROM expenses WHERE id = ${id}::uuid FOR UPDATE`; return tx.expense.findUniqueOrThrow({ where: { id } }); }

  @Post(':id/submit') @HttpCode(200) @RequirePermission('expense', 'create')
  submit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const e = await this.lock(tx, id);
      if (!['DRAFT', 'REJECTED'].includes(e.status)) throw new ConflictException(`Cannot submit a ${e.status} expense`);
      const cat = await tx.expenseCategory.findUniqueOrThrow({ where: { id: e.categoryId } });
      if (cat.requiresReceipt && !(await tx.attachment.count({ where: { entityType: 'expense', entityId: id } }))) throw new BadRequestException('A receipt attachment is required for this category');
      await tx.expense.update({ where: { id }, data: { status: 'SUBMITTED', rejectedReason: null } });
      await this.notes.notify(tx, u.companyId, await this.notes.usersWith(tx, 'expense', 'approve'), 'Expense awaiting approval', `${e.number} - ${fmt(e.total)}`, `/expenses/${id}`);
      return { status: 'SUBMITTED' };
    });
  }

  /** Approval posts the expense to the ledger automatically. */
  @Post(':id/approve') @HttpCode(200) @RequirePermission('expense', 'approve')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const e = await this.lock(tx, id);
      if (e.status !== 'SUBMITTED') throw new ConflictException(`Cannot approve a ${e.status} expense`);
      const s = await tx.companySetting.findUniqueOrThrow({ where: { companyId: u.companyId } });
      if (e.createdBy === u.userId && !s.allowSelfApproval) throw new ForbiddenException('Segregation of duties: you cannot approve your own expense');
      const voucher = await this.postExpense(tx, u, e);
      await tx.expense.update({ where: { id }, data: { status: 'POSTED', approvedBy: u.userId, voucherId: voucher.id } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'expense.approved', entityType: 'expense', entityId: id, after: { voucher: voucher.number } });
      const creator = e.createdBy !== u.userId ? [e.createdBy] : [];
      await this.notes.notify(tx, u.companyId, creator, 'Expense approved', e.number, `/expenses/${id}`);
      return { status: 'POSTED', voucher: voucher.number };
    });
  }

  private async postExpense(tx: Tx, u: AuthUser, e: any) {
    const cat = await tx.expenseCategory.findUniqueOrThrow({ where: { id: e.categoryId } });
    const lines: any[] = [{ accountId: cat.accountId, debit: e.net.toString(), description: e.description }];
    if (e.taxRateId) {
      const rate = await tx.taxRate.findUniqueOrThrow({ where: { id: e.taxRateId } });
      if (rate.treatment !== 'OUT_OF_SCOPE') { const vatAcc = await tx.account.findFirstOrThrow({ where: { companyId: u.companyId, type: 'VAT_INPUT' } }); lines.push({ accountId: vatAcc.id, ...(e.vat.gt(0) ? { debit: e.vat.toString() } : {}), taxRateId: rate.id, taxableAmount: e.net.toString() }); }
    }
    lines.push(e.kind === 'DIRECT' ? { accountId: e.paidFromId, credit: e.total.toString() } : { accountId: await this.sys.get(tx, u.companyId, 'EXPENSE_CLAIMS_PAYABLE'), credit: e.total.toString() });
    const v = await this.vouchers.create(u.companyId, u.userId, { type: e.kind === 'DIRECT' ? 'PAYMENT' : 'JOURNAL', date: isoDate(e.expenseDate), reference: e.number, narration: e.description, lines }, undefined, tx);
    await this.vouchers.post(u.companyId, u.userId, v.id, tx);
    return v;
  }

  @Post(':id/reject') @HttpCode(200) @RequirePermission('expense', 'approve')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto) {
    return this.prisma.tenant(u.companyId, async (tx) => { const e = await this.lock(tx, id); if (e.status !== 'SUBMITTED') throw new ConflictException(`Cannot reject a ${e.status} expense`); await tx.expense.update({ where: { id }, data: { status: 'REJECTED', rejectedReason: d.reason } }); await this.notes.notify(tx, u.companyId, [e.createdBy], 'Expense rejected', `${e.number}: ${d.reason}`, `/expenses/${id}`); return { status: 'REJECTED' }; });
  }

  @Post(':id/reimburse') @HttpCode(200) @RequirePermission('expense', 'post')
  reimburse(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReimburseDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const e = await this.lock(tx, id);
      if (e.kind !== 'CLAIM' || e.status !== 'POSTED') throw new ConflictException('Only approved employee claims can be reimbursed');
      const bank = await tx.account.findUniqueOrThrow({ where: { id: d.accountId } });
      if (!['CASH', 'BANK'].includes(bank.type)) throw new BadRequestException('accountId must be a cash/bank ledger');
      const v = await this.vouchers.create(u.companyId, u.userId, { type: 'PAYMENT', date: d.date, reference: e.number, narration: `Reimbursement ${e.number}`, lines: [{ accountId: await this.sys.get(tx, u.companyId, 'EXPENSE_CLAIMS_PAYABLE'), debit: e.total.toString() }, { accountId: d.accountId, credit: e.total.toString() }] }, undefined, tx);
      await this.vouchers.post(u.companyId, u.userId, v.id, tx);
      await tx.expense.update({ where: { id }, data: { status: 'REIMBURSED', reimburseVoucherId: v.id } });
      return { status: 'REIMBURSED', voucher: v.number };
    });
  }

  @Post(':id/cancel') @HttpCode(200) @RequirePermission('expense', 'cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const e = await this.lock(tx, id);
      if (['CANCELLED', 'REIMBURSED'].includes(e.status)) throw new ConflictException(`Cannot cancel a ${e.status} expense`);
      if (e.voucherId) await this.vouchers.cancel(u.companyId, u.userId, e.voucherId, `${e.number}: ${d.reason}`, undefined, tx);
      await tx.expense.update({ where: { id }, data: { status: 'CANCELLED' } });
      return { status: 'CANCELLED' };
    });
  }

  // ---- recurring
  @Get('recurring/list') @RequirePermission('expense', 'view') recurring(@CurrentUser() u: AuthUser) { return this.prisma.tenant(u.companyId, (tx) => tx.recurringExpense.findMany({ orderBy: { nextRunDate: 'asc' } })); }
  @Post('recurring') @RequirePermission('expense', 'create')
  addRecurring(@CurrentUser() u: AuthUser, @Body() d: RecurringDto) { return this.prisma.tenant(u.companyId, (tx) => tx.recurringExpense.create({ data: { ...d, companyId: u.companyId, nextRunDate: parseDate(d.startDate), endDate: d.endDate ? parseDate(d.endDate) : null, startDate: undefined } as any })); }
  @Post('recurring/run') @HttpCode(200) @RequirePermission('expense', 'post')
  runRecurring(@CurrentUser() u: AuthUser, @Body('asOf') asOf?: string) {
    const date = parseDate(asOf ?? new Date().toISOString().slice(0, 10), 'asOf');
    return this.prisma.tenant(u.companyId, async (tx) => {
      const out: string[] = [];
      for (const r of await tx.recurringExpense.findMany({ where: { isActive: true, nextRunDate: { lte: date } } })) {
        let next = r.nextRunDate;
        while (next <= date && (!r.endDate || next <= r.endDate)) {
          const e = await this.build(tx, u, { kind: 'DIRECT', categoryId: r.categoryId, date: isoDate(next), description: r.description, amount: r.net.toString(), taxCode: r.taxCode ?? undefined, paidFromId: r.paidFromId }, r.id);
          if (r.autoPost) { const v = await this.postExpense(tx, u, e); await tx.expense.update({ where: { id: e.id }, data: { status: 'POSTED', approvedBy: u.userId, voucherId: v.id } }); } else await tx.expense.update({ where: { id: e.id }, data: { status: 'SUBMITTED' } });
          out.push(e.number); next = advance(next, r.frequency);
        }
        await tx.recurringExpense.update({ where: { id: r.id }, data: { nextRunDate: next, isActive: !r.endDate || next <= r.endDate } });
      }
      return { generated: out.length, expenses: out };
    });
  }

  // ---- budgets
  @Put('budgets') @RequirePermission('expense', 'edit')
  setBudget(@CurrentUser() u: AuthUser, @Body() d: BudgetDto) {
    return this.prisma.tenant(u.companyId, (tx) => tx.expenseBudget.upsert({ where: { companyId_categoryId_year_month: { companyId: u.companyId, categoryId: d.categoryId, year: d.year, month: d.month } }, create: { companyId: u.companyId, ...d }, update: { amount: d.amount } }));
  }
  @Get('budgets/list') @RequirePermission('expense', 'view')
  budgets(@CurrentUser() u: AuthUser, @Query('year') year: string) { return this.prisma.tenant(u.companyId, (tx) => tx.expenseBudget.findMany({ where: { year: Number(year) } })); }
}
