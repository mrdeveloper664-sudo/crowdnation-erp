import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SettlementKind } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { isoDate, parseDate } from '../common/dates';
import { paged } from '../common/interceptors/response.interceptor';
import { D, ZERO, fmt } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { IsMoney, IsoDate } from '../common/validators';
import { PeriodService } from '../accounting/period.service';
import { SequenceService } from '../accounting/sequence.service';
import { VouchersService } from '../vouchers/vouchers.service';

export class AllocationDto { @IsUUID() documentId: string; @IsMoney() amount: string }
export class SettlementDto {
  @IsUUID() partyId: string;
  @Matches(IsoDate) date: string;
  @IsMoney() amount: string;
  @IsUUID() accountId: string; // cash / bank ledger
  @IsOptional() @IsString() @MaxLength(20) method?: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => AllocationDto) allocations?: AllocationDto[];
}

@Injectable()
export class SettlementsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private periods: PeriodService, private vouchers: VouchersService) {}

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
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      const allocs = dto.allocations ?? [];
      let allocated = ZERO;
      for (const a of allocs) {
        const doc = await tx.document.findUnique({ where: { id: a.documentId } });
        if (!doc || doc.type !== 'INVOICE' || doc.status !== 'POSTED' || doc.partyId !== party.id) throw new BadRequestException('Allocations must target posted invoices of this party');
        if (doc.currency !== company.baseCurrency) throw new UnprocessableEntityException('Foreign-currency invoices must be settled with a voucher (FX settlement not supported yet)');
        const paid = await tx.settlementAllocation.aggregate({ where: { documentId: doc.id }, _sum: { amount: true } });
        if (D(a.amount).gt(doc.total.sub(D(paid._sum.amount)))) throw new UnprocessableEntityException(`Allocation exceeds outstanding of ${doc.number}`);
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
        lines: [
          { accountId: dto.accountId, [isReceipt ? 'debit' : 'credit']: dto.amount, description: number },
          { accountId: party.accountId, [isReceipt ? 'credit' : 'debit']: dto.amount, description: number },
        ],
      }, undefined, tx);
      await this.vouchers.post(companyId, userId, v.id, tx);
      const s = await tx.settlement.create({
        data: { companyId, kind, number, partyId: party.id, settleDate: date, accountId: dto.accountId, amount, method: dto.method ?? 'BANK', reference: dto.reference, notes: dto.notes, voucherId: v.id, createdBy: userId,
          allocations: { create: allocs.map((a) => ({ companyId, documentId: a.documentId, amount: a.amount })) } },
      });
      await this.audit.log(tx, { companyId, userId, action: `${kind.toLowerCase()}.created`, entityType: 'settlement', entityId: s.id, after: { number, amount: dto.amount } });
      return this.get(companyId, s.id, tx);
    });
  }

  async get(companyId: string, id: string, txIn?: Tx) {
    const run = async (tx: Tx) => {
      const s = await tx.settlement.findUnique({ where: { id }, include: { allocations: true, party: { select: { name: true, code: true } } } });
      if (!s) throw new NotFoundException('Not found');
      const docs = await tx.document.findMany({ where: { id: { in: s.allocations.map((a) => a.documentId) } }, select: { id: true, number: true } });
      const nm = new Map(docs.map((d) => [d.id, d.number]));
      return { ...s, settleDate: isoDate(s.settleDate), amount: fmt(s.amount), unallocated: fmt(s.amount.sub(s.allocations.reduce((x, a) => x.add(a.amount), ZERO))), allocations: s.allocations.map((a) => ({ documentId: a.documentId, number: nm.get(a.documentId), amount: fmt(a.amount) })) };
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
      await this.vouchers.cancel(companyId, userId, s.voucherId!, `${s.number}: ${reason}`, undefined, tx);
      await tx.settlementAllocation.deleteMany({ where: { settlementId: id } });
      await tx.settlement.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.log(tx, { companyId, userId, action: 'settlement.cancelled', entityType: 'settlement', entityId: id, after: { reason } });
      return { status: 'CANCELLED' };
    });
  }
}
