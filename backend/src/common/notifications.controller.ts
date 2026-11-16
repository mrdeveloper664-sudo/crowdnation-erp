import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from './decorators';
import { paged } from './interceptors/response.interceptor';
import { PrismaService } from './prisma.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('unread') unread?: string, @Query('page') pageQ?: string) {
    const page = Math.max(1, Number(pageQ) || 1), pageSize = 30;
    const where = { userId: u.userId, ...(unread === 'true' ? { readAt: null } : {}) };
    return this.prisma.tenant(u.companyId, async (tx) => {
      const [total, rows, unreadCount] = await Promise.all([tx.notification.count({ where }), tx.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }), tx.notification.count({ where: { userId: u.userId, readAt: null } })]);
      const r = paged(rows, page, pageSize, total); (r.meta as any).unread = unreadCount; return r;
    });
  }

  @Post('read-all') @HttpCode(200)
  readAll(@CurrentUser() u: AuthUser) { return this.prisma.tenant(u.companyId, async (tx) => ({ updated: (await tx.notification.updateMany({ where: { userId: u.userId, readAt: null }, data: { readAt: new Date() } })).count })); }

  @Post(':id/read') @HttpCode(200)
  read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.prisma.tenant(u.companyId, async (tx) => ({ updated: (await tx.notification.updateMany({ where: { id, userId: u.userId }, data: { readAt: new Date() } })).count })); }
}
