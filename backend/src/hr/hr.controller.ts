import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min, ValidateNested } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { isoDate, parseDate } from '../common/dates';
import { paged } from '../common/interceptors/response.interceptor';
import { D, ZERO, fmt, round } from '../common/money';
import { NotificationsService } from '../common/notifications.service';
import { PrismaService, Tx } from '../common/prisma.service';
import { IsMoney, IsoDate } from '../common/validators';
import { SequenceService } from '../accounting/sequence.service';
import { SystemAccountsService } from '../accounting/system-accounts.service';
import { VouchersService } from '../vouchers/vouchers.service';

class EmployeeDto {
  @IsString() @Length(2, 160) name: string; @IsOptional() @IsEmail() email?: string; @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsUUID() departmentId?: string; @IsOptional() @IsUUID() designationId?: string; @IsOptional() @IsUUID() userId?: string; @IsOptional() @IsUUID() managerId?: string;
  @Matches(IsoDate) joinDate: string; @IsOptional() @Matches(IsoDate) dateOfBirth?: string; @IsOptional() @IsString() nationality?: string;
  @IsOptional() @IsString() emiratesId?: string; @IsOptional() @IsString() passportNo?: string; @IsOptional() @IsString() bankName?: string; @IsOptional() @IsString() iban?: string;
  @IsMoney() basicSalary: string;
}
class UpdateEmployeeDto {
  @IsOptional() @IsString() @Length(2, 160) name?: string; @IsOptional() @IsEmail() email?: string; @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsUUID() departmentId?: string; @IsOptional() @IsUUID() designationId?: string; @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsString() bankName?: string; @IsOptional() @IsString() iban?: string; @IsOptional() @IsMoney() basicSalary?: string;
  @IsOptional() @IsBoolean() isActive?: boolean; @IsOptional() @Matches(IsoDate) terminatedAt?: string;
}
class NameDto { @IsString() @Length(2, 80) name: string }
class ComponentDto { @IsString() @Length(2, 80) name: string; @IsIn(['ALLOWANCE', 'DEDUCTION']) type: string; @IsIn(['FIXED', 'PERCENT_OF_BASIC']) calc: string }
class SalaryItemDto { @IsUUID() componentId: string; @IsMoney() value: string }
class SalaryItemsDto { @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => SalaryItemDto) items: SalaryItemDto[] }
class AttendanceDto { @IsUUID() employeeId: string; @Matches(IsoDate) date: string; @IsIn(['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY', 'HOLIDAY']) status: string; @IsOptional() @IsString() checkIn?: string; @IsOptional() @IsString() checkOut?: string }
class LeaveTypeDto { @IsString() @Length(2, 60) name: string; @IsInt() @Min(0) daysPerYear: number; @IsBoolean() isPaid: boolean }
class LeaveDto { @IsOptional() @IsUUID() employeeId?: string; @IsUUID() leaveTypeId: string; @Matches(IsoDate) fromDate: string; @Matches(IsoDate) toDate: string; @IsOptional() @IsString() reason?: string }
class DocDto { @IsString() docType: string; @IsString() @Length(2, 160) title: string; @IsOptional() @IsUUID() attachmentId?: string; @IsOptional() @Matches(IsoDate) expiryDate?: string }
class RunDto { @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period: string }
class PayDto { @IsUUID() accountId: string; @Matches(IsoDate) date: string }

const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;

@Controller('hr')
export class HrController {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private notes: NotificationsService, private vouchers: VouchersService, private sys: SystemAccountsService) {}

  // ------------------------------------------------------------------ masters
  @Get('departments') @RequirePermission('hr', 'view') departments(@CurrentUser() u: AuthUser) { return this.prisma.tenant(u.companyId, (tx) => tx.department.findMany({ orderBy: { name: 'asc' } })); }
  @Post('departments') @RequirePermission('hr', 'create') addDepartment(@CurrentUser() u: AuthUser, @Body() d: NameDto) { return this.prisma.tenant(u.companyId, (tx) => tx.department.create({ data: { ...d, companyId: u.companyId } })); }
  @Get('designations') @RequirePermission('hr', 'view') designations(@CurrentUser() u: AuthUser) { return this.prisma.tenant(u.companyId, (tx) => tx.designation.findMany({ orderBy: { name: 'asc' } })); }
  @Post('designations') @RequirePermission('hr', 'create') addDesignation(@CurrentUser() u: AuthUser, @Body() d: NameDto) { return this.prisma.tenant(u.companyId, (tx) => tx.designation.create({ data: { ...d, companyId: u.companyId } })); }
  @Get('salary-components') @RequirePermission('hr', 'view') components(@CurrentUser() u: AuthUser) { return this.prisma.tenant(u.companyId, (tx) => tx.salaryComponent.findMany({ orderBy: { name: 'asc' } })); }
  @Post('salary-components') @RequirePermission('hr', 'create') addComponent(@CurrentUser() u: AuthUser, @Body() d: ComponentDto) { return this.prisma.tenant(u.companyId, (tx) => tx.salaryComponent.create({ data: { ...d, companyId: u.companyId } })); }
  @Get('leave-types') @RequirePermission('hr', 'view') leaveTypes(@CurrentUser() u: AuthUser) { return this.prisma.tenant(u.companyId, (tx) => tx.leaveType.findMany({ orderBy: { name: 'asc' } })); }
  @Post('leave-types') @RequirePermission('hr', 'create') addLeaveType(@CurrentUser() u: AuthUser, @Body() d: LeaveTypeDto) { return this.prisma.tenant(u.companyId, (tx) => tx.leaveType.create({ data: { ...d, companyId: u.companyId } })); }

  // ------------------------------------------------------------------ employees
  private presentEmp(e: any) { return { ...e, basicSalary: fmt(e.basicSalary), joinDate: isoDate(e.joinDate), dateOfBirth: e.dateOfBirth ? isoDate(e.dateOfBirth) : null, terminatedAt: e.terminatedAt ? isoDate(e.terminatedAt) : null }; }

  @Get('employees') @RequirePermission('hr', 'view')
  employees(@CurrentUser() u: AuthUser, @Query('search') search?: string, @Query('departmentId') departmentId?: string, @Query('active') active?: string, @Query('page') pageQ?: string) {
    const page = Math.max(1, Number(pageQ) || 1), pageSize = 50;
    const where: any = { ...(departmentId ? { departmentId } : {}), ...(active !== undefined ? { isActive: active === 'true' } : {}), ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] } : {}) };
    return this.prisma.tenant(u.companyId, async (tx) => { const [t, r] = await Promise.all([tx.employee.count({ where }), tx.employee.findMany({ where, orderBy: { code: 'asc' }, skip: (page - 1) * pageSize, take: pageSize })]); return paged(r.map((e) => this.presentEmp(e)), page, pageSize, t); });
  }

  @Post('employees') @RequirePermission('hr', 'create')
  createEmployee(@CurrentUser() u: AuthUser, @Body() d: EmployeeDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const code = `E${this.seq.pad(await this.seq.nextGlobal(tx, u.companyId, 'EMPLOYEE'), 4)}`;
      const e = await tx.employee.create({ data: { ...d, companyId: u.companyId, code, joinDate: parseDate(d.joinDate), dateOfBirth: d.dateOfBirth ? parseDate(d.dateOfBirth) : null } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'employee.created', entityType: 'employee', entityId: e.id, after: { code, name: d.name } });
      return this.presentEmp(e);
    });
  }

  @Get('employees/:id') @RequirePermission('hr', 'view')
  employee(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => ({ ...this.presentEmp(await tx.employee.findUniqueOrThrow({ where: { id }, include: { salaryItems: { include: { component: true } } } })), documents: await tx.employeeDocument.findMany({ where: { employeeId: id } }) }));
  }

  @Patch('employees/:id') @RequirePermission('hr', 'edit')
  updateEmployee(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: UpdateEmployeeDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const before = await tx.employee.findUniqueOrThrow({ where: { id } });
      const after = await tx.employee.update({ where: { id }, data: { ...d, terminatedAt: d.terminatedAt ? parseDate(d.terminatedAt) : undefined } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'employee.updated', entityType: 'employee', entityId: id, before: { ...before, iban: undefined }, after: { ...d, iban: undefined } });
      return this.presentEmp(after);
    });
  }

  @Put('employees/:id/salary-items') @RequirePermission('hr', 'edit')
  setSalary(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: SalaryItemsDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      await tx.employee.findUniqueOrThrow({ where: { id } });
      await tx.employeeSalaryItem.deleteMany({ where: { employeeId: id } });
      await tx.employeeSalaryItem.createMany({ data: d.items.map((i) => ({ companyId: u.companyId, employeeId: id, componentId: i.componentId, value: i.value })) });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'employee.salary_structure_changed', entityType: 'employee', entityId: id, after: d.items });
      return { saved: d.items.length };
    });
  }

  @Post('employees/:id/documents') @RequirePermission('hr', 'create')
  addDocument(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: DocDto) { return this.prisma.tenant(u.companyId, (tx) => tx.employeeDocument.create({ data: { ...d, companyId: u.companyId, employeeId: id, expiryDate: d.expiryDate ? parseDate(d.expiryDate) : null } })); }

  // ------------------------------------------------------------------ attendance
  @Put('attendance') @RequirePermission('hr', 'edit')
  mark(@CurrentUser() u: AuthUser, @Body() d: AttendanceDto) {
    const date = parseDate(d.date);
    return this.prisma.tenant(u.companyId, (tx) => tx.attendance.upsert({ where: { employeeId_date: { employeeId: d.employeeId, date } }, create: { companyId: u.companyId, employeeId: d.employeeId, date, status: d.status, checkIn: d.checkIn, checkOut: d.checkOut }, update: { status: d.status, checkIn: d.checkIn, checkOut: d.checkOut } }));
  }
  @Get('attendance') @RequirePermission('hr', 'view')
  attendance(@CurrentUser() u: AuthUser, @Query('from') from: string, @Query('to') to: string, @Query('employeeId') employeeId?: string) {
    return this.prisma.tenant(u.companyId, async (tx) => (await tx.attendance.findMany({ where: { date: { gte: parseDate(from, 'from'), lte: parseDate(to, 'to') }, ...(employeeId ? { employeeId } : {}) }, orderBy: [{ date: 'asc' }] })).map((a) => ({ ...a, date: isoDate(a.date) })));
  }

  // ------------------------------------------------------------------ leave
  private async myEmployee(tx: Tx, userId: string) { const e = await tx.employee.findFirst({ where: { userId } }); if (!e) throw new BadRequestException('Your user is not linked to an employee record'); return e; }

  @Post('leave') @RequirePermission('hr', 'view')
  requestLeave(@CurrentUser() u: AuthUser, @Body() d: LeaveDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const from = parseDate(d.fromDate), to = parseDate(d.toDate);
      if (to < from) throw new BadRequestException('toDate precedes fromDate');
      let employeeId = d.employeeId;
      if (employeeId && !(await this.canManage(tx, u.userId))) { const me = await this.myEmployee(tx, u.userId); if (me.id !== employeeId) throw new ForbiddenException('You can only request leave for yourself'); }
      employeeId = employeeId ?? (await this.myEmployee(tx, u.userId)).id;
      const type = await tx.leaveType.findUniqueOrThrow({ where: { id: d.leaveTypeId } });
      const days = daysBetween(from, to);
      if (type.daysPerYear > 0) {
        const year = from.getUTCFullYear();
        const used = await tx.leaveRequest.aggregate({ where: { employeeId, leaveTypeId: type.id, status: 'APPROVED', fromDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } }, _sum: { days: true } });
        if (D(used._sum.days).add(days).gt(type.daysPerYear)) throw new BadRequestException(`Exceeds the ${type.daysPerYear}-day ${type.name} allowance (${D(used._sum.days)} used)`);
      }
      const overlap = await tx.leaveRequest.count({ where: { employeeId, status: { in: ['PENDING', 'APPROVED'] }, fromDate: { lte: to }, toDate: { gte: from } } });
      if (overlap) throw new ConflictException('Overlaps an existing leave request');
      const r = await tx.leaveRequest.create({ data: { companyId: u.companyId, employeeId, leaveTypeId: type.id, fromDate: from, toDate: to, days, reason: d.reason } });
      await this.notes.notify(tx, u.companyId, await this.notes.usersWith(tx, 'hr', 'approve'), 'Leave request pending', `${days} day(s) ${type.name}`, `/hr/leave/${r.id}`);
      return r;
    });
  }
  private async canManage(tx: Tx, userId: string) { return (await tx.rolePermission.count({ where: { role: { users: { some: { userId } } }, permission: { resource: 'hr', action: 'edit' } } })) > 0; }

  @Get('leave') @RequirePermission('hr', 'view')
  leaveList(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('mine') mine?: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const where: any = { ...(status ? { status } : {}) };
      if (mine === 'true' || !(await this.canManage(tx, u.userId))) { const me = await tx.employee.findFirst({ where: { userId: u.userId } }); where.employeeId = me?.id ?? '00000000-0000-0000-0000-000000000000'; }
      return (await tx.leaveRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 })).map((r) => ({ ...r, fromDate: isoDate(r.fromDate), toDate: isoDate(r.toDate), days: r.days.toString() }));
    });
  }

  @Get('leave/balance/:employeeId') @RequirePermission('hr', 'view')
  leaveBalance(@CurrentUser() u: AuthUser, @Param('employeeId', ParseUUIDPipe) employeeId: string, @Query('year') year?: string) {
    const y = Number(year) || new Date().getUTCFullYear();
    return this.prisma.tenant(u.companyId, async (tx) => {
      const types = await tx.leaveType.findMany();
      return Promise.all(types.map(async (t) => { const used = await tx.leaveRequest.aggregate({ where: { employeeId, leaveTypeId: t.id, status: 'APPROVED', fromDate: { gte: new Date(Date.UTC(y, 0, 1)), lte: new Date(Date.UTC(y, 11, 31)) } }, _sum: { days: true } }); return { leaveType: t.name, allowance: t.daysPerYear, used: D(used._sum.days).toString(), remaining: t.daysPerYear ? String(t.daysPerYear - D(used._sum.days).toNumber()) : 'n/a' }; }));
    });
  }

  private decide(u: AuthUser, id: string, status: 'APPROVED' | 'REJECTED' | 'CANCELLED') {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const r = await tx.leaveRequest.findUniqueOrThrow({ where: { id } });
      if (status === 'CANCELLED') { const me = await tx.employee.findFirst({ where: { userId: u.userId } }); if (me?.id !== r.employeeId && !(await this.canManage(tx, u.userId))) throw new ForbiddenException(); if (!['PENDING', 'APPROVED'].includes(r.status)) throw new ConflictException(`Cannot cancel a ${r.status} request`); }
      else { if (r.status !== 'PENDING') throw new ConflictException(`Request is ${r.status}`); const me = await tx.employee.findFirst({ where: { userId: u.userId } }); if (me?.id === r.employeeId) throw new ForbiddenException('You cannot decide your own leave request'); }
      await tx.leaveRequest.update({ where: { id }, data: { status, decidedBy: u.userId, decidedAt: new Date() } });
      if (status === 'APPROVED') for (let d = r.fromDate; d <= r.toDate; d = new Date(d.getTime() + 86_400_000)) await tx.attendance.upsert({ where: { employeeId_date: { employeeId: r.employeeId, date: d } }, create: { companyId: u.companyId, employeeId: r.employeeId, date: d, status: 'LEAVE' }, update: { status: 'LEAVE' } });
      const emp = await tx.employee.findUnique({ where: { id: r.employeeId } });
      if (emp?.userId) await this.notes.notify(tx, u.companyId, [emp.userId], `Leave request ${status.toLowerCase()}`, `${isoDate(r.fromDate)} - ${isoDate(r.toDate)}`, `/hr/leave/${id}`);
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: `leave.${status.toLowerCase()}`, entityType: 'leave_request', entityId: id });
      return { status };
    });
  }
  @Post('leave/:id/approve') @HttpCode(200) @RequirePermission('hr', 'approve') approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.decide(u, id, 'APPROVED'); }
  @Post('leave/:id/reject') @HttpCode(200) @RequirePermission('hr', 'approve') reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.decide(u, id, 'REJECTED'); }
  @Post('leave/:id/cancel') @HttpCode(200) @RequirePermission('hr', 'view') cancelLeave(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.decide(u, id, 'CANCELLED'); }

  // ------------------------------------------------------------------ payroll
  @Get('payroll') @RequirePermission('hr', 'view')
  runs(@CurrentUser() u: AuthUser) { return this.prisma.tenant(u.companyId, async (tx) => (await tx.payrollRun.findMany({ orderBy: { period: 'desc' } })).map((r) => ({ ...r, totalGross: fmt(r.totalGross), totalDeduction: fmt(r.totalDeduction), totalNet: fmt(r.totalNet) }))); }

  @Get('payroll/:id') @RequirePermission('hr', 'view')
  run(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const r = await tx.payrollRun.findUniqueOrThrow({ where: { id }, include: { payslips: true } });
      const emps = new Map((await tx.employee.findMany({ where: { id: { in: r.payslips.map((p) => p.employeeId) } } })).map((e) => [e.id, e]));
      return { ...r, totalGross: fmt(r.totalGross), totalDeduction: fmt(r.totalDeduction), totalNet: fmt(r.totalNet), payslips: r.payslips.map((p) => ({ ...p, employee: emps.get(p.employeeId)?.name, code: emps.get(p.employeeId)?.code, basic: fmt(p.basic), allowances: fmt(p.allowances), deductions: fmt(p.deductions), gross: fmt(p.gross), net: fmt(p.net), unpaidDays: p.unpaidDays.toString() })) };
    });
  }

  @Post('payroll/generate') @RequirePermission('hr', 'create')
  generate(@CurrentUser() u: AuthUser, @Body() d: RunDto) {
    const [y, m] = d.period.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1)), end = new Date(Date.UTC(y, m, 0));
    return this.prisma.tenant(u.companyId, async (tx) => {
      const old = await tx.payrollRun.findUnique({ where: { companyId_period: { companyId: u.companyId, period: d.period } } });
      if (old && old.status !== 'DRAFT' && old.status !== 'CANCELLED') throw new ConflictException(`Payroll for ${d.period} is already ${old.status}`);
      if (old) await tx.payrollRun.delete({ where: { id: old.id } });
      const emps = await tx.employee.findMany({ where: { isActive: true, joinDate: { lte: end }, OR: [{ terminatedAt: null }, { terminatedAt: { gte: start } }] }, include: { salaryItems: { include: { component: true } } } });
      if (!emps.length) throw new BadRequestException('No active employees');
      const unpaidTypes = new Set((await tx.leaveType.findMany({ where: { isPaid: false } })).map((t) => t.id));
      let tg = ZERO, td = ZERO, tn = ZERO; const slips: any[] = [];
      for (const e of emps) {
        // pro-rata for employees who joined / left part-way through the month (calendar days)
        const monthDays = end.getUTCDate();
        const empFrom = e.joinDate > start ? e.joinDate : start;
        const empTo = e.terminatedAt && e.terminatedAt < end ? e.terminatedAt : end;
        const empDays = Math.max(0, daysBetween(empFrom, empTo));
        const prorated = empDays < monthDays;
        const factor = D(empDays).div(monthDays);
        const basicPaid = prorated ? round(e.basicSalary.mul(factor), 2) : e.basicSalary;
        const items: Array<{ name: string; type: string; amount: any }> = e.salaryItems.filter((i) => i.component.isActive).map((i) => {
          const full = i.component.calc === 'PERCENT_OF_BASIC' ? basicPaid.mul(i.value).div(100) : i.component.type === 'ALLOWANCE' && prorated ? i.value.mul(factor) : i.value;
          return { name: i.component.name, type: i.component.type, amount: round(full, 2) };
        });
        if (prorated) items.push({ name: `Pro-rata ${empDays}/${monthDays} days`, type: 'INFO', amount: ZERO });
        const allowances = items.filter((i) => i.type === 'ALLOWANCE').reduce((s, i) => s.add(i.amount), ZERO);
        let deductions = items.filter((i) => i.type === 'DEDUCTION').reduce((s, i) => s.add(i.amount), ZERO);
        const att = await tx.attendance.findMany({ where: { employeeId: e.id, date: { gte: start, lte: end } } });
        let unpaid = ZERO;
        for (const a of att) if (a.status === 'ABSENT') unpaid = unpaid.add(1); else if (a.status === 'HALF_DAY') unpaid = unpaid.add(0.5);
        const leaves = await tx.leaveRequest.findMany({ where: { employeeId: e.id, status: 'APPROVED', leaveTypeId: { in: [...unpaidTypes] }, fromDate: { lte: end }, toDate: { gte: start } } });
        for (const l of leaves) unpaid = unpaid.add(daysBetween(l.fromDate > start ? l.fromDate : start, l.toDate < end ? l.toDate : end));
        const unpaidAmt = round(e.basicSalary.div(30).mul(unpaid), 2);
        if (unpaidAmt.gt(0)) { items.push({ name: `Unpaid days (${unpaid})`, type: 'DEDUCTION', amount: unpaidAmt }); deductions = deductions.add(unpaidAmt); }
        const gross = basicPaid.add(allowances), net = gross.sub(deductions);
        if (net.lt(0)) throw new BadRequestException(`${e.name}: deductions exceed gross pay`);
        tg = tg.add(gross); td = td.add(deductions); tn = tn.add(net);
        slips.push({ companyId: u.companyId, employeeId: e.id, basic: basicPaid, allowances, deductions, unpaidDays: unpaid, gross, net, details: items.map((i) => ({ ...i, amount: i.amount.toString() })) });
      }
      const run = await tx.payrollRun.create({ data: { companyId: u.companyId, period: d.period, totalGross: tg, totalDeduction: td, totalNet: tn, createdBy: u.userId, payslips: { create: slips } } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'payroll.generated', entityType: 'payroll_run', entityId: run.id, after: { period: d.period, net: tn.toString() } });
      return { id: run.id, period: d.period, employees: emps.length, totalGross: fmt(tg), totalDeduction: fmt(td), totalNet: fmt(tn) };
    });
  }

  private async lockRun(tx: Tx, id: string) { await tx.$queryRaw`SELECT id FROM payroll_runs WHERE id = ${id}::uuid FOR UPDATE`; return tx.payrollRun.findUniqueOrThrow({ where: { id } }); }

  @Post('payroll/:id/approve') @HttpCode(200) @RequirePermission('hr', 'approve')
  approveRun(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => { const r = await this.lockRun(tx, id); if (r.status !== 'DRAFT') throw new ConflictException(`Run is ${r.status}`); if (r.createdBy === u.userId) { const s = await tx.companySetting.findUniqueOrThrow({ where: { companyId: u.companyId } }); if (!s.allowSelfApproval) throw new ForbiddenException('Segregation of duties: another user must approve payroll'); } await tx.payrollRun.update({ where: { id }, data: { status: 'APPROVED' } }); await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'payroll.approved', entityType: 'payroll_run', entityId: id }); return { status: 'APPROVED' }; });
  }

  /** Dr Payroll Expense (gross) / Cr Salaries Payable (net) / Cr Employee Deductions Payable. */
  @Post('payroll/:id/post') @HttpCode(200) @RequirePermission('hr', 'post')
  postRun(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const r = await this.lockRun(tx, id);
      if (r.status !== 'APPROVED') throw new ConflictException('Payroll must be approved before posting');
      const [y, m] = r.period.split('-').map(Number); const date = isoDate(new Date(Date.UTC(y, m, 0)));
      const v = await this.vouchers.create(u.companyId, u.userId, { type: 'JOURNAL', date, reference: `PAYROLL-${r.period}`, narration: `Payroll ${r.period}`, lines: [
        { accountId: await this.sys.get(tx, u.companyId, 'PAYROLL_EXPENSE'), debit: r.totalGross.toString() },
        { accountId: await this.sys.get(tx, u.companyId, 'SALARIES_PAYABLE'), credit: r.totalNet.toString() },
        ...(r.totalDeduction.gt(0) ? [{ accountId: await this.sys.get(tx, u.companyId, 'DEDUCTIONS_PAYABLE'), credit: r.totalDeduction.toString() }] : []),
      ] }, undefined, tx);
      await this.vouchers.post(u.companyId, u.userId, v.id, tx);
      await tx.payrollRun.update({ where: { id }, data: { status: 'POSTED', voucherId: v.id } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'payroll.posted', entityType: 'payroll_run', entityId: id, after: { voucher: v.number } });
      return { status: 'POSTED', voucher: v.number };
    });
  }

  @Post('payroll/:id/pay') @HttpCode(200) @RequirePermission('hr', 'post')
  payRun(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: PayDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const r = await this.lockRun(tx, id);
      if (r.status !== 'POSTED') throw new ConflictException('Payroll must be posted before payment');
      const bank = await tx.account.findUniqueOrThrow({ where: { id: d.accountId } });
      if (!['CASH', 'BANK'].includes(bank.type)) throw new BadRequestException('accountId must be a cash/bank ledger');
      const v = await this.vouchers.create(u.companyId, u.userId, { type: 'PAYMENT', date: d.date, reference: `SALARY-${r.period}`, narration: `Salaries ${r.period}`, lines: [{ accountId: await this.sys.get(tx, u.companyId, 'SALARIES_PAYABLE'), debit: r.totalNet.toString() }, { accountId: d.accountId, credit: r.totalNet.toString() }] }, undefined, tx);
      await this.vouchers.post(u.companyId, u.userId, v.id, tx);
      await tx.payrollRun.update({ where: { id }, data: { status: 'PAID', payVoucherId: v.id } });
      return { status: 'PAID', voucher: v.number };
    });
  }

  @Post('payroll/:id/cancel') @HttpCode(200) @RequirePermission('hr', 'cancel')
  cancelRun(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const r = await this.lockRun(tx, id);
      if (r.status === 'PAID' || r.status === 'CANCELLED') throw new ConflictException(`Run is ${r.status}`);
      if (r.status === 'POSTED') await this.vouchers.cancel(u.companyId, u.userId, r.voucherId!, `Payroll ${r.period} cancelled`, undefined, tx);
      await tx.payrollRun.update({ where: { id }, data: { status: 'CANCELLED' } });
      return { status: 'CANCELLED' };
    });
  }

  @Delete('employees/:id') @RequirePermission('hr', 'delete')
  removeEmployee(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => { if (await tx.payslip.count({ where: { employeeId: id } })) throw new BadRequestException('Employee has payroll history; deactivate instead'); await tx.employee.delete({ where: { id } }); return { deleted: true }; });
  }
}
