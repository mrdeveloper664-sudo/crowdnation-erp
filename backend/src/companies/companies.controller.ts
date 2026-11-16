import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, Length, Max, Min } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';

class UpdateCompanyDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() @Length(2, 200) legalName?: string;
  @IsOptional() @IsString() @Length(0, 32) trn?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsUrl({ require_tld: false }) logoUrl?: string;
}
class UpdateSettingsDto {
  @IsOptional() @IsBoolean() requireVoucherApproval?: boolean;
  @IsOptional() @IsBoolean() allowSelfApproval?: boolean;
  @IsOptional() @IsBoolean() allowBackdatedPosting?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(4) amountDecimals?: number;
  @IsOptional() @IsIn(['WAVG', 'FIFO']) inventoryMethod?: string;
  @IsOptional() @IsIn(['ABU_DHABI', 'DUBAI', 'SHARJAH', 'AJMAN', 'UMM_AL_QUWAIN', 'RAS_AL_KHAIMAH', 'FUJAIRAH']) emirate?: string;
  @IsOptional() @IsObject() voucherPrefixes?: Record<string, string>;
  @IsOptional() @IsObject() preferences?: Record<string, unknown>;
}
class BranchDto {
  @IsString() @Length(1, 20) code: string;
  @IsString() @Length(2, 120) name: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller()
export class CompaniesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get('company') @RequirePermission('company', 'view')
  get(@CurrentUser() u: AuthUser) {
    return this.prisma.company.findUniqueOrThrow({ where: { id: u.companyId } });
  }

  @Patch('company') @RequirePermission('company', 'edit')
  update(@CurrentUser() u: AuthUser, @Body() dto: UpdateCompanyDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const before = await tx.company.findUniqueOrThrow({ where: { id: u.companyId } });
      const after = await tx.company.update({ where: { id: u.companyId }, data: { ...dto, trn: dto.trn === '' ? null : dto.trn } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'company.updated', entityType: 'company', entityId: u.companyId, before, after });
      return after;
    });
  }

  @Get('company/settings') @RequirePermission('settings', 'view')
  settings(@CurrentUser() u: AuthUser) {
    return this.prisma.tenant(u.companyId, (tx) => tx.companySetting.findUniqueOrThrow({ where: { companyId: u.companyId } }));
  }

  @Patch('company/settings') @RequirePermission('settings', 'edit')
  updateSettings(@CurrentUser() u: AuthUser, @Body() dto: UpdateSettingsDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const before = await tx.companySetting.findUniqueOrThrow({ where: { companyId: u.companyId } });
      const after = await tx.companySetting.update({
        where: { companyId: u.companyId },
        data: { ...dto, voucherPrefixes: dto.voucherPrefixes ? { ...(before.voucherPrefixes as object), ...dto.voucherPrefixes } : undefined, preferences: dto.preferences as any },
      });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'settings.updated', entityType: 'company_settings', entityId: after.id, before, after });
      return after;
    });
  }

  @Get('branches') @RequirePermission('branch', 'view')
  branches(@CurrentUser() u: AuthUser) {
    return this.prisma.tenant(u.companyId, (tx) => tx.branch.findMany({ orderBy: { code: 'asc' } }));
  }

  @Post('branches') @RequirePermission('branch', 'create')
  createBranch(@CurrentUser() u: AuthUser, @Body() dto: BranchDto) {
    return this.prisma.tenant(u.companyId, async (tx) => {
      const b = await tx.branch.create({ data: { ...dto, companyId: u.companyId } });
      await this.audit.log(tx, { companyId: u.companyId, userId: u.userId, action: 'branch.created', entityType: 'branch', entityId: b.id, after: b });
      return b;
    });
  }

  @Patch('branches/:id') @RequirePermission('branch', 'edit')
  updateBranch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BranchDto) {
    return this.prisma.tenant(u.companyId, (tx) => tx.branch.update({ where: { id }, data: dto }));
  }

  @Delete('branches/:id') @RequirePermission('branch', 'delete')
  deleteBranch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.tenant(u.companyId, async (tx) => { await tx.branch.delete({ where: { id } }); return { deleted: true }; });
  }
}
