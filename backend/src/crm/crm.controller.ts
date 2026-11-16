import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsEmail, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { isoDate, parseDate } from '../common/dates';
import { paged } from '../common/interceptors/response.interceptor';
import { fmt } from '../common/money';
import { NotificationsService } from '../common/notifications.service';
import { PrismaService } from '../common/prisma.service';
import { IsMoney, IsoDate } from '../common/validators';
import { SequenceService } from '../accounting/sequence.service';

export const STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];
class LeadDto {
  @IsString() @Length(2, 160) name: string;
  @IsOptional() @IsString() companyName?: string; @IsOptional() @IsEmail() email?: string; @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsUUID() sourceId?: string; @IsOptional() @IsMoney() value?: string; @IsOptional() @Matches(IsoDate) expectedClose?: string;
  @IsOptional() @IsUUID() assignedTo?: string; @IsOptional() @IsString() notes?: string;
}
class StageDto { @IsIn(STAGES) stage: string; @IsOptional() @IsString() lostReason?: string }
class AssignDto { @IsUUID() userId: string }
class ActivityDto {
  @IsOptional() @IsUUID() leadId?: string; @IsOptional() @IsUUID() partyId?: string;
  @IsIn(['CALL', 'EMAIL', 'MEETING', 'NOTE', 'TASK']) type: string;
  @IsString() @Length(2, 200) subject: string; @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() dueAt?: string; @IsOptional() @IsUUID() assignedTo?: string;
}
class ContactDto { @IsString() @Length(2, 120) name: string; @IsOptional() @IsUUID() partyId?: string; @IsOptional() @IsUUID() leadId?: string; @IsOptional() @IsEmail() email?: string; @IsOptional() @IsString() phone?: string; @IsOptional() @IsString() designation?: string }

@Controller('crm')
export class CrmController {
  constructor(private prisma: PrismaService, private audit: AuditService, private notes: NotificationsService, private seq: SequenceService) {}

  @Get('sources') @RequirePermission('crm', 'view') sources(@CurrentUser() u: AuthUser) { return this.prisma.tenant(u.companyId, (tx) => tx.leadSource.findMany({ orderBy: { name: 'asc' } })); }
  @Post('sources') @RequirePermission('crm', 'create') addSource(@CurrentUser() u: AuthUser, @Body('name') name: string) { return this.prisma.tenant(u.companyId, (tx) => tx.leadSource.create({ data: { companyId: u.companyId, name } })); }

  @Get('leads') @RequirePermission('crm', 'view')
  leads(@CurrentUser() u: AuthUser, @Query() q: any) {
    const page = Math.max(1, Number(q.page) || 1), pageSize = Math.min(200, Number(q.pageSize) || 50);
    const where: any = { ...(q.stage ? { stage: q.stage } : {}), ...(q.assignedTo ? { assignedTo: q.assignedTo } : {}), ...(q.sourceId ? { sourceId: q.sourceId } : {}), ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { companyName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] } : {}) };
    return this.prisma.tenant(u.companyId, async (tx) => {
      const [total, rows] = await Promise.all([tx.lead.count({ where }), tx.lead.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })]);
      return paged(rows.map((l) => ({ ...l, value: fmt(l.value), expectedClose: l.expectedClose ? isoDate(l.expectedClose) : null })), page, pageSize, total);
    });
  }

  @Post('leads') @RequirePermission('crm', 'create')
  createLead(@CurrentUser() u: AuthUser, @Body() d: LeadDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const l = await tx.lead.create({ data: { ...d, companyId: u.companyId, expectedClose: d.expectedClose ? parseDate(d.expectedClose) : null, createdBy: u.userId } });
      if (d.assignedTo && d.assignedTo !== u.userId) await this.notes.notify(tx, u.companyId, [d.assignedTo], 'New lead assigned', l.name, `/crm/leads/${l.id}`);
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'lead.created', entityType: 'lead', entityId: l.id, after: d });
      return l;
    });
  }

  @Get('leads/:id') @RequirePermission('crm', 'view')
  lead(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => ({ ...(await tx.lead.findUniqueOrThrow({ where: { id } })), activities: await tx.activity.findMany({ where: { leadId: id }, orderBy: { activityDate: 'desc' } }), contacts: await tx.contact.findMany({ where: { leadId: id } }) }));
  }

  @Patch('leads/:id') @RequirePermission('crm', 'edit')
  updateLead(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: LeadDto) {
    return this.prisma.tenant(u.companyId, (tx) => tx.lead.update({ where: { id }, data: { ...d, expectedClose: d.expectedClose ? parseDate(d.expectedClose) : undefined } }));
  }

  @Post('leads/:id/assign') @HttpCode(200) @RequirePermission('crm', 'edit')
  assign(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: AssignDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      if (!(await tx.user.findUnique({ where: { id: d.userId } }))) throw new BadRequestException('User not found');
      const l = await tx.lead.update({ where: { id }, data: { assignedTo: d.userId } });
      await this.notes.notify(tx, u.companyId, [d.userId], 'Lead assigned to you', l.name, `/crm/leads/${id}`);
      return { assignedTo: d.userId };
    });
  }

  @Post('leads/:id/stage') @HttpCode(200) @RequirePermission('crm', 'edit')
  stage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: StageDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const l = await tx.lead.findUniqueOrThrow({ where: { id } });
      if (l.convertedPartyId) throw new BadRequestException('Lead is already converted');
      if (d.stage === 'LOST' && !d.lostReason) throw new BadRequestException('lostReason is required');
      await tx.lead.update({ where: { id }, data: { stage: d.stage, lostReason: d.lostReason } });
      await tx.activity.create({ data: { companyId: u.companyId, leadId: id, type: 'NOTE', subject: `Stage changed ${l.stage} → ${d.stage}`, createdBy: u.userId } });
      return { stage: d.stage };
    });
  }

  /** Converts a lead into a customer (with its ledger account) and marks it WON. */
  @Post('leads/:id/convert') @HttpCode(200) @RequirePermission('crm', 'edit')
  convert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const l = await tx.lead.findUniqueOrThrow({ where: { id } });
      if (l.convertedPartyId) throw new BadRequestException('Lead is already converted');
      const n = await this.seq.nextGlobal(tx, u.companyId, 'PARTY:CUSTOMER');
      const code = `C${this.seq.pad(n)}`;
      const group = await tx.accountGroup.findFirstOrThrow({ where: { companyId: u.companyId, code: '1120' } });
      const name = l.companyName || l.name;
      const account = await tx.account.create({ data: { companyId: u.companyId, groupId: group.id, code, name, type: 'CUSTOMER' } });
      const party = await tx.party.create({ data: { companyId: u.companyId, kind: 'CUSTOMER', code, name, email: l.email, phone: l.phone, contactPerson: l.companyName ? l.name : null, accountId: account.id } });
      await tx.lead.update({ where: { id }, data: { convertedPartyId: party.id, stage: 'WON' } });
      await tx.contact.create({ data: { companyId: u.companyId, partyId: party.id, name: l.name, email: l.email, phone: l.phone } });
      await tx.activity.updateMany({ where: { leadId: id }, data: { partyId: party.id } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'lead.converted', entityType: 'lead', entityId: id, after: { partyId: party.id } });
      return { customerId: party.id, code };
    });
  }

  @Get('pipeline') @RequirePermission('crm', 'view')
  pipeline(@CurrentUser() u: AuthUser) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const g = await tx.lead.groupBy({ by: ['stage'], _count: true, _sum: { value: true } });
      return STAGES.map((stage) => { const r = g.find((x) => x.stage === stage); return { stage, count: r?._count ?? 0, value: fmt(r?._sum.value ?? 0) }; });
    });
  }

  @Get('contacts') @RequirePermission('crm', 'view')
  contacts(@CurrentUser() u: AuthUser, @Query('partyId') partyId?: string) { return this.prisma.tenant(u.companyId, (tx) => tx.contact.findMany({ where: partyId ? { partyId } : {}, orderBy: { name: 'asc' } })); }
  @Post('contacts') @RequirePermission('crm', 'create')
  addContact(@CurrentUser() u: AuthUser, @Body() d: ContactDto) { return this.prisma.tenant(u.companyId, (tx) => tx.contact.create({ data: { ...d, companyId: u.companyId } })); }

  @Get('activities') @RequirePermission('crm', 'view')
  activities(@CurrentUser() u: AuthUser, @Query('leadId') leadId?: string, @Query('partyId') partyId?: string, @Query('open') open?: string) {
    return this.prisma.tenant(u.companyId, (tx) => tx.activity.findMany({ where: { ...(leadId ? { leadId } : {}), ...(partyId ? { partyId } : {}), ...(open === 'true' ? { type: 'TASK', doneAt: null } : {}) }, orderBy: [{ dueAt: 'asc' }, { activityDate: 'desc' }], take: 300 }));
  }
  @Post('activities') @RequirePermission('crm', 'create')
  addActivity(@CurrentUser() u: AuthUser, @Body() d: ActivityDto) {
    return this.prisma.tenant(u.companyId, (tx) => tx.activity.create({ data: { ...d, companyId: u.companyId, dueAt: d.dueAt ? new Date(d.dueAt) : null, assignedTo: d.assignedTo ?? u.userId, createdBy: u.userId } }));
  }
  @Post('activities/:id/done') @HttpCode(200) @RequirePermission('crm', 'edit')
  done(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.prisma.tenant(u.companyId, (tx) => tx.activity.update({ where: { id }, data: { doneAt: new Date() } })); }

  /** Creates notifications for follow-ups that are due (run from a scheduler). */
  @Post('reminders/run') @HttpCode(200) @RequirePermission('crm', 'edit')
  reminders(@CurrentUser() u: AuthUser) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const due = await tx.activity.findMany({ where: { type: 'TASK', doneAt: null, remindedAt: null, dueAt: { lte: new Date() } } });
      for (const a of due) { await this.notes.notify(tx, u.companyId, [a.assignedTo ?? a.createdBy], 'Follow-up due', a.subject, a.leadId ? `/crm/leads/${a.leadId}` : undefined); await tx.activity.update({ where: { id: a.id }, data: { remindedAt: new Date() } }); }
      return { reminded: due.length };
    });
  }
}
