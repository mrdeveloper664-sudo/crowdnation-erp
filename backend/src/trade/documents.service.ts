import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DocSide, DocType, Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { isoDate, parseDate } from '../common/dates';
import { paged } from '../common/interceptors/response.interceptor';
import { D, Decimal, ZERO, fmt, round } from '../common/money';
import { PrismaService, Tx } from '../common/prisma.service';
import { PeriodService } from '../accounting/period.service';
import { SequenceService } from '../accounting/sequence.service';
import { SystemAccountsService } from '../accounting/system-accounts.service';
import { VatService } from '../vat/vat.service';
import { calculateVat } from '../vat/vat.engine';
import { VouchersService } from '../vouchers/vouchers.service';
import { DocDto, DocLineDto, UpdateDocDto } from './documents.dto';
import { partyBalance } from './parties.controller';
import { InventoryHooks } from './inventory.hooks';

export const TYPES: Record<DocSide, DocType[]> = {
  SALES: ['QUOTATION', 'ORDER', 'INVOICE', 'CREDIT_NOTE'],
  PURCHASE: ['REQUEST', 'ORDER', 'GRN', 'INVOICE', 'DEBIT_NOTE'],
};
const PREFIX: Record<string, string> = { 'SALES:QUOTATION': 'QT', 'SALES:ORDER': 'SO', 'SALES:INVOICE': 'INV', 'SALES:CREDIT_NOTE': 'CN', 'PURCHASE:REQUEST': 'PR', 'PURCHASE:ORDER': 'PO', 'PURCHASE:GRN': 'GRN', 'PURCHASE:INVOICE': 'PINV', 'PURCHASE:DEBIT_NOTE': 'DN' };
const POSTING: DocType[] = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'];
const CONVERT: Record<string, DocType[]> = { 'SALES:QUOTATION': ['ORDER', 'INVOICE'], 'SALES:ORDER': ['INVOICE'], 'PURCHASE:REQUEST': ['ORDER'], 'PURCHASE:ORDER': ['GRN', 'INVOICE'], 'PURCHASE:GRN': ['INVOICE'] };

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private periods: PeriodService,
    private vat: VatService, private vouchers: VouchersService, private sys: SystemAccountsService, private inventory: InventoryHooks,
  ) {}

  // ------------------------------------------------------------------ calculation
  private async compute(tx: Tx, companyId: string, side: DocSide, date: Date, inclusive: boolean, lines: DocLineDto[], dp: number) {
    const out: any[] = []; let net = ZERO, vat = ZERO;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const product = l.productId ? await this.inventory.productDefaults(tx, companyId, l.productId, side) : null;
      const qty = D(l.quantity);
      if (qty.lte(0)) throw new UnprocessableEntityException(`Line ${i + 1}: quantity must be positive`);
      const price = D(l.unitPrice ?? product?.price ?? 0);
      const disc = D(l.discountPct ?? 0);
      if (disc.gt(100)) throw new UnprocessableEntityException(`Line ${i + 1}: discount cannot exceed 100%`);
      const base = round(qty.mul(price).mul(D(100).sub(disc)).div(100), dp);
      const code = l.taxCode ?? product?.taxCode ?? 'STD';
      const rate = await this.vat.resolve(tx, companyId, code, date);
      const c = calculateVat(base, rate.rate, inclusive, dp);
      net = net.add(c.net); vat = vat.add(c.vat);
      out.push({ productId: l.productId, description: l.description ?? product?.name ?? '', quantity: qty, unitPrice: price, discountPct: disc, taxRateId: rate.id, net: c.net, vat: c.vat, gross: c.gross, accountId: l.accountId ?? product?.accountId, warehouseId: l.warehouseId, batchNo: l.batchNo, serialNos: l.serialNos ?? [], sourceLineId: l.sourceLineId });
      if (!out[i].description) throw new UnprocessableEntityException(`Line ${i + 1}: description is required`);
    }
    return { lines: out, net, vat, total: net.add(vat) };
  }

  private async settings(tx: Tx, companyId: string) {
    const [company, s] = await Promise.all([tx.company.findUniqueOrThrow({ where: { id: companyId } }), tx.companySetting.findUniqueOrThrow({ where: { companyId } })]);
    return { company, dp: s.amountDecimals };
  }

  // ------------------------------------------------------------------ CRUD
  async create(companyId: string, userId: string, side: DocSide, dto: DocDto, txIn?: Tx) {
    const run = async (tx: Tx) => {
      if (!TYPES[side].includes(dto.type)) throw new BadRequestException(`${dto.type} is not a ${side.toLowerCase()} document`);
      const date = parseDate(dto.date);
      const party = await tx.party.findUnique({ where: { id: dto.partyId } });
      if (!party || party.kind !== (side === 'SALES' ? 'CUSTOMER' : 'SUPPLIER') || !party.isActive) throw new BadRequestException(`Active ${side === 'SALES' ? 'customer' : 'supplier'} required`);
      const { company, dp } = await this.settings(tx, companyId);
      const currency = (dto.currency ?? company.baseCurrency).toUpperCase();
      let rate = D(1);
      if (currency !== company.baseCurrency) {
        const r = dto.exchangeRate ? D(dto.exchangeRate) : (await tx.exchangeRate.findFirst({ where: { currency, rateDate: { lte: date } }, orderBy: { rateDate: 'desc' } }))?.rate;
        if (!r) throw new BadRequestException(`No exchange rate for ${currency}`);
        rate = D(r);
      }
      const calc = await this.compute(tx, companyId, side, date, !!dto.pricesIncludeVat, dto.lines, dp);
      const fy = await this.periods.findFinancialYear(tx, companyId, date);
      if (!fy) throw new BadRequestException('Document date is outside every financial year');
      const n = await this.seq.next(tx, companyId, `DOC:${side}:${dto.type}`, fy.id);
      const number = `${PREFIX[`${side}:${dto.type}`]}-${fy.startDate.getUTCFullYear()}-${this.seq.pad(n)}`;
      const dueDate = dto.dueDate ? parseDate(dto.dueDate) : POSTING.includes(dto.type) ? new Date(date.getTime() + party.paymentTermsDays * 86_400_000) : null;
      const doc = await tx.document.create({
        data: {
          companyId, side, type: dto.type, number, partyId: party.id, docDate: date, dueDate, currency, exchangeRate: rate, pricesIncludeVat: !!dto.pricesIncludeVat,
          net: calc.net, vat: calc.vat, total: calc.total, reference: dto.reference, notes: dto.notes, warehouseId: dto.warehouseId, projectId: dto.projectId, sourceDocId: dto.sourceDocId, createdBy: userId,
          lines: { create: calc.lines.map((l, i) => ({ ...l, companyId, lineNo: i + 1 })) },
        },
      });
      await this.audit.log(tx, { companyId, userId, action: `${side.toLowerCase()}_${dto.type.toLowerCase()}.created`, entityType: 'document', entityId: doc.id, after: { number, total: calc.total.toString() } });
      return this.get(companyId, doc.id, tx);
    };
    return txIn ? run(txIn) : this.prisma.tenant(companyId, run);
  }

  async update(companyId: string, userId: string, id: string, dto: UpdateDocDto) {
    return this.prisma.tenant(companyId, async (tx) => {
      const d = await this.lock(tx, id);
      if (d.status !== 'DRAFT') throw new ConflictException('Only draft documents can be edited');
      const { dp } = await this.settings(tx, companyId);
      const date = dto.date ? parseDate(dto.date) : d.docDate;
      const data: Prisma.DocumentUpdateInput = { docDate: date, dueDate: dto.dueDate ? parseDate(dto.dueDate) : d.dueDate, reference: dto.reference ?? d.reference, notes: dto.notes ?? d.notes, pricesIncludeVat: dto.pricesIncludeVat ?? d.pricesIncludeVat };
      if (dto.warehouseId) data.warehouseId = dto.warehouseId;
      if (dto.projectId) data.projectId = dto.projectId;
      if (dto.lines || dto.pricesIncludeVat !== undefined || dto.date) {
        const src = dto.lines ?? d.lines.map((l) => ({ productId: l.productId ?? undefined, description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.toString(), accountId: l.accountId ?? undefined, warehouseId: l.warehouseId ?? undefined, taxCode: undefined as any, _taxRateId: l.taxRateId }));
        // keep each existing line's tax code when only totals need recalculation
        for (const l of src as any[]) if (l._taxRateId) { const r = await tx.taxRate.findUnique({ where: { id: l._taxRateId } }); l.taxCode = r?.code; }
        const calc = await this.compute(tx, companyId, d.side, date, dto.pricesIncludeVat ?? d.pricesIncludeVat, src as DocLineDto[], dp);
        await tx.documentLine.deleteMany({ where: { documentId: id } });
        await tx.documentLine.createMany({ data: calc.lines.map((l, i) => ({ ...l, companyId, documentId: id, lineNo: i + 1 })) });
        data.net = calc.net; data.vat = calc.vat; data.total = calc.total;
      }
      await tx.document.update({ where: { id }, data });
      await this.audit.log(tx, { companyId, userId, action: 'document.updated', entityType: 'document', entityId: id });
      return this.get(companyId, id, tx);
    });
  }

  async remove(companyId: string, userId: string, id: string) {
    return this.prisma.tenant(companyId, async (tx) => {
      const d = await this.lock(tx, id);
      if (d.status !== 'DRAFT') throw new ConflictException('Only draft documents can be deleted');
      await tx.document.delete({ where: { id } });
      await this.audit.log(tx, { companyId, userId, action: 'document.deleted', entityType: 'document', entityId: id, before: { number: d.number } });
      return { deleted: true };
    });
  }

  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM documents WHERE id = ${id}::uuid FOR UPDATE`;
    const d = await tx.document.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } }, party: true } });
    if (!d) throw new NotFoundException('Document not found');
    return d;
  }

  private async allocatedTo(tx: Tx, docIds: string[]) {
    const g = await tx.settlementAllocation.groupBy({ by: ['documentId'], where: { documentId: { in: docIds } }, _sum: { amount: true } });
    return new Map(g.map((x) => [x.documentId, D(x._sum.amount)]));
  }
  private async appliedFrom(tx: Tx, docIds: string[]) {
    const g = await tx.settlementAllocation.groupBy({ by: ['creditDocumentId'], where: { creditDocumentId: { in: docIds } }, _sum: { amount: true } });
    return new Map(g.map((x) => [x.creditDocumentId!, D(x._sum.amount)]));
  }

  private present(d: any, paid?: Decimal, applied?: Decimal) {
    const isCredit = d.type === 'CREDIT_NOTE' || d.type === 'DEBIT_NOTE';
    const settled = isCredit ? applied ?? ZERO : paid ?? ZERO;
    return {
      ...d, docDate: isoDate(d.docDate), dueDate: d.dueDate ? isoDate(d.dueDate) : null, net: fmt(d.net), vat: fmt(d.vat), total: fmt(d.total), exchangeRate: d.exchangeRate.toString(),
      paid: fmt(settled), outstanding: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(d.type) && d.status === 'POSTED' ? fmt(D(d.total).sub(settled)) : null,
      lines: d.lines?.map((l: any) => ({ ...l, quantity: l.quantity.toString(), unitPrice: fmt(l.unitPrice, 4), discountPct: l.discountPct.toString(), net: fmt(l.net), vat: fmt(l.vat), gross: fmt(l.gross) })),
    };
  }

  async get(companyId: string, id: string, txIn?: Tx) {
    const run = async (tx: Tx) => {
      const d = await tx.document.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } }, party: { select: { id: true, code: true, name: true, trn: true, email: true } } } });
      if (!d) throw new NotFoundException('Document not found');
      const [paid, applied] = await Promise.all([this.allocatedTo(tx, [id]), this.appliedFrom(tx, [id])]);
      const voucher = d.voucherId ? await tx.voucher.findUnique({ where: { id: d.voucherId }, select: { number: true, status: true } }) : null;
      return { ...this.present(d, paid.get(id), applied.get(id)), voucher };
    };
    return txIn ? run(txIn) : this.prisma.tenant(companyId, run);
  }

  async list(companyId: string, side: DocSide, q: { type?: DocType; status?: string; partyId?: string; from?: string; to?: string; search?: string; outstanding?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, Number(q.page) || 1), pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
    const where: Prisma.DocumentWhereInput = {
      side, ...(q.type ? { type: q.type } : {}), ...(q.status ? { status: q.status as any } : {}), ...(q.partyId ? { partyId: q.partyId } : {}),
      ...(q.from || q.to ? { docDate: { ...(q.from ? { gte: parseDate(q.from) } : {}), ...(q.to ? { lte: parseDate(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { reference: { contains: q.search, mode: 'insensitive' } }, { party: { name: { contains: q.search, mode: 'insensitive' } } }] } : {}),
    };
    return this.prisma.tenant(companyId, async (tx) => {
      const all = q.outstanding === 'true';
      const rows = await tx.document.findMany({ where: all ? { ...where, status: 'POSTED', type: { in: ['INVOICE'] } } : where, include: { party: { select: { name: true, code: true } } }, orderBy: [{ docDate: 'desc' }, { number: 'desc' }], ...(all ? {} : { skip: (page - 1) * pageSize, take: pageSize }) });
      const ids = rows.map((r) => r.id);
      const [paid, applied] = await Promise.all([this.allocatedTo(tx, ids), this.appliedFrom(tx, ids)]);
      let items = rows.map((r) => this.present({ ...r, lines: undefined }, paid.get(r.id), applied.get(r.id)));
      if (all) { items = items.filter((i) => D(i.outstanding ?? 0).gt(0)); const total = items.length; return paged(items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total); }
      return paged(items, page, pageSize, await tx.document.count({ where }));
    });
  }

  // ------------------------------------------------------------------ workflow
  async confirm(companyId: string, userId: string, id: string) {
    return this.prisma.tenant(companyId, async (tx) => {
      const d = await this.lock(tx, id);
      if (POSTING.includes(d.type)) throw new BadRequestException('Invoices and notes are posted, not confirmed');
      if (d.status !== 'DRAFT') throw new ConflictException(`Cannot confirm a ${d.status} document`);
      if (d.type === 'GRN') await this.inventory.receiveGrn(tx, companyId, userId, d);
      await tx.document.update({ where: { id }, data: { status: 'CONFIRMED' } });
      await this.audit.log(tx, { companyId, userId, action: 'document.confirmed', entityType: 'document', entityId: id });
      return { status: 'CONFIRMED' };
    });
  }

  async convert(companyId: string, userId: string, id: string, to: DocType) {
    return this.prisma.tenant(companyId, async (tx) => {
      const d = await this.lock(tx, id);
      const allowed = CONVERT[`${d.side}:${d.type}`] ?? [];
      if (!allowed.includes(to)) throw new BadRequestException(`${d.type} cannot be converted to ${to}`);
      if (d.type !== 'QUOTATION' && d.type !== 'REQUEST' && d.status !== 'CONFIRMED') throw new ConflictException('Confirm the document before converting it');
      if (d.status === 'CONVERTED' || d.status === 'CANCELLED') throw new ConflictException(`Document is ${d.status}`);
      const dto: DocDto = {
        type: to, partyId: d.partyId, date: new Date().toISOString().slice(0, 10), currency: d.currency, exchangeRate: d.exchangeRate.toString(), pricesIncludeVat: d.pricesIncludeVat, reference: d.reference ?? undefined,
        notes: d.notes ?? undefined, warehouseId: d.warehouseId ?? undefined, projectId: d.projectId ?? undefined, sourceDocId: d.id,
        lines: await Promise.all(d.lines.map(async (l) => ({
          productId: l.productId ?? undefined, description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discountPct: l.discountPct.toString(),
          taxCode: l.taxRateId ? (await tx.taxRate.findUnique({ where: { id: l.taxRateId } }))?.code : undefined, accountId: l.accountId ?? undefined, warehouseId: l.warehouseId ?? undefined, sourceLineId: l.id,
        }))),
      };
      const doc = await this.create(companyId, userId, d.side, dto, tx);
      if (!(d.type === 'ORDER' && to === 'GRN')) await tx.document.update({ where: { id }, data: { status: 'CONVERTED' } });
      await this.audit.log(tx, { companyId, userId, action: 'document.converted', entityType: 'document', entityId: id, after: { to, newId: doc.id } });
      return doc;
    });
  }

  /** Posts an invoice / credit note / debit note through the voucher + posting engine (one transaction). */
  async post(companyId: string, userId: string, id: string, txIn?: Tx) {
    const run = async (tx: Tx) => {
      const d = await this.lock(tx, id);
      if (!POSTING.includes(d.type)) throw new BadRequestException(`${d.type} documents are not posted to the ledger`);
      if (d.status !== 'DRAFT') throw new ConflictException(`Cannot post a ${d.status} document`);
      const isSales = d.side === 'SALES';
      const reverse = d.type === 'CREDIT_NOTE' || d.type === 'DEBIT_NOTE'; // notes mirror the invoice
      // credit limit check (sales invoices only)
      if (isSales && d.type === 'INVOICE' && d.party.creditLimit && d.currency === (await this.settings(tx, companyId)).company.baseCurrency) {
        const bal = await partyBalance(tx, d.party.accountId);
        if (bal.add(d.total).gt(d.party.creditLimit)) throw new UnprocessableEntityException(`Credit limit ${fmt(d.party.creditLimit)} exceeded (balance ${fmt(bal)} + ${fmt(d.total)})`);
      }
      const side = (dr: boolean) => (dr !== reverse ? 'debit' : 'credit');
      const lines: any[] = [];
      const vatAccount = await tx.account.findFirstOrThrow({ where: { companyId, type: isSales ? 'VAT_OUTPUT' : 'VAT_INPUT' } });
      // 1. party ledger
      lines.push({ accountId: d.party.accountId, [side(isSales)]: d.total.toString(), description: d.number });
      // 2. revenue / expense / inventory lines, grouped by ledger
      const inv = await this.inventory.postingLines(tx, companyId, userId, d);
      const byAccount = new Map<string, Decimal>();
      for (const l of d.lines) {
        const accountId = inv.overrides.get(l.id) ?? l.accountId ?? (await this.sys.get(tx, companyId, isSales ? 'SALES' : 'PURCHASES').catch(async () => (await tx.account.findFirstOrThrow({ where: { companyId, systemKey: isSales ? 'SALES' : 'PURCHASES' } })).id));
        byAccount.set(accountId, (byAccount.get(accountId) ?? ZERO).add(l.net));
      }
      for (const [accountId, amt] of byAccount) lines.push({ accountId, [side(!isSales)]: amt.toString(), description: d.number });
      // 3. VAT per rate
      const byRate = new Map<string, { net: Decimal; vat: Decimal }>();
      for (const l of d.lines) if (l.taxRateId) { const g = byRate.get(l.taxRateId) ?? { net: ZERO, vat: ZERO }; g.net = g.net.add(l.net); g.vat = g.vat.add(l.vat); byRate.set(l.taxRateId, g); }
      for (const [taxRateId, g] of byRate) lines.push({ accountId: vatAccount.id, ...(g.vat.gt(0) ? { [side(!isSales)]: g.vat.toString() } : {}), taxRateId, taxableAmount: g.net.toString(), description: `VAT ${d.number}` });
      const type = isSales ? (reverse ? 'CREDIT_NOTE' : 'SALES') : reverse ? 'DEBIT_NOTE' : 'PURCHASE';
      const v = await this.vouchers.create(companyId, userId, { type, date: isoDate(d.docDate), reference: d.number, narration: `${d.number} ${d.party.name}`, currency: d.currency, exchangeRate: d.exchangeRate.toString(), lines }, undefined, tx);
      await this.vouchers.post(companyId, userId, v.id, tx);
      await this.inventory.afterPost(tx, companyId, userId, d, v.id);
      await tx.document.update({ where: { id }, data: { status: 'POSTED', voucherId: v.id, postedAt: new Date() } });
      await this.audit.log(tx, { companyId, userId, action: 'document.posted', entityType: 'document', entityId: id, after: { voucher: v.number, total: d.total.toString() } });
      return this.get(companyId, id, tx);
    };
    return txIn ? run(txIn) : this.prisma.tenant(companyId, run);
  }

  async cancel(companyId: string, userId: string, id: string, reason: string) {
    return this.prisma.tenant(companyId, async (tx) => {
      const d = await this.lock(tx, id);
      if (d.status === 'CANCELLED') throw new ConflictException('Already cancelled');
      if (d.status === 'CONVERTED') throw new ConflictException('A converted document cannot be cancelled; cancel the resulting document instead');
      if (d.type === 'GRN' && d.status === 'CONFIRMED') {
        if (await tx.document.count({ where: { sourceDocId: id, status: { not: 'CANCELLED' } } })) throw new ConflictException('This goods receipt has been invoiced; cancel the invoice first');
        await this.inventory.reverse(tx, companyId, userId, d);
      }
      if (d.status === 'POSTED') {
        const used = await tx.settlementAllocation.count({ where: { OR: [{ documentId: id }, { creditDocumentId: id }] } });
        if (used) throw new ConflictException('Document has payments or credit notes applied; cancel those first');
        await this.vouchers.cancel(companyId, userId, d.voucherId!, `${d.number}: ${reason}`, undefined, tx);
        await this.inventory.reverse(tx, companyId, userId, d);
      }
      await tx.document.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
      await this.audit.log(tx, { companyId, userId, action: 'document.cancelled', entityType: 'document', entityId: id, after: { reason } });
      return { status: 'CANCELLED' };
    });
  }

  /** Apply a posted credit/debit note against an open invoice of the same party. */
  async applyNote(companyId: string, userId: string, noteId: string, invoiceId: string, amountStr: string) {
    return this.prisma.tenant(companyId, async (tx) => {
      const note = await this.lock(tx, noteId); const inv = await this.lock(tx, invoiceId);
      if (!['CREDIT_NOTE', 'DEBIT_NOTE'].includes(note.type) || note.status !== 'POSTED') throw new BadRequestException('A posted credit/debit note is required');
      if (inv.type !== 'INVOICE' || inv.status !== 'POSTED' || inv.partyId !== note.partyId || inv.side !== note.side) throw new BadRequestException('Target must be a posted invoice of the same party');
      const amount = D(amountStr);
      const [paid, applied] = await Promise.all([this.allocatedTo(tx, [invoiceId]), this.appliedFrom(tx, [noteId])]);
      if (amount.gt(inv.total.sub(paid.get(invoiceId) ?? ZERO))) throw new UnprocessableEntityException('Amount exceeds the invoice outstanding');
      if (amount.gt(note.total.sub(applied.get(noteId) ?? ZERO))) throw new UnprocessableEntityException('Amount exceeds the unapplied note balance');
      await tx.settlementAllocation.create({ data: { companyId, creditDocumentId: noteId, documentId: invoiceId, amount } });
      await this.audit.log(tx, { companyId, userId, action: 'document.note_applied', entityType: 'document', entityId: noteId, after: { invoiceId, amount: amountStr } });
      return { applied: fmt(amount) };
    });
  }
}
