import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { paged } from '../common/interceptors/response.interceptor';
import { PrismaService } from '../common/prisma.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private prisma: PrismaService) {}

  @Get() @RequirePermission('audit', 'view')
  list(@CurrentUser() u: AuthUser, @Query('entityType') entityType?: string, @Query('entityId') entityId?: string, @Query('action') action?: string, @Query('page') pageQ?: string) {
    const page = Math.max(1, Number(pageQ) || 1), pageSize = 50;
    const where = { ...(entityType ? { entityType } : {}), ...(entityId ? { entityId } : {}), ...(action ? { action: { contains: action } } : {}) };
    return this.prisma.tenant(u.companyId, async (tx) => {
      const [total, rows] = await Promise.all([tx.auditLog.count({ where }), tx.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })]);
      const users = new Map((await tx.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
      return paged(rows.map((r) => ({ ...r, userName: r.userId ? users.get(r.userId) ?? null : null })), page, pageSize, total);
    });
  }
}
