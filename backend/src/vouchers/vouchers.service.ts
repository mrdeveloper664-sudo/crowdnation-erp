import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, VoucherType } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { isoDate, parseDate } from '../common/dates';
import { paged } from '../common/interceptors/response.interceptor';
import { D, Decimal, ZERO, fmt } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { PeriodService } from '../accounting/period.service';
import { PostingService } from '../accounting/posting.service';
import { SequenceService } from '../accounting/sequence.service';
import { VatService } from '../vat/vat.service';
import { NotificationsService } from '../common/notifications.service';
import { UpdateVoucherDto, VoucherDto, VoucherQuery } from './vouchers.dto';

const CASH_BANK = ['CASH', 'BANK'];
const EDITABLE = ['DRAFT', 'REJECTED'];

@Injectable()
export class VouchersService {
  constructor(
    private prisma: PrismaService, private posting: PostingService, private periods: PeriodService,
    private sequences: SequenceService, private audit: AuditService, private vat: VatService, private notes: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ validation
  /** Normalises lines and enforces the accounting rules of each voucher type. */
  private async validate(tx: Tx, companyId: string, type: VoucherType, lines: VoucherDto['lines'], dp: number) {
    const accounts = await tx.account.findMany({ where: { companyId, id: { in: [...new Set(lines.map((l) => l.accountId))] } } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    let dr = ZERO, cr = ZERO;
    const taxIds = [...new Set(lines.map((l) => l.taxRateId).filter(Boolean) as string[])];
    const rates = new Map((await tx.taxRate.findMany({ where: { companyId, id: { in: taxIds } } })).map((r) => [r.id, r]));
    const out = lines.map((l, i) => {
      const acc = byId.get(l.accountId);
      if (!acc) throw new BadRequestException(`Line ${i + 1}: account not found`);
      if (!acc.isActive) throw new UnprocessableEntityException(`Line ${i + 1}: account ${acc.code} is inactive`);
      const d = D(l.debit), c = D(l.credit);
      const taxOnly = !!l.taxRateId && d.isZero() && c.isZero();
      if (!taxOnly && d.gt(0) === c.gt(0)) throw new UnprocessableEntityException(`Line ${i + 1}: enter either a debit or a credit amount`);
      if (d.decimalPlaces() > dp || c.decimalPlaces() > dp) throw new UnprocessableEntityException(`Line ${i + 1}: at most ${dp} decimal places`);
      if (l.taxRateId) {
        const rate = rates.get(l.taxRateId);
        if (!rate) throw new BadRequestException(`Line ${i + 1}: tax rate not found`);
        if (!['VAT_INPUT', 'VAT_OUTPUT'].includes(acc.type)) throw new UnprocessableEntityException(`Line ${i + 1}: tax details are only allowed on VAT ledgers`);
        if (!l.taxableAmount) throw new UnprocessableEntityException(`Line ${i + 1}: taxableAmount is required with a tax rate`);
        const amount = d.add(c);
        if (rate.treatment === 'STANDARD') {
          if (taxOnly) throw new UnprocessableEntityException(`Line ${i + 1}: a standard rated line needs a VAT amount`);
          const expected = D(l.taxableAmount).mul(rate.rate).div(100).toDecimalPlaces(dp);
          if (amount.sub(expected).abs().gt(Math.max(0.05, 0.005 * lines.length))) throw new UnprocessableEntityException(`Line ${i + 1}: VAT ${amount.toFixed(dp)} does not match ${rate.rate}% of ${l.taxableAmount} (expected ${expected.toFixed(dp)})`);
        } else if (!amount.isZero()) throw new UnprocessableEntityException(`Line ${i + 1}: ${rate.treatment} transactions carry no VAT amount`);
      }
      dr = dr.add(d); cr = cr.add(c);
      return { accountId: l.accountId, debit: d, credit: c, description: l.description, taxRateId: l.taxRateId, taxableAmount: l.taxableAmount ? D(l.taxableAmount) : undefined, isCashBank: CASH_BANK.includes(acc.type), dr: d.gt(0) };
    });
    // Reverse charge must be recorded as equal input and output VAT (per tax code), and only on purchase-side vouchers.
    const rcLines = out.filter((l) => l.taxRateId && rates.get(l.taxRateId)?.isReverseCharge);
    if (rcLines.length) {
      if (!['PURCHASE', 'DEBIT_NOTE', 'JOURNAL'].includes(type)) throw new UnprocessableEntityException(`Reverse-charge VAT cannot be used on a ${type.replace('_', ' ').toLowerCase()} voucher`);
      const perRate = new Map<string, { input: Decimal; output: Decimal }>();
      for (const l of rcLines) {
        const g = perRate.get(l.taxRateId!) ?? { input: ZERO, output: ZERO };
        if (byId.get(l.accountId)!.type === 'VAT_INPUT') g.input = g.input.add(l.debit).sub(l.credit); else g.output = g.output.add(l.credit).sub(l.debit);
        perRate.set(l.taxRateId!, g);
      }
      for (const g of perRate.values()) if (!g.input.eq(g.output)) throw new UnprocessableEntityException('Reverse-charge VAT must be recorded as equal input VAT and output VAT');
    }
    if (!dr.eq(cr)) throw new UnprocessableEntityException(`Voucher is not balanced: debit ${dr.toFixed(dp)} <> credit ${cr.toFixed(dp)}`);
    switch (type) {
      case 'PAYMENT': // money goes OUT: credits are cash/bank, debits are not
        if (out.some((l) => !l.dr && !l.isCashBank) || out.some((l) => l.dr && l.isCashBank)) throw new UnprocessableEntityException('Payment voucher: credit cash/bank ledgers and debit the payee/expense ledgers');
        break;
      case 'RECEIPT': // money comes IN
        if (out.some((l) => l.dr && !l.isCashBank) || out.some((l) => !l.dr && l.isCashBank)) throw new UnprocessableEntityException('Receipt voucher: debit cash/bank ledgers and credit the payer/income ledgers');
        break;
      case 'CONTRA':
        if (out.some((l) => !l.isCashBank)) throw new UnprocessableEntityException('Contra voucher may only use cash and bank ledgers');
        break;
      default: break;
    }
    return { lines: out.map(({ isCashBank, dr: _d, ...l }) => l), total: dr };
  }

  private async settings(tx: Tx, companyId: string) {
    const [company, s] = await Promise.all([
      tx.company.findUniqueOrThrow({ where: { id: companyId } }),
      tx.companySetting.findUniqueOrThrow({ where: { companyId } }),
    ]);
    return { company, s, dp: s.amountDecimals };
  }

  private async resolveFx(tx: Tx, companyId: string, base: string, date: Date, currency?: string, rate?: string) {
    const cur = (currency ?? base).toUpperCase();
    if (cur === base) return { currency: base, exchangeRate: D(1) };
    let r = rate ? D(rate) : null;
    if (!r) {
      const found = await tx.exchangeRate.findFirst({ where: { currency: cur, rateDate: { lte: date } }, orderBy: { rateDate: 'desc' } });
      if (!found) throw new BadRequestException(`No exchange rate for ${cur}; supply exchangeRate or define one`);
      r = found.rate;
    }
    if (r.lte(0)) throw new BadRequestException('Exchange rate must be positive');
    return { currency: cur, exchangeRate: r };
  }

  // ------------------------------------------------------------------ CRUD
  async create(companyId: string, userId: string, dto: VoucherDto, replacesId?: string, txIn?: Tx) {
    const run = async (tx: Tx) => {
      const date = parseDate(dto.date);
      const { company, s, dp } = await this.settings(tx, companyId);
      const fy = await this.periods.findFinancialYear(tx, companyId, date);
      if (!fy) throw new BadRequestException('Voucher date is outside every financial year');
      const fx = await this.resolveFx(tx, companyId, company.baseCurrency, date, dto.currency, dto.exchangeRate);
      const v = await this.validate(tx, companyId, dto.type, dto.lines, dp);
      const prefixes = (s.voucherPrefixes as Record<string, string>) ?? {};
      const n = await this.sequences.next(tx, companyId, `VOUCHER:${dto.type}`, fy.id);
      const number = `${prefixes[dto.type] ?? dto.type.slice(0, 2)}-${fy.startDate.getUTCFullYear()}-${this.sequences.pad(n)}`;
      const voucher = await tx.voucher.create({
        data: {
          companyId, type: dto.type, number, voucherDate: date, reference: dto.reference, narration: dto.narration,
          currency: fx.currency, exchangeRate: fx.exchangeRate, totalAmount: v.total, branchId: dto.branchId, createdBy: userId, replacesId,
          lines: { create: v.lines.map((l, i) => ({ companyId, lineNo: i + 1, accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description, taxRateId: l.taxRateId, taxableAmount: l.taxableAmount })) },
        },
        include: { lines: true },
      });
      await this.audit.log(tx, { companyId, userId, action: 'voucher.created', entityType: 'voucher', entityId: voucher.id, after: { number, type: dto.type, total: v.total.toString() } });
      return this.present(voucher);
    };
    return txIn ? run(txIn) : this.prisma.tenant(companyId, run);
  }

  async update(companyId: string, userId: string, id: string, dto: UpdateVoucherDto) {
    return this.prisma.tenant(companyId, async (tx) => {
      const v = await this.lock(tx, id);
      if (!EDITABLE.includes(v.status)) throw new ConflictException(`A ${v.status} voucher cannot be edited. Cancel/reverse it and use "replace" instead.`);
      const { company, dp } = await this.settings(tx, companyId);
      const date = dto.date ? parseDate(dto.date) : v.voucherDate;
      const fx = await this.resolveFx(tx, companyId, company.baseCurrency, date, dto.currency ?? v.currency, dto.exchangeRate ?? (dto.currency ? undefined : v.exchangeRate.toString()));
      const data: Prisma.VoucherUpdateInput = { voucherDate: date, reference: dto.reference ?? v.reference, narration: dto.narration ?? v.narration, currency: fx.currency, exchangeRate: fx.exchangeRate, status: 'DRAFT', rejectedReason: null };
      if (dto.lines) {
        const val = await this.validate(tx, companyId, v.type, dto.lines, dp);
        await tx.voucherLine.deleteMany({ where: { voucherId: id } });
        await tx.voucherLine.createMany({ data: val.lines.map((l, i) => ({ companyId, voucherId: id, lineNo: i + 1, accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description, taxRateId: l.taxRateId, taxableAmount: l.taxableAmount })) });
        data.totalAmount = val.total;
      }
      await tx.voucher.update({ where: { id }, data });
      await this.audit.log(tx, { companyId, userId, action: 'voucher.updated', entityType: 'voucher', entityId: id, before: { status: v.status }, after: dto });
      return this.get(companyId, id, tx);
    });
  }

  async remove(companyId: string, userId: string, id: string) {
    return this.prisma.tenant(companyId, async (tx) => {
      const v = await this.lock(tx, id);
      if (v.status !== 'DRAFT') throw new ConflictException('Only draft vouchers can be deleted; others must be cancelled');
      await tx.voucher.delete({ where: { id } });
      await this.audit.log(tx, { companyId, userId, action: 'voucher.deleted', entityType: 'voucher', entityId: id, before: { number: v.number } });
      return { deleted: true };
    });
  }

  async get(companyId: string, id: string, txIn?: Tx) {
    const run = async (tx: Tx) => {
      const v = await tx.voucher.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' }, include: { account: { select: { code: true, name: true } } } } } });
      if (!v) throw new NotFoundException('Voucher not found');
      const history = await tx.auditLog.findMany({ where: { entityType: 'voucher', entityId: id }, orderBy: { createdAt: 'asc' }, select: { action: true, userId: true, createdAt: true } });
      return { ...this.present(v), history };
    };
    return txIn ? run(txIn) : this.prisma.tenant(companyId, run);
  }

  async list(companyId: string, q: VoucherQuery) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const where: Prisma.VoucherWhereInput = {
      ...(q.type ? { type: q.type } : {}), ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to ? { voucherDate: { ...(q.from ? { gte: parseDate(q.from) } : {}), ...(q.to ? { lte: parseDate(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { reference: { contains: q.search, mode: 'insensitive' } }, { narration: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    return this.prisma.tenant(companyId, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.voucher.count({ where }),
        tx.voucher.findMany({ where, orderBy: [{ voucherDate: 'desc' }, { number: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return paged(rows.map((v) => ({ ...v, voucherDate: isoDate(v.voucherDate), totalAmount: fmt(v.totalAmount) })), page, pageSize, total);
    });
  }

  // ------------------------------------------------------------------ workflow
  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM vouchers WHERE id = ${id}::uuid FOR UPDATE`;
    const v = await tx.voucher.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!v) throw new NotFoundException('Voucher not found');
    return v;
  }

  async submit(companyId: string, userId: string, id: string) {
    return this.prisma.tenant(companyId, async (tx) => {
      const v = await this.lock(tx, id);
      if (!EDITABLE.includes(v.status)) throw new ConflictException(`Cannot submit a ${v.status} voucher`);
      await tx.voucher.update({ where: { id }, data: { status: 'PENDING_APPROVAL', submittedBy: userId, rejectedReason: null } });
      await this.audit.log(tx, { companyId, userId, action: 'voucher.submitted', entityType: 'voucher', entityId: id });
      await this.notes.notify(tx, companyId, (await this.notes.usersWith(tx, 'voucher', 'approve')).filter((x) => x !== userId), 'Voucher awaiting approval', v.number, `/vouchers/${id}`);
      return { status: 'PENDING_APPROVAL' };
    });
  }

  async approve(companyId: string, userId: string, id: string) {
    return this.prisma.tenant(companyId, async (tx) => {
      const v = await this.lock(tx, id);
      const { s } = await this.settings(tx, companyId);
      if (v.status !== 'PENDING_APPROVAL') throw new ConflictException(`Cannot approve a ${v.status} voucher`);
      if (v.createdBy === userId && !s.allowSelfApproval) throw new ForbiddenException('Segregation of duties: you cannot approve your own voucher');
      await tx.voucher.update({ where: { id }, data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date() } });
      await this.audit.log(tx, { companyId, userId, action: 'voucher.approved', entityType: 'voucher', entityId: id });
      return { status: 'APPROVED' };
    });
  }

  async reject(companyId: string, userId: string, id: string, reason: string) {
    return this.prisma.tenant(companyId, async (tx) => {
      const v = await this.lock(tx, id);
      if (v.status !== 'PENDING_APPROVAL') throw new ConflictException(`Cannot reject a ${v.status} voucher`);
      await tx.voucher.update({ where: { id }, data: { status: 'REJECTED', rejectedReason: reason } });
      await this.audit.log(tx, { companyId, userId, action: 'voucher.rejected', entityType: 'voucher', entityId: id, after: { reason } });
      return { status: 'REJECTED' };
    });
  }

  /** Posts the voucher through the central posting engine, in a single DB transaction. */
  async post(companyId: string, userId: string, id: string, txIn?: Tx) {
    const run = async (tx: Tx) => {
      const v = await this.lock(tx, id);
      const { s } = await this.settings(tx, companyId);
      if (v.status === 'POSTED') throw new ConflictException('Voucher is already posted');
      const allowed = s.requireVoucherApproval ? ['APPROVED'] : ['DRAFT', 'APPROVED'];
      if (!allowed.includes(v.status)) {
        throw new ConflictException(s.requireVoucherApproval ? `Voucher must be APPROVED before posting (currently ${v.status})` : `Cannot post a ${v.status} voucher`);
      }
      if (!s.allowBackdatedPosting && v.voucherDate < parseDate(new Date().toISOString().slice(0, 10))) throw new ForbiddenException('Back-dated posting is disabled');
      const entry = await this.posting.post(tx, {
        companyId, userId, entryDate: v.voucherDate, sourceType: 'VOUCHER', sourceId: v.id, idempotencyKey: `voucher:${v.id}:post`,
        narration: `${v.number}${v.narration ? ' - ' + v.narration : ''}`, currency: v.currency, exchangeRate: v.exchangeRate, branchId: v.branchId ?? undefined,
        lines: v.lines.filter((l) => l.debit.gt(0) || l.credit.gt(0)).map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, description: l.description ?? undefined })),
      });
      await this.recordTax(tx, companyId, v, entry.id);
      await tx.voucher.update({ where: { id }, data: { status: 'POSTED', postedBy: userId, postedAt: new Date(), journalEntryId: entry.id } });
      await this.audit.log(tx, { companyId, userId, action: 'voucher.posted', entityType: 'voucher', entityId: id, after: { entry: entry.entryNumber } });
      return { status: 'POSTED', journalEntryId: entry.id, entryNumber: entry.entryNumber };
    };
    return txIn ? run(txIn) : this.prisma.tenant(companyId, run);
  }

  /** Cancel: drafts are simply cancelled; posted vouchers are cancelled by a mirror (reversal) journal entry. */
  async cancel(companyId: string, userId: string, id: string, reason: string, reverseDate?: string, txIn?: Tx) {
    const run = async (tx: Tx) => {
      const v = await this.lock(tx, id);
      if (v.status === 'CANCELLED') throw new ConflictException('Voucher is already cancelled');
      let reversalEntryId: string | undefined;
      if (v.status === 'POSTED') {
        const entry = await this.posting.reverse(tx, {
          companyId, userId, entryId: v.journalEntryId!, entryDate: reverseDate ? parseDate(reverseDate) : v.voucherDate > new Date() ? v.voucherDate : parseDate(new Date().toISOString().slice(0, 10)),
          narration: `Reversal of ${v.number}: ${reason}`,
        });
        reversalEntryId = entry.id;
        await this.vat.reverseSource(tx, companyId, 'VOUCHER', v.id, entry.id, entry.entryDate);
      }
      await tx.voucher.update({ where: { id }, data: { status: 'CANCELLED', cancelledBy: userId, cancelledAt: new Date(), cancelReason: reason, reversalEntryId } });
      await this.audit.log(tx, { companyId, userId, action: 'voucher.cancelled', entityType: 'voucher', entityId: id, after: { reason, reversalEntryId } });
      return { status: 'CANCELLED', reversalEntryId: reversalEntryId ?? null, original: v };
    };
    const r = txIn ? await run(txIn) : await this.prisma.tenant(companyId, run);
    const { original, ...rest } = r;
    return txIn ? r : rest;
  }

  /** Controlled correction of a posted voucher: reverse it and open a replacement draft linked to the original. */
  async replace(companyId: string, userId: string, id: string, reason: string) {
    return this.prisma.tenant(companyId, async (tx) => {
      const cancelled: any = await this.cancel(companyId, userId, id, reason, undefined, tx);
      const o = cancelled.original;
      const draft = await this.create(companyId, userId, {
        type: o.type, date: isoDate(o.voucherDate), reference: o.reference ?? undefined, narration: o.narration ?? undefined,
        currency: o.currency, exchangeRate: o.exchangeRate.toString(), branchId: o.branchId ?? undefined,
        lines: o.lines.map((l: any) => ({ accountId: l.accountId, debit: l.debit.gt(0) ? l.debit.toString() : undefined, credit: l.credit.gt(0) ? l.credit.toString() : undefined, description: l.description ?? undefined })),
      }, id, tx);
      return { cancelledVoucherId: id, reversalEntryId: cancelled.reversalEntryId, replacement: draft };
    });
  }

  /** Writes tax_transactions for VAT-tagged voucher lines. Credit notes / debit notes reduce VAT. */
  private async recordTax(tx: Tx, companyId: string, v: any, entryId: string) {
    const tagged = v.lines.filter((l: any) => l.taxRateId);
    if (!tagged.length) return;
    const accounts = new Map((await tx.account.findMany({ where: { id: { in: tagged.map((l: any) => l.accountId) } } })).map((a) => [a.id, a]));
    for (const l of tagged) {
      const type = accounts.get(l.accountId)!.type;
      const direction = type === 'VAT_OUTPUT' ? 'OUTPUT' : 'INPUT';
      const amount = l.debit.add(l.credit);
      const increases = direction === 'OUTPUT' ? l.credit.gt(0) : l.debit.gt(0);
      const sign = amount.gt(0) ? (increases ? 1 : -1) : ['CREDIT_NOTE', 'DEBIT_NOTE'].includes(v.type) ? -1 : 1;
      await this.vat.record(tx, {
        companyId, journalEntryId: entryId, sourceType: 'VOUCHER', sourceId: v.id, taxRateId: l.taxRateId, direction, txnDate: v.voucherDate,
        taxable: l.taxableAmount.mul(sign), tax: amount.mul(sign), isAdjustment: v.type === 'JOURNAL',
      });
    }
  }

  private present(v: any) {
    return {
      ...v, voucherDate: isoDate(v.voucherDate), totalAmount: fmt(v.totalAmount), exchangeRate: v.exchangeRate.toString(),
      lines: v.lines?.map((l: any) => ({ ...l, debit: fmt(l.debit), credit: fmt(l.credit) })),
    };
  }
}
