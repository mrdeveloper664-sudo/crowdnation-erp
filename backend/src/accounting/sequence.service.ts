import { Injectable } from '@nestjs/common';
import { Tx } from '../common/prisma.service';

@Injectable()
export class SequenceService {
  /** Atomic, row-locked counter: concurrent callers never get the same number. */
  async next(tx: Tx, companyId: string, key: string, financialYearId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ last_number: number }[]>`
      INSERT INTO document_sequences (company_id, key, financial_year_id, last_number)
      VALUES (${companyId}::uuid, ${key}, ${financialYearId}::uuid, 1)
      ON CONFLICT (company_id, key, financial_year_id)
      DO UPDATE SET last_number = document_sequences.last_number + 1
      RETURNING last_number`;
    return rows[0].last_number;
  }

  /** Counter that is not tied to a financial year (customer codes, SKUs ...). */
  nextGlobal(tx: Tx, companyId: string, key: string) {
    return this.next(tx, companyId, key, '00000000-0000-0000-0000-000000000000');
  }

  pad(n: number, width = 5) {
    return String(n).padStart(width, '0');
  }
}
