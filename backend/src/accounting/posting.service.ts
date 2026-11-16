import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { JournalSource } from '@prisma/client';
import { D, Decimal, DecimalInput, ZERO, round } from '../common/money';
import { Tx } from '../common/prisma.service';
import { PeriodService } from './period.service';
import { SequenceService } from './sequence.service';

export interface PostingLine {
  accountId: string;
  debit?: DecimalInput;
  credit?: DecimalInput;
  description?: string;
}

export interface PostingInput {
  companyId: string;
  userId: string;
  entryDate: Date;
  sourceType: JournalSource;
  sourceId?: string;
  /** Unique per company. Posting the same key twice is rejected (duplicate-posting protection). */
  idempotencyKey: string;
  narration?: string;
  currency?: string; // defaults to company base currency
  exchangeRate?: DecimalInput; // base units per 1 unit of `currency`
  branchId?: string;
  lines: PostingLine[];
}

/**
 * THE accounting posting engine. Every module (vouchers, sales, purchases, VAT,
 * payroll, depreciation ...) must post through this class - never write
 * journal rows directly. All work happens in the caller's transaction.
 */
@Injectable()
export class PostingService {
  constructor(private periods: PeriodService, private sequences: SequenceService) {}

  async post(tx: Tx, input: PostingInput) {
    const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId }, include: { settings: true } });
    const dp = company.settings?.amountDecimals ?? 2;
    const currency = input.currency ?? company.baseCurrency;
    const isForeign = currency !== company.baseCurrency;
    const rate = isForeign ? D(input.exchangeRate ?? 0) : D(1);
    if (isForeign && rate.lte(0)) throw new BadRequestException('A positive exchange rate is required for foreign currency postings');

    if (input.lines.length < 2) throw new UnprocessableEntityException('A journal entry needs at least two lines');

    const duplicate = await tx.journalEntry.findUnique({
      where: { companyId_idempotencyKey: { companyId: input.companyId, idempotencyKey: input.idempotencyKey } },
      select: { id: true, entryNumber: true },
    });
    if (duplicate) throw new ConflictException(`Already posted (${duplicate.entryNumber})`);

    // ---- validate & convert lines to base currency -------------------
    const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
    const accounts = await tx.account.findMany({ where: { companyId: input.companyId, id: { in: accountIds } } });
    if (accounts.length !== accountIds.length) throw new BadRequestException('One or more accounts do not exist in this company');
    const inactive = accounts.find((a) => !a.isActive);
    if (inactive) throw new UnprocessableEntityException(`Account ${inactive.code} - ${inactive.name} is inactive`);

    const lines = input.lines.map((l, i) => {
      const dr = D(l.debit);
      const cr = D(l.credit);
      if (dr.isNegative() || cr.isNegative()) throw new UnprocessableEntityException(`Line ${i + 1}: amounts cannot be negative`);
      if (dr.gt(0) && cr.gt(0)) throw new UnprocessableEntityException(`Line ${i + 1}: a line cannot have both debit and credit`);
      if (dr.isZero() && cr.isZero()) throw new UnprocessableEntityException(`Line ${i + 1}: amount is required`);
      if (dr.decimalPlaces() > dp || cr.decimalPlaces() > dp) throw new UnprocessableEntityException(`Line ${i + 1}: amounts support at most ${dp} decimal places`);
      const foreign = dr.gt(0) ? dr : cr.neg();
      return {
        accountId: l.accountId,
        debit: isForeign ? round(dr.mul(rate), dp) : dr,
        credit: isForeign ? round(cr.mul(rate), dp) : cr,
        foreignAmount: isForeign ? foreign : null,
        description: l.description,
      };
    });

    let totalDr = lines.reduce((s, l) => s.add(l.debit), ZERO);
    let totalCr = lines.reduce((s, l) => s.add(l.credit), ZERO);

    // Foreign currency: translation can leave a few cents of rounding difference.
    if (isForeign && !totalDr.eq(totalCr)) {
      const diff = totalDr.sub(totalCr);
      const tolerance = D('0.01').mul(lines.length);
      if (diff.abs().lte(tolerance)) {
        const rounding = await tx.account.findFirst({ where: { companyId: input.companyId, systemKey: 'ROUNDING' } });
        if (!rounding) throw new UnprocessableEntityException('Rounding account missing');
        lines.push({
          accountId: rounding.id,
          debit: diff.isNegative() ? diff.abs() : ZERO,
          credit: diff.isNegative() ? ZERO : diff,
          foreignAmount: null,
          description: 'Currency translation rounding',
        });
        totalDr = lines.reduce((s, l) => s.add(l.debit), ZERO);
        totalCr = lines.reduce((s, l) => s.add(l.credit), ZERO);
      }
    }
    if (!totalDr.eq(totalCr)) {
      throw new UnprocessableEntityException(`Entry is not balanced: debit ${totalDr.toFixed(dp)} <> credit ${totalCr.toFixed(dp)}`);
    }
    if (totalDr.isZero()) throw new UnprocessableEntityException('Entry total cannot be zero');

    return this.insert(tx, input, { currency, rate, lines });
  }

  /**
   * Correct a posted entry by posting its exact mirror image. The original is never touched.
   * A second reversal of the same entry is rejected by a unique constraint.
   */
  async reverse(tx: Tx, p: { companyId: string; userId: string; entryId: string; entryDate: Date; narration?: string }) {
    const original = await tx.journalEntry.findFirst({ where: { id: p.entryId, companyId: p.companyId }, include: { lines: true } });
    if (!original) throw new NotFoundException('Journal entry not found');
    if (original.reversalOfId) throw new UnprocessableEntityException('A reversal entry cannot itself be reversed');
    const already = await tx.journalEntry.findUnique({ where: { reversalOfId: original.id }, select: { entryNumber: true } });
    if (already) throw new ConflictException(`Entry already reversed by ${already.entryNumber}`);
    if (p.entryDate < original.entryDate) throw new UnprocessableEntityException('Reversal date cannot precede the original entry date');

    const lines = original.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.credit,
      credit: l.debit,
      foreignAmount: l.foreignAmount ? l.foreignAmount.neg() : null,
      description: l.description ?? undefined,
    }));
    return this.insert(
      tx,
      {
        companyId: p.companyId,
        userId: p.userId,
        entryDate: p.entryDate,
        sourceType: 'REVERSAL',
        sourceId: original.id,
        idempotencyKey: `reversal:${original.id}`,
        narration: p.narration ?? `Reversal of ${original.entryNumber}`,
        branchId: original.branchId ?? undefined,
        lines: [],
      },
      { currency: original.currency, rate: original.exchangeRate, lines },
      original.id,
    );
  }

  private async insert(
    tx: Tx,
    input: PostingInput,
    r: {
      currency: string;
      rate: Decimal;
      lines: Array<{ accountId: string; debit: Decimal; credit: Decimal; foreignAmount: Decimal | null; description?: string }>;
    },
    reversalOfId?: string,
  ) {
    const period = await this.periods.requireOpenPeriod(tx, input.companyId, input.entryDate);
    const n = await this.sequences.next(tx, input.companyId, 'JOURNAL', period.financialYearId);
    const entryNumber = `JE-${period.financialYear.startDate.getUTCFullYear()}-${this.sequences.pad(n, 6)}`;
    return tx.journalEntry.create({
      data: {
        companyId: input.companyId,
        entryNumber,
        entryDate: input.entryDate,
        periodId: period.id,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        reversalOfId,
        currency: r.currency,
        exchangeRate: r.rate,
        narration: input.narration,
        branchId: input.branchId,
        postedBy: input.userId,
        lines: {
          create: r.lines.map((l, i) => ({
            companyId: input.companyId,
            lineNo: i + 1,
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            foreignAmount: l.foreignAmount,
            description: l.description,
          })),
        },
      },
      include: { lines: true },
    });
  }
}
