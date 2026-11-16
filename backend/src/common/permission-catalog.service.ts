import { Injectable, OnModuleInit } from '@nestjs/common';
import { ACTIONS, RESOURCES } from './permissions';
import { PrismaService } from './prisma.service';

/** Keeps the global permission catalogue (resource x action) in sync at start-up. */
@Injectable()
export class PermissionCatalogService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}
  async onModuleInit() {
    await this.prisma.permission.createMany({
      data: RESOURCES.flatMap((resource) => ACTIONS.map((action) => ({ resource, action }))),
      skipDuplicates: true,
    });
  }
}
