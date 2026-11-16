import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsBoolean, IsEmail, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { MailService } from '../common/mail.service';
import { PrismaService } from '../common/prisma.service';
import { AuthService } from '../auth/auth.service';

class InviteDto {
  @IsEmail() email: string;
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsUUID() roleId: string;
}
class UpdateUserDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsUUID('all', { each: true }) roleIds?: string[];
}
class RoleDto {
  @IsString() @Length(2, 80) name: string;
  @IsOptional() @IsString() description?: string;
  @IsArray() @IsString({ each: true }) permissions: string[]; // "voucher:create"
}

@Controller()
export class UsersController {
  constructor(private prisma: PrismaService, private audit: AuditService, private auth: AuthService, private mail: MailService) {}

  @Get('users') @RequirePermission('user', 'view')
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.tenant(u.companyId, (tx) =>
      tx.user.findMany({
        select: { id: true, name: true, email: true, isActive: true, emailVerifiedAt: true, lastLoginAt: true, roles: { select: { role: { select: { id: true, name: true } } } } },
        orderBy: { name: 'asc' },
      }),
    );
  }

  @Post('users/invitations') @RequirePermission('user', 'create')
  async invite(@CurrentUser() u: AuthUser, @Body() dto: InviteDto) {
    const raw = this.auth.inviteToken();
    const token = `${u.companyId}.${raw}`;
    await this.prisma.tenant(u.companyId, async (tx) => {
      const role = await tx.role.findUnique({ where: { id: dto.roleId } });
      if (!role) throw new BadRequestException('Role not found');
      if (await tx.user.findUnique({ where: { companyId_email: { companyId: u.companyId, email: dto.email.toLowerCase() } } })) throw new ConflictException('User already exists');
      await tx.invitation.create({
        data: { companyId: u.companyId, email: dto.email.toLowerCase(), name: dto.name, roleId: dto.roleId, invitedBy: u.userId, tokenHash: this.auth.hash(raw), expiresAt: new Date(Date.now() + 7 * 86_400_000) },
      });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'user.invited', entityType: 'invitation', after: { email: dto.email, roleId: dto.roleId } });
    });
    await this.mail.send({ to: dto.email, subject: 'You are invited to NEXERP', kind: 'invite', token, text: `Invitation token: ${token}` });
    return { invited: true };
  }

  @Patch('users/:id') @RequirePermission('user', 'edit')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      if (id === u.userId && dto.isActive === false) throw new BadRequestException('You cannot deactivate yourself');
      const before = await tx.user.findUniqueOrThrow({ where: { id }, select: { isActive: true } });
      if (dto.isActive !== undefined) {
        await tx.user.update({ where: { id }, data: { isActive: dto.isActive } });
        if (!dto.isActive) await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      if (dto.roleIds) {
        const roles = await tx.role.count({ where: { id: { in: dto.roleIds } } });
        if (roles !== dto.roleIds.length) throw new BadRequestException('Unknown role');
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: dto.roleIds.map((roleId) => ({ companyId: u.companyId, userId: id, roleId })) });
      }
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'user.updated', entityType: 'user', entityId: id, before, after: dto });
      return { updated: true };
    });
  }

  @Get('permissions') @RequirePermission('role', 'view')
  permissions() {
    return this.prisma.permission.findMany({ orderBy: [{ resource: 'asc' }, { action: 'asc' }] });
  }

  @Get('roles') @RequirePermission('role', 'view')
  roles(@CurrentUser() u: AuthUser) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const roles = await tx.role.findMany({ include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } }, orderBy: { name: 'asc' } });
      return roles.map((r) => ({
        id: r.id, name: r.name, description: r.description, isSystem: r.isSystem, userCount: r._count.users,
        permissions: r.permissions.map((p) => `${p.permission.resource}:${p.permission.action}`).sort(),
      }));
    });
  }

  private async resolvePermissions(tx: any, keys: string[]) {
    const catalogue = await tx.permission.findMany();
    const map = new Map<string, string>(catalogue.map((p: any) => [`${p.resource}:${p.action}`, p.id]));
    const ids = keys.map((k) => { const id = map.get(k); if (!id) throw new BadRequestException(`Unknown permission ${k}`); return id; });
    return [...new Set(ids)];
  }

  @Post('roles') @RequirePermission('role', 'create')
  createRole(@CurrentUser() u: AuthUser, @Body() dto: RoleDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const ids = await this.resolvePermissions(tx, dto.permissions);
      const role = await tx.role.create({ data: { companyId: u.companyId, name: dto.name, description: dto.description } });
      await tx.rolePermission.createMany({ data: ids.map((permissionId) => ({ companyId: u.companyId, roleId: role.id, permissionId })) });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'role.created', entityType: 'role', entityId: role.id, after: dto });
      return { id: role.id };
    });
  }

  @Patch('roles/:id') @RequirePermission('role', 'edit')
  updateRole(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoleDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const role = await tx.role.findUniqueOrThrow({ where: { id } });
      if (role.isSystem) throw new BadRequestException('System roles cannot be modified; create a custom role instead');
      const ids = await this.resolvePermissions(tx, dto.permissions);
      await tx.role.update({ where: { id }, data: { name: dto.name, description: dto.description } });
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: ids.map((permissionId) => ({ companyId: u.companyId, roleId: id, permissionId })) });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'role.updated', entityType: 'role', entityId: id, before: role, after: dto });
      return { updated: true };
    });
  }

  @Delete('roles/:id') @RequirePermission('role', 'delete')
  deleteRole(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const role = await tx.role.findUniqueOrThrow({ where: { id }, include: { _count: { select: { users: true } } } });
      if (role.isSystem) throw new BadRequestException('System roles cannot be deleted');
      if (role._count.users > 0) throw new BadRequestException('Role is assigned to users');
      await tx.role.delete({ where: { id } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'role.deleted', entityType: 'role', entityId: id, before: role });
      return { deleted: true };
    });
  }
}
