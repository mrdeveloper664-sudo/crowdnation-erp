import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Tx } from '../common/prisma.service';

@Injectable()
export class PeriodService {
  /** Resolve the accounting period for a date and ensure it is open. */
  async requireOpenPeriod(tx: Tx, companyId: string, date: Date) {
    const period = await tx.accountingPeriod.findFirst({
      where: { companyId, startDate: { lte: date }, endDate: { gte: date } },
      include: { financialYear: true },
    });
    if (!period) throw new BadRequestException(`No accounting period covers ${date.toISOString().slice(0, 10)}. Create the financial year first.`);
    if (period.status !== 'OPEN') throw new ForbiddenException(`Accounting period ${period.name} is locked`);
    if (period.financialYear.isClosed) throw new ForbiddenException(`Financial year ${period.financialYear.name} is closed`);
    return period;
  }

  async findFinancialYear(tx: Tx, companyId: string, date: Date) {
    return tx.financialYear.findFirst({ where: { companyId, startDate: { lte: date }, endDate: { gte: date } } });
  }
}
