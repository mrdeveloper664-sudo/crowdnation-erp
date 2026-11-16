import { Injectable } from '@nestjs/common';
import { Tx } from './prisma.service';

@Injectable()
export class NotificationsService {
  async notify(tx: Tx, companyId: string, userIds: string[], title: string, body?: string, link?: string) {
    const ids = [...new Set(userIds)];
    if (!ids.length) return;
    await tx.notification.createMany({ data: ids.map((userId) => ({ companyId, userId, title, body, link })) });
  }

  /** Users of the company holding resource:action (e.g. all voucher approvers). */
  async usersWith(tx: Tx, resource: string, action: string): Promise<string[]> {
    const rows = await tx.userRole.findMany({ where: { role: { permissions: { some: { permission: { resource, action } } } }, user: { isActive: true } }, select: { userId: true } });
    return [...new Set(rows.map((r) => r.userId))];
  }
}
