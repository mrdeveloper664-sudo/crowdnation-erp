import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { PartialType } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { isoDate, parseDate } from '../common/dates';
import { D, ZERO, fmt } from '../common/money';
import { NotificationsService } from '../common/notifications.service';
import { PrismaService, Tx } from '../common/prisma.service';
import { IsMoney, IsoDate } from '../common/validators';
import { SequenceService } from '../accounting/sequence.service';

class ProjectDto {
  @IsString() @Length(2, 160) name: string; @IsOptional() @IsString() @Length(1, 20) code?: string; @IsOptional() @IsUUID() customerId?: string; @IsOptional() @IsUUID() managerId?: string;
  @IsOptional() @IsIn(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']) status?: string;
  @IsOptional() @Matches(IsoDate) startDate?: string; @IsOptional() @Matches(IsoDate) endDate?: string;
  @IsOptional() @IsMoney() budgetRevenue?: string; @IsOptional() @IsMoney() budgetCost?: string; @IsOptional() @IsString() description?: string;
}
class TaskDto {
  @IsString() @Length(2, 200) title: string; @IsOptional() @IsString() description?: string; @IsOptional() @IsUUID() assigneeId?: string;
  @IsOptional() @IsIn(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']) status?: string; @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH']) priority?: string;
  @IsOptional() @Matches(IsoDate) dueDate?: string; @IsOptional() @Matches(/^\d{1,6}(\.\d{1,2})?$/) estimatedHours?: string;
}
class UpdateTaskDto extends PartialType(TaskDto) {}
class MemberDto { @IsUUID() userId: string; @IsOptional() @IsString() role?: string }

export async function projectFinancials(tx: Tx, companyId: string, projectId: string) {
  const docs = await tx.document.findMany({ where: { companyId, projectId, status: 'POSTED', type: { in: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] } }, select: { side: true, type: true, net: true, exchangeRate: true } });
  let income = ZERO, cost = ZERO;
  for (const d of docs) {
    const base = d.net.mul(d.exchangeRate);
    if (d.side === 'SALES') income = d.type === 'INVOICE' ? income.add(base) : income.sub(base);
    else cost = d.type === 'INVOICE' ? cost.add(base) : cost.sub(base);
  }
  const exp = await tx.expense.aggregate({ where: { companyId, projectId, status: { in: ['POSTED', 'REIMBURSED'] } }, _sum: { net: true } });
  cost = cost.add(D(exp._sum.net));
  return { income, cost, profit: income.sub(cost) };
}

@Controller('projects')
export class ProjectsController {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private notes: NotificationsService) {}

  private async progress(tx: Tx, projectId: string) {
    const tasks = await tx.projectTask.findMany({ where: { projectId } });
    if (!tasks.length) return 0;
    const weight = (t: any) => (D(t.estimatedHours).gt(0) ? D(t.estimatedHours) : D(1));
    const total = tasks.reduce((s, t) => s.add(weight(t)), ZERO), done = tasks.filter((t) => t.status === 'DONE').reduce((s, t) => s.add(weight(t)), ZERO);
    return Math.round(done.div(total).mul(100).toNumber());
  }
  private present(p: any, extra: object = {}) { return { ...p, startDate: p.startDate ? isoDate(p.startDate) : null, endDate: p.endDate ? isoDate(p.endDate) : null, budgetRevenue: fmt(p.budgetRevenue), budgetCost: fmt(p.budgetCost), ...extra }; }

  @Get() @RequirePermission('project', 'view')
  list(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('search') search?: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const rows = await tx.project.findMany({ where: { ...(status ? { status } : {}), ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}) }, orderBy: { code: 'asc' } });
      return Promise.all(rows.map(async (p) => this.present(p, { progress: await this.progress(tx, p.id) })));
    });
  }

  @Post() @RequirePermission('project', 'create')
  create(@CurrentUser() u: AuthUser, @Body() d: ProjectDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const code = d.code ?? `PRJ-${this.seq.pad(await this.seq.nextGlobal(tx, u.companyId, 'PROJECT'), 4)}`;
      const p = await tx.project.create({ data: { ...d, code, companyId: u.companyId, startDate: d.startDate ? parseDate(d.startDate) : null, endDate: d.endDate ? parseDate(d.endDate) : null } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'project.created', entityType: 'project', entityId: p.id, after: p });
      return this.present(p);
    });
  }

  @Get(':id') @RequirePermission('project', 'view')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const p = await tx.project.findUniqueOrThrow({ where: { id }, include: { members: true } });
      const f = await projectFinancials(tx, u.companyId, id);
      return this.present(p, { progress: await this.progress(tx, id), income: fmt(f.income), cost: fmt(f.cost), profit: fmt(f.profit), margin: f.income.isZero() ? null : f.profit.div(f.income).mul(100).toFixed(1) + '%', budgetCostUsed: p.budgetCost.isZero() ? null : f.cost.div(p.budgetCost).mul(100).toFixed(1) + '%' });
    });
  }

  @Patch(':id') @RequirePermission('project', 'edit')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: ProjectDto) {
    return this.prisma.tenant(u.companyId, async (tx) => this.present(await tx.project.update({ where: { id }, data: { ...d, startDate: d.startDate ? parseDate(d.startDate) : undefined, endDate: d.endDate ? parseDate(d.endDate) : undefined } })));
  }

  @Post(':id/members') @HttpCode(200) @RequirePermission('project', 'edit')
  addMember(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: MemberDto) {
    return this.prisma.tenant(u.companyId, async (tx) => { const m = await tx.projectMember.upsert({ where: { projectId_userId: { projectId: id, userId: d.userId } }, create: { companyId: u.companyId, projectId: id, userId: d.userId, role: d.role ?? 'MEMBER' }, update: { role: d.role ?? 'MEMBER' } }); await this.notes.notify(tx, u.companyId, [d.userId], 'Added to a project', undefined, `/projects/${id}`); return m; });
  }
  @Delete(':id/members/:userId') @RequirePermission('project', 'edit')
  removeMember(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) { return this.prisma.tenant(u.companyId, async (tx) => { await tx.projectMember.deleteMany({ where: { projectId: id, userId } }); return { removed: true }; }); }

  @Get(':id/tasks') @RequirePermission('project', 'view')
  tasks(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.prisma.tenant(u.companyId, async (tx) => (await tx.projectTask.findMany({ where: { projectId: id }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] })).map((t) => ({ ...t, dueDate: t.dueDate ? isoDate(t.dueDate) : null, estimatedHours: t.estimatedHours.toString() }))); }

  @Post(':id/tasks') @RequirePermission('project', 'create')
  addTask(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: TaskDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      await tx.project.findUniqueOrThrow({ where: { id } });
      const t = await tx.projectTask.create({ data: { ...d, companyId: u.companyId, projectId: id, dueDate: d.dueDate ? parseDate(d.dueDate) : null } });
      if (d.assigneeId && d.assigneeId !== u.userId) await this.notes.notify(tx, u.companyId, [d.assigneeId], 'Task assigned', d.title, `/projects/${id}`);
      return t;
    });
  }

  @Patch('tasks/:taskId') @RequirePermission('project', 'edit')
  updateTask(@CurrentUser() u: AuthUser, @Param('taskId', ParseUUIDPipe) taskId: string, @Body() d: UpdateTaskDto) {
    return this.prisma.tenant(u.companyId, (tx) => tx.projectTask.update({ where: { id: taskId }, data: { ...d, dueDate: d.dueDate ? parseDate(d.dueDate) : undefined } }));
  }
  @Delete('tasks/:taskId') @RequirePermission('project', 'delete')
  deleteTask(@CurrentUser() u: AuthUser, @Param('taskId', ParseUUIDPipe) taskId: string) { return this.prisma.tenant(u.companyId, async (tx) => { await tx.projectTask.delete({ where: { id: taskId } }); return { deleted: true }; }); }
}
