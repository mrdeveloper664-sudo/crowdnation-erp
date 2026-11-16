import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { DocSide, SettlementKind } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsUUID, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { IsoDate } from '../common/validators';
import { ApplyDto, ConvertDto, DocDto, DocLineDto, DocReasonDto, UpdateDocDto } from './documents.dto';
import { DocumentsService } from './documents.service';
import { RecurringService } from './recurring.service';
import { SettlementDto, SettlementsService } from './settlements.service';
import { Frequency } from '@prisma/client';

class RecurringDto {
  @IsUUID() partyId: string;
  @IsEnum(Frequency) frequency: Frequency;
  @Matches(IsoDate) startDate: string;
  @IsOptional() @Matches(IsoDate) endDate?: string;
  @IsOptional() @IsBoolean() autoPost?: boolean;
  @IsOptional() @IsBoolean() pricesIncludeVat?: boolean;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DocLineDto) lines: DocLineDto[];
}

function documentsController(side: DocSide, path: string, resource: string) {
  @Controller(`${path}/documents`)
  class C {
    constructor(public svc: DocumentsService) {}
    @Get() @RequirePermission(resource, 'view') list(@CurrentUser() u: AuthUser, @Query() q: any) { return this.svc.list(u.companyId, side, q); }
    @Post() @RequirePermission(resource, 'create') create(@CurrentUser() u: AuthUser, @Body() dto: DocDto) { return this.svc.create(u.companyId, u.userId, side, dto); }
    @Get(':id') @RequirePermission(resource, 'view') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u.companyId, id); }
    @Put(':id') @RequirePermission(resource, 'edit') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDocDto) { return this.svc.update(u.companyId, u.userId, id, dto); }
    @Delete(':id') @RequirePermission(resource, 'delete') remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(u.companyId, u.userId, id); }
    @Post(':id/confirm') @HttpCode(200) @RequirePermission(resource, 'edit') confirm(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.confirm(u.companyId, u.userId, id); }
    @Post(':id/convert') @HttpCode(200) @RequirePermission(resource, 'create') convert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConvertDto) { return this.svc.convert(u.companyId, u.userId, id, dto.to); }
    @Post(':id/post') @HttpCode(200) @RequirePermission(resource, 'post') post(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.post(u.companyId, u.userId, id); }
    @Post(':id/cancel') @HttpCode(200) @RequirePermission(resource, 'cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DocReasonDto) { return this.svc.cancel(u.companyId, u.userId, id, dto.reason); }
    @Post(':id/apply') @HttpCode(200) @RequirePermission(resource, 'post') apply(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplyDto) { return this.svc.applyNote(u.companyId, u.userId, id, dto.invoiceId, dto.amount); }
  }
  return C;
}

function settlementsController(kind: SettlementKind, path: string, resource: string) {
  @Controller(`${path}/${kind === 'RECEIPT' ? 'receipts' : 'payments'}`)
  class C {
    constructor(public svc: SettlementsService) {}
    @Get() @RequirePermission(resource, 'view') list(@CurrentUser() u: AuthUser, @Query() q: any) { return this.svc.list(u.companyId, kind, q); }
    @Post() @RequirePermission(resource, 'post') create(@CurrentUser() u: AuthUser, @Body() dto: SettlementDto) { return this.svc.create(u.companyId, u.userId, kind, dto); }
    @Get(':id') @RequirePermission(resource, 'view') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u.companyId, id); }
    @Post(':id/cancel') @HttpCode(200) @RequirePermission(resource, 'cancel') cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DocReasonDto) { return this.svc.cancel(u.companyId, u.userId, id, dto.reason); }
  }
  return C;
}

@Controller('sales/recurring')
export class RecurringController {
  constructor(private svc: RecurringService) {}
  @Get() @RequirePermission('sales', 'view') list(@CurrentUser() u: AuthUser) { return this.svc.list(u.companyId); }
  @Post() @RequirePermission('sales', 'create') create(@CurrentUser() u: AuthUser, @Body() dto: RecurringDto) { return this.svc.create(u.companyId, u.userId, dto); }
  @Patch(':id/active') @RequirePermission('sales', 'edit') active(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body('isActive') isActive: boolean) { return this.svc.setActive(u.companyId, id, !!isActive); }
  @Post('run') @HttpCode(200) @RequirePermission('sales', 'post') run(@CurrentUser() u: AuthUser, @Body('asOf') asOf: string) { return this.svc.run(u.companyId, u.userId, asOf ?? new Date().toISOString().slice(0, 10)); }
}

export const SalesDocumentsController = documentsController('SALES', 'sales', 'sales');
export const PurchaseDocumentsController = documentsController('PURCHASE', 'purchases', 'purchase');
export const ReceiptsController = settlementsController('RECEIPT', 'sales', 'sales');
export const SupplierPaymentsController = settlementsController('PAYMENT', 'purchases', 'purchase');
