import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AccountNature, AccountType, Prisma } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';

class GroupDto {
  @IsString() @Length(1, 20) code: string;
  @IsString() @Length(2, 120) name: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsEnum(AccountNature) nature?: AccountNature; // inherited from parent when omitted
}
class UpdateGroupDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class AccountDto {
  @IsString() @Length(1, 20) code: string;
  @IsString() @Length(2, 120) name: string;
  @IsUUID() groupId: string;
  @IsOptional() @IsEnum(AccountType) type?: AccountType;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() description?: string;
}
class UpdateAccountDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsUUID() groupId?: string;
  @IsOptional() @IsEnum(AccountType) type?: AccountType;
  @IsOptional() @IsString() description?: string;
}

@Controller('chart-of-accounts')
export class CoaController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get('groups') @RequirePermission('account', 'view')
  groups(@CurrentUser() u: AuthUser) {
    return this.prisma.tenant(u.companyId, (tx) => tx.accountGroup.findMany({ orderBy: { code: 'asc' } }));
  }

  @Post('groups') @RequirePermission('account', 'create')
  createGroup(@CurrentUser() u: AuthUser, @Body() dto: GroupDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      let nature = dto.nature;
      if (dto.parentId) {
        const parent = await tx.accountGroup.findUnique({ where: { id: dto.parentId } });
        if (!parent) throw new BadRequestException('Parent group not found');
        if (dto.nature && dto.nature !== parent.nature) throw new BadRequestException('Sub-group must have the same nature as its parent');
        nature = parent.nature;
      }
      if (!nature) throw new BadRequestException('nature is required for a top-level group');
      const g = await tx.accountGroup.create({ data: { companyId: u.companyId, code: dto.code, name: dto.name, parentId: dto.parentId, nature } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'account_group.created', entityType: 'account_group', entityId: g.id, after: g });
      return g;
    });
  }

  @Patch('groups/:id') @RequirePermission('account', 'edit')
  updateGroup(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGroupDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const before = await tx.accountGroup.findUniqueOrThrow({ where: { id } });
      if (before.isSystem && dto.isActive === false) throw new BadRequestException('System groups cannot be deactivated');
      const after = await tx.accountGroup.update({ where: { id }, data: dto });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'account_group.updated', entityType: 'account_group', entityId: id, before, after });
      return after;
    });
  }

  @Get('accounts') @RequirePermission('account', 'view')
  accounts(@CurrentUser() u: AuthUser, @Query('search') search?: string, @Query('groupId') groupId?: string, @Query('type') type?: string, @Query('active') active?: string) {
    // `type` may be a comma-separated list, e.g. CASH,BANK
    const types = (type ?? '').split(',').map((t) => t.trim()).filter((t): t is AccountType => (Object.values(AccountType) as string[]).includes(t));
    const where: Prisma.AccountWhereInput = {
      ...(groupId ? { groupId } : {}), ...(types.length ? { type: { in: types } } : {}), ...(active !== undefined ? { isActive: active === 'true' } : {}),
      ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] } : {}),
    };
    return this.prisma.tenant(u.companyId, (tx) => tx.account.findMany({ where, include: { group: { select: { name: true, nature: true } } }, orderBy: { code: 'asc' } }));
  }

  @Post('accounts') @RequirePermission('account', 'create')
  createAccount(@CurrentUser() u: AuthUser, @Body() dto: AccountDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      if (!(await tx.accountGroup.findUnique({ where: { id: dto.groupId } }))) throw new BadRequestException('Group not found');
      const a = await tx.account.create({ data: { ...dto, companyId: u.companyId, currency: dto.currency?.toUpperCase() } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'account.created', entityType: 'account', entityId: a.id, after: a });
      return a;
    });
  }

  @Patch('accounts/:id') @RequirePermission('account', 'edit')
  updateAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const before = await tx.account.findUniqueOrThrow({ where: { id } });
      if (before.isSystem && (dto.groupId || dto.type)) throw new BadRequestException('System accounts cannot change group or type');
      if (dto.groupId && !(await tx.accountGroup.findUnique({ where: { id: dto.groupId } }))) throw new BadRequestException('Group not found');
      if (dto.groupId && dto.groupId !== before.groupId) {
        const used = await tx.journalEntryLine.count({ where: { accountId: id } });
        if (used) throw new BadRequestException('Account already has postings; its group cannot be changed');
      }
      const after = await tx.account.update({ where: { id }, data: dto });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'account.updated', entityType: 'account', entityId: id, before, after });
      return after;
    });
  }

  private setActive(u: AuthUser, id: string, isActive: boolean) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const before = await tx.account.findUniqueOrThrow({ where: { id } });
      if (before.isSystem && !isActive) throw new BadRequestException('System accounts cannot be deactivated');
      const after = await tx.account.update({ where: { id }, data: { isActive } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: isActive ? 'account.activated' : 'account.deactivated', entityType: 'account', entityId: id, before, after });
      return after;
    });
  }

  @Post('accounts/:id/deactivate') @RequirePermission('account', 'edit')
  deactivate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.setActive(u, id, false); }

  @Post('accounts/:id/activate') @RequirePermission('account', 'edit')
  activate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.setActive(u, id, true); }

  @Delete('accounts/:id') @RequirePermission('account', 'delete')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const a = await tx.account.findUniqueOrThrow({ where: { id } });
      if (a.isSystem) throw new BadRequestException('System accounts cannot be deleted');
      const used = (await tx.journalEntryLine.count({ where: { accountId: id } })) + (await tx.voucherLine.count({ where: { accountId: id } })) + (await tx.ledgerOpeningBalance.count({ where: { accountId: id } }));
      if (used) throw new BadRequestException('Account has transactions; deactivate it instead');
      await tx.account.delete({ where: { id } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'account.deleted', entityType: 'account', entityId: id, before: a });
      return { deleted: true };
    });
  }
}
