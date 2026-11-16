import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ReasonDto, UpdateVoucherDto, VoucherDto, VoucherQuery } from './vouchers.dto';
import { VouchersService } from './vouchers.service';

@Controller('vouchers')
export class VouchersController {
  constructor(private svc: VouchersService) {}

  @Get() @RequirePermission('voucher', 'view')
  list(@CurrentUser() u: AuthUser, @Query() q: VoucherQuery) { return this.svc.list(u.companyId, q); }

  @Get(':id') @RequirePermission('voucher', 'view')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u.companyId, id); }

  @Post() @RequirePermission('voucher', 'create')
  create(@CurrentUser() u: AuthUser, @Body() dto: VoucherDto) { return this.svc.create(u.companyId, u.userId, dto); }

  @Put(':id') @RequirePermission('voucher', 'edit')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVoucherDto) { return this.svc.update(u.companyId, u.userId, id, dto); }

  @Delete(':id') @RequirePermission('voucher', 'delete')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.remove(u.companyId, u.userId, id); }

  @Post(':id/submit') @HttpCode(200) @RequirePermission('voucher', 'create')
  submit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.submit(u.companyId, u.userId, id); }

  @Post(':id/approve') @HttpCode(200) @RequirePermission('voucher', 'approve')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.approve(u.companyId, u.userId, id); }

  @Post(':id/reject') @HttpCode(200) @RequirePermission('voucher', 'approve')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) { return this.svc.reject(u.companyId, u.userId, id, dto.reason); }

  @Post(':id/post') @HttpCode(200) @RequirePermission('voucher', 'post')
  post(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.post(u.companyId, u.userId, id); }

  @Post(':id/cancel') @HttpCode(200) @RequirePermission('voucher', 'cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) { return this.svc.cancel(u.companyId, u.userId, id, dto.reason, dto.date); }

  @Post(':id/replace') @HttpCode(200) @RequirePermission('voucher', 'cancel')
  replace(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) { return this.svc.replace(u.companyId, u.userId, id, dto.reason); }
}
