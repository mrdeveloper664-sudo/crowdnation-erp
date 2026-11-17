import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CrmController } from '../crm/crm.controller';
import { ExpensesController } from '../expenses/expenses.controller';
import { RecurringService } from '../trade/recurring.service';
import { PrismaService } from './prisma.service';

/**
 * Daily housekeeping for every active company: recurring invoices, recurring expenses, CRM reminders.
 * Enabled only when ENABLE_SCHEDULER=true (run it on ONE instance). Each job acts as the company's first
 * administrator so the audit trail shows who the system acted for. `runAll` is also callable on demand.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  constructor(private prisma: PrismaService, private recurring: RecurringService, private moduleRef: ModuleRef) {}

  // controllers are not injectable providers; resolve them lazily from the module graph
  private get expenses() { return this.moduleRef.get(ExpensesController, { strict: false }); }
  private get crm() { return this.moduleRef.get(CrmController, { strict: false }); }

  private timer?: NodeJS.Timeout;
  private lastRun = '';

  /** Checks hourly; runs once per UTC day after 02:00. (No external scheduler dependency.) */
  onModuleInit() {
    if (process.env.ENABLE_SCHEDULER !== 'true') return;
    this.timer = setInterval(() => void this.tick(), 60 * 60 * 1000);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick(now = new Date()) {
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() < 2 || this.lastRun === day) return false;
    this.lastRun = day;
    await this.runAll(day);
    return true;
  }

  async runAll(asOf = new Date().toISOString().slice(0, 10)) {
    const companies = await this.prisma.company.findMany({ where: { status: 'ACTIVE' }, select: { id: true, code: true } });
    const summary: Record<string, { invoices: number; expenses: number; reminders: number; error?: string }> = {};
    for (const c of companies) {
      const r = { invoices: 0, expenses: 0, reminders: 0 } as { invoices: number; expenses: number; reminders: number; error?: string };
      try {
        const admin = await this.prisma.tenant(c.id, (tx) => tx.user.findFirst({ where: { isActive: true, roles: { some: { role: { name: 'Company Administrator' } } } }, orderBy: { createdAt: 'asc' }, select: { id: true } }));
        if (!admin) continue;
        const actor = { companyId: c.id, userId: admin.id };
        r.invoices = (await this.recurring.run(c.id, admin.id, asOf)).generated;
        r.expenses = (await this.expenses.runRecurring(actor, asOf)).generated;
        r.reminders = (await this.crm.reminders(actor)).reminded;
      } catch (e) {
        r.error = (e as Error).message;
        this.logger.error(`${c.code}: ${r.error}`);
      }
      summary[c.code] = r;
    }
    return summary;
  }
}
