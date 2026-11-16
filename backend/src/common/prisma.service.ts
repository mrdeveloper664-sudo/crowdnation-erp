import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Run `fn` inside ONE database transaction bound to a tenant.
   * `app.current_company_id` is set with transaction-local scope, so PostgreSQL
   * Row Level Security policies restrict every statement to that company -
   * regardless of what the application code queries.
   */
  async tenant<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!/^[0-9a-f-]{36}$/i.test(companyId)) throw new Error('Invalid tenant id');
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
        return fn(tx);
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }
}
