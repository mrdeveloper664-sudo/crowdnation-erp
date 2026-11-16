import { Injectable } from '@nestjs/common';
import { Tx } from './prisma.service';

@Injectable()
export class AuditService {
  async log(
    tx: Tx,
    p: { companyId: string; userId?: string | null; action: string; entityType: string; entityId?: string; before?: unknown; after?: unknown; ip?: string },
  ) {
    await tx.auditLog.create({
      data: {
        companyId: p.companyId,
        userId: p.userId ?? null,
        action: p.action,
        entityType: p.entityType,
        entityId: p.entityId,
        before: p.before === undefined ? undefined : JSON.parse(JSON.stringify(p.before)),
        after: p.after === undefined ? undefined : JSON.parse(JSON.stringify(p.after)),
        ip: p.ip,
      },
    });
  }
}
