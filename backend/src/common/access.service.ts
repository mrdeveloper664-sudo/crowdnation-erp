import { Injectable } from '@nestjs/common';
import { Tx } from './prisma.service';

@Injectable()
export class AccessService {
  async has(tx: Tx, userId: string, resource: string, action: string) {
    return (await tx.rolePermission.count({ where: { role: { users: { some: { userId } } }, permission: { resource, action } } })) > 0;
  }
}
