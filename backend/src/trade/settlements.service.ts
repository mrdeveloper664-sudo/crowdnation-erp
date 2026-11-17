import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SettlementKind } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateNested } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { isoDate, parseDate } from '../common/dates';
import { paged } from '../common/interceptors/response.interceptor';
import { D, Decimal, ZERO, fmt, round } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { IsMoney, IsoDate } from '../common/validators';
import { PeriodService } from '../accounting/period.service';
import { PostingService } from '../accounting/posting.service';
import { SystemAccountsService } from '../accounting/system-accounts.service';
import { SequenceService } from '../accounting/sequence.service';
import { VouchersService } from '../vouchers/vouchers.service';

const isReceiptKind = (k: SettlementKind) => k === 'RECEIPT';

export class AllocationDto { @IsUUID() documentId: string; @IsMoney() amount: string }
export class SettlementDto {
  @IsUUID() partyId: string;
  @Matches(IsoDate) date: string;
  @IsMoney() amount: string;
  @IsUUID() accountId: string; // cash / bank ledger
  @IsOptional() @IsString() @MaxLength(20) method?: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  /** Settlement currency (default: company base currency). With allocations it must equal the currency of every allocated invoice. */
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  /** Base units per 1 unit of `currency`; default: latest saved rate on or before `date`. */
  @IsOptional() @IsString() @Matches(/^\d{1,10}(\.\d{1,8})?$/) exchangeRate?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => AllocationDto) allocations?: AllocationDto[];
}

/**
 * Base-currency (carrying) value that settling `amount` (invoice currency) of a posted invoice clears from the party ledger.
 * Partial settlements clear amount x invoice rate; the settlement that exhausts the invoice clears whatever base value is left,
 * so rounding never leaves a residue on the ledger.
 */
export async function carryingBase(tx: Tx, doc: { id: string; total: Decimal; exchangeRate: Decimal }, amount: Decimal, dp: number): Promise<Decimal> {
  const prior = await tx.settlementAllocation.findMany({ where: { documentId: doc.id }, select: { amount: true, baseAmount: true } });
  const paid = prior.reduce((x, a) => x.add(a.amount), ZERO);
  const released = prior.reduce((x, a) => x.add(a.baseAmount ?? a.amount), ZERO); // null = base-currency allocation
  if (amount.eq(doc.total.sub(paid))) return round(doc.total.mul(doc.exchangeRate), dp).sub(released);
  return round(amount.mul(doc.exchangeRate), dp);
}

@Injectable()
export class SettlementsService {
  constructor(
    private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private periods: PeriodService, private vouchers: VouchersService,
    private posting: PostingService, private sys: SystemAccountsService,
  ) {}

  async create(companyId: string, userId: string, kind: SettlementKind, dto: SettlementDto) {
    return this.prisma.tenant(companyId, async (tx) => {
      const date = parseDate(dto.date);
      const amount = D(dto.amount);
      if (amount.lte(0)) throw new BadRequestException('Amount must be positive');
      const party = await tx.party.findUnique({ where: { id: dto.partyId } });
      const wantKind = kind === 'RECEIPT' ? 'CUSTOMER' : 'SUPPLIER';
      if (!party || party.kind !== wantKind) throw new BadRequestException(`A ${wantKind.toLowerCase()} is required`);
      const bank = await tx.account.findUnique({ where: { id: dto.accountId } });
      if (!bank || !['CASH', 'BANK'].includes(bank.type)) throw new BadRequestException('accountId must be a cash or bank ledger');
      const [company, settings] = await Promise.all([tx.company.findUniqueOrThrow({ where: { id: companyId } }), tx.companySetting.findUniqueOrThrow({ where: { companyId } })]);
      const dp = settings.amountDecimals;
      const currency = (dto.currency ?? company.baseCurrency).toUpperCase();
      const foreign = currency !== company.baseCurrency;
      let rate = D(1);
      if (foreign) {
        const r = dto.exchangeRate ? D(dto.exchangeRate) : (await tx.exchangeRate.findFirst({ where: { currency, rateDate: { lte: date } }, orderBy: { rateDate: 'desc' } }))?.rate;
        if (!r || D(r).lte(0)) throw new BadRequestException(`No exchange rate for ${currency}; supply exchangeRate or define one`);
        rate = D(r);
      }
      const allocs = dto.allocations ?? [];
      if (new Set(allocs.map((a) => a.documentId)).size !== allocs.length) throw new BadRequestException('Each invoice may appear only once in a settlement');
      let allocated = ZERO; // in the settlement currency (= invoice currency)
      let carrying = ZERO; // base-currency value those allocations clear from the party ledger
      const carry = new Map<string, Decimal>();
      for (const a of allocs) {
        const doc = await tx.document.findUnique({ where: { id: a.documentId } });
        if (!doc || doc.type !== 'INVOICE' || doc.status !== 'POSTED' || doc.partyId !== party.id) throw new BadRequestException('Allocations must target posted invoices of this party');
        if (doc.currency !== currency) throw new UnprocessableEntityException(`${doc.number} is in ${doc.currency}: settle it with a ${doc.currency} ${isReceiptKind(kind) ? 'receipt' : 'payment'} (currency must match the invoice)`);
        const paid = await tx.settlementAllocation.aggregate({ where: { documentId: doc.id }, _sum: { amount: true } });
        if (D(a.amount).lte(0)) throw new BadRequestException('Allocation amounts must be positive');
        if (D(a.amount).gt(doc.total.sub(D(paid._sum.amount)))) throw new UnprocessableEntityException(`Allocation exceeds outstanding of ${doc.number}`);
        const base = await carryingBase(tx, doc, D(a.amount), dp);
        carry.set(a.documentId, base);
        carrying = carrying.add(base);
        allocated = allocated.add(a.amount);
      }
      if (allocated.gt(amount)) throw new UnprocessableEntityException('Allocated amount exceeds the settlement amount');
      const fy = await this.periods.findFinancialYear(tx, companyId, date);
      if (!fy) throw new BadRequestException('Date is outside every financial year');
      const n = await this.seq.next(tx, companyId, `SETTLE:${kind}`, fy.id);
      const number = `${kind === 'RECEIPT' ? 'RCT' : 'PAY'}-${fy.startDate.getUTCFullYear()}-${this.seq.pad(n)}`;
      const isReceipt = kind === 'RECEIPT';
      const v = await this.vouchers.create(companyId, userId, {
        type: isReceipt ? 'RECEIPT' : 'PAYMENT', date: dto.date, reference: dto.reference ?? number, narration: `${number} ${party.name}`,
        ...(foreign ? { currency, exchangeRate: rate.toString() } : {}),
        lines: [
          { accountId: dto.accountId, [isReceipt ? 'debit' : 'credit']: dto.amount, description: number },
          { accountId: party.accountId, [isReceipt ? 'credit' : 'debit']: dto.amount, description: number },
        ],
      }, undefined, tx);
      await this.vouchers.post(companyId, userId, v.id, tx);
      // Realised FX: what the allocated part is worth in base currency at the settlement rate, against what the invoices carry on the ledger.
      const settledBase = foreign ? round(allocated.mul(rate), dp) : allocated;
      const fxGain = isReceipt ? settledBase.sub(carrying) : carrying.sub(settledBase); // > 0 gain, < 0 loss
      const s = await tx.settlement.create({
        data: { companyId, kind, number, partyId: party.id, settleDate: date, accountId: dto.accountId, amount, method: dto.method ?? 'BANK', reference: dto.reference, notes: dto.notes, voucherId: v.id, createdBy: userId,
          currency: foreign ? currency : null, exchangeRate: rate, fxAmount: fxGain,
          allocations: { create: allocs.map((a) => ({ companyId, documentId: a.documentId, amount: a.amount, baseAmount: carry.get(a.documentId)! })) } },
      });
      if (!fxGain.isZero()) {
        // The voucher valued the whole settlement at the settlement rate; this entry moves the difference between that and the
        // invoices' carrying value from the party ledger to the FX gain / loss account, so the invoice is cleared exactly.
        const fxAccount = await this.sys.get(tx, companyId, fxGain.gt(0) ? 'FX_GAIN' : 'FX_LOSS');
        const amt = fxGain.abs();
        const entry = await this.posting.post(tx, {
          companyId, userId, entryDate: date, sourceType: 'SYSTEM', sourceId: s.id, idempotencyKey: `settlement:${s.id}:fx`, narration: `Realised FX ${fxGain.gt(0) ? 'gain' : 'loss'} on ${number} ${party.name}`,
          lines: fxGain.gt(0)
            ? [{ accountId: party.accountId, debit: amt, description: number }, { accountId: fxAccount, credit: amt, description: number }]
            : [{ accountId: fxAccount, debit: amt, description: number }, { accountId: party.accountId, credit: amt, description: number }],
        });
        await tx.settlement.update({ where: { id: s.id }, data: { fxJournalEntryId: entry.id } });
      }
      await this.audit.log(tx, { companyId, userId, action: `${kind.toLowerCase()}.created`, entityType: 'settlement', entityId: s.id, after: { number, amount: dto.amount, currency, exchangeRate: rate.toString(), fx: fxGain.toString() } });
      return this.get(companyId, s.id, tx);
    });
  }

  async get(companyId: string, id: string, txIn?: Tx) {
    const run = async (tx: Tx) => {
      const s = await tx.settlement.findUnique({ where: { id }, include: { allocations: true, party: { select: { name: true, code: true } } } });
      if (!s) throw new NotFoundException('Not found');
      const docs = await tx.document.findMany({ where: { id: { in: s.allocations.map((a) => a.documentId) } }, select: { id: true, number: true } });
      const nm = new Map(docs.map((d) => [d.id, d.number]));
      const baseCurrency = (await tx.company.findUniqueOrThrow({ where: { id: s.companyId }, select: { baseCurrency: true } })).baseCurrency;
      return { ...s, currency: s.currency ?? baseCurrency, exchangeRate: s.exchangeRate.toString(), fxAmount: fmt(s.fxAmount), settleDate: isoDate(s.settleDate), amount: fmt(s.amount), unallocated: fmt(s.amount.sub(s.allocations.reduce((x, a) => x.add(a.amount), ZERO))), allocations: s.allocations.map((a) => ({ documentId: a.documentId, number: nm.get(a.documentId), amount: fmt(a.amount) })) };
    };
    return txIn ? run(txIn) : this.prisma.tenant(companyId, run);
  }

  async list(companyId: string, kind: SettlementKind, q: { partyId?: string; from?: string; to?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, Number(q.page) || 1), pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const where = { kind, ...(q.partyId ? { partyId: q.partyId } : {}), ...(q.from || q.to ? { settleDate: { ...(q.from ? { gte: parseDate(q.from) } : {}), ...(q.to ? { lte: parseDate(q.to) } : {}) } } : {}) };
    return this.prisma.tenant(companyId, async (tx) => {
      const [total, rows] = await Promise.all([tx.settlement.count({ where }), tx.settlement.findMany({ where, include: { party: { select: { name: true } } }, orderBy: [{ settleDate: 'desc' }, { number: 'desc' }], skip: (page - 1) * pageSize, take: pageSize })]);
      return paged(rows.map((s) => ({ ...s, settleDate: isoDate(s.settleDate), amount: fmt(s.amount) })), page, pageSize, total);
    });
  }

  async cancel(companyId: string, userId: string, id: string, reason: string) {
    return this.prisma.tenant(companyId, async (tx) => {
      const s = await tx.settlement.findUnique({ where: { id } });
      if (!s) throw new NotFoundException('Not found');
      if (s.status === 'CANCELLED') throw new ConflictException('Already cancelled');
      const cancelled = await this.vouchers.cancel(companyId, userId, s.voucherId!, `${s.number}: ${reason}`, undefined, tx);
      if (s.fxJournalEntryId) {
        const rev = await tx.journalEntry.findUniqueOrThrow({ where: { id: (cancelled as any).reversalEntryId }, select: { entryDate: true } });
        await this.posting.reverse(tx, { companyId, userId, entryId: s.fxJournalEntryId, entryDate: rev.entryDate, narration: `Reversal of realised FX on ${s.number}: ${reason}` });
      }
      await tx.settlementAllocation.deleteMany({ where: { settlementId: id } });
      await tx.settlement.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.log(tx, { companyId, userId, action: 'settlement.cancelled', entityType: 'settlement', entityId: id, after: { reason } });
      return { status: 'CANCELLED' };
    });
  }
}
