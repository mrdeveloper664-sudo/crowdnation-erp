import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TaxDirection, TaxTreatment } from '@prisma/client';
import { D, ZERO, fmt } from '../common/money';
import { Tx } from '../common/prisma.service';
import { calculateVat } from './vat.engine';

export const DEFAULT_TAX_RATES = [
  { code: 'STD', name: 'Standard rated 5%', treatment: 'STANDARD' as TaxTreatment, rate: '5' },
  { code: 'ZERO', name: 'Zero rated', treatment: 'ZERO' as TaxTreatment, rate: '0' },
  { code: 'EXEMPT', name: 'Exempt', treatment: 'EXEMPT' as TaxTreatment, rate: '0' },
  { code: 'OOS', name: 'Out of scope', treatment: 'OUT_OF_SCOPE' as TaxTreatment, rate: '0' },
];
const DAY0 = new Date('2018-01-01T00:00:00Z'); // UAE VAT introduction

@Injectable()
export class VatService {
  async ensureDefaults(tx: Tx, companyId: string) {
    if (await tx.taxRate.count({ where: { companyId } })) return;
    await tx.taxRate.createMany({ data: DEFAULT_TAX_RATES.map((r) => ({ ...r, companyId, effectiveFrom: DAY0 })) });
  }

  /** Rate version in force on `date` for a rate code. */
  async resolve(tx: Tx, companyId: string, code: string, date: Date) {
    await this.ensureDefaults(tx, companyId);
    const r = await tx.taxRate.findFirst({
      where: { companyId, code, isActive: true, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!r) throw new BadRequestException(`Tax code ${code} has no rate effective on ${date.toISOString().slice(0, 10)}`);
    return r;
  }

  async calculate(tx: Tx, companyId: string, p: { code: string; date: Date; amount: string; inclusive: boolean }) {
    const rate = await this.resolve(tx, companyId, p.code, p.date);
    const settings = await tx.companySetting.findUniqueOrThrow({ where: { companyId } });
    const c = calculateVat(p.amount, rate.rate, p.inclusive, settings.amountDecimals);
    return { taxRateId: rate.id, code: rate.code, treatment: rate.treatment, rate: rate.rate.toString(), net: fmt(c.net), vat: fmt(c.vat), gross: fmt(c.gross) };
  }

  async record(tx: Tx, p: {
    companyId: string; journalEntryId?: string; sourceType: string; sourceId?: string; taxRateId: string; direction: TaxDirection;
    txnDate: Date; taxable: ReturnType<typeof D>; tax: ReturnType<typeof D>; isAdjustment?: boolean;
  }) {
    const rate = await tx.taxRate.findFirst({ where: { id: p.taxRateId, companyId: p.companyId } });
    if (!rate) throw new NotFoundException('Tax rate not found');
    const s = await tx.companySetting.findUniqueOrThrow({ where: { companyId: p.companyId } });
    return tx.taxTransaction.create({
      data: {
        companyId: p.companyId, journalEntryId: p.journalEntryId, sourceType: p.sourceType, sourceId: p.sourceId, taxRateId: rate.id,
        direction: p.direction, treatment: rate.treatment, emirate: s.emirate, txnDate: p.txnDate, taxableAmount: p.taxable, taxAmount: p.tax, isAdjustment: !!p.isAdjustment,
      },
    });
  }

  /** Mirror all tax rows of a source with negated amounts (used when a posted document is cancelled). */
  async reverseSource(tx: Tx, companyId: string, sourceType: string, sourceId: string, reversalEntryId: string, date: Date) {
    const rows = await tx.taxTransaction.findMany({ where: { companyId, sourceType, sourceId, isReversal: false } });
    for (const r of rows) {
      await tx.taxTransaction.create({
        data: {
          companyId, journalEntryId: reversalEntryId, sourceType, sourceId, taxRateId: r.taxRateId, direction: r.direction, treatment: r.treatment, emirate: r.emirate,
          txnDate: date, taxableAmount: r.taxableAmount.neg(), taxAmount: r.taxAmount.neg(), isAdjustment: r.isAdjustment, isReversal: true,
        },
      });
    }
  }

  /** VAT 201 style return built from tax_transactions. */
  async vatReturn(tx: Tx, companyId: string, from: Date, to: Date) {
    const rows = await tx.taxTransaction.findMany({ where: { companyId, txnDate: { gte: from, lte: to } } });
    const sum = (f: (r: (typeof rows)[number]) => boolean, k: 'taxableAmount' | 'taxAmount') => rows.filter(f).reduce((s, r) => s.add(r[k]), ZERO);
    const EMIRATES: Record<string, string> = { ABU_DHABI: '1a', DUBAI: '1b', SHARJAH: '1c', AJMAN: '1d', UMM_AL_QUWAIN: '1e', RAS_AL_KHAIMAH: '1f', FUJAIRAH: '1g' };
    const out = (r: any) => r.direction === 'OUTPUT';
    const inn = (r: any) => r.direction === 'INPUT';
    const box1 = Object.entries(EMIRATES).map(([emirate, box]) => {
      const f = (r: any) => out(r) && r.treatment === 'STANDARD' && r.emirate === emirate;
      return { box, label: `Standard rated supplies - ${emirate.replace(/_/g, ' ')}`, amount: fmt(sum(f, 'taxableAmount')), vat: fmt(sum(f, 'taxAmount')), adjustment: fmt(sum((r) => f(r) && r.isAdjustment, 'taxAmount')) };
    });
    const zero = sum((r) => out(r) && r.treatment === 'ZERO', 'taxableAmount');
    const exempt = sum((r) => out(r) && r.treatment === 'EXEMPT', 'taxableAmount');
    const supplyVat = box1.reduce((s, b) => s.add(D(b.vat)), ZERO);
    const supplyAmt = box1.reduce((s, b) => s.add(D(b.amount)), ZERO);
    const expAmt = sum((r) => inn(r) && r.treatment === 'STANDARD', 'taxableAmount');
    const expVat = sum((r) => inn(r) && r.treatment === 'STANDARD', 'taxAmount');
    const net = supplyVat.sub(expVat);
    return {
      from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
      outputs: [
        ...box1,
        { box: '4', label: 'Zero rated supplies', amount: fmt(zero), vat: fmt(0) },
        { box: '5', label: 'Exempt supplies', amount: fmt(exempt), vat: fmt(0) },
        { box: '8', label: 'Total supplies', amount: fmt(supplyAmt.add(zero).add(exempt)), vat: fmt(supplyVat) },
      ],
      inputs: [
        { box: '9', label: 'Standard rated expenses', amount: fmt(expAmt), vat: fmt(expVat) },
        { box: '11', label: 'Total expenses', amount: fmt(expAmt), vat: fmt(expVat) },
      ],
      outOfScope: { outputs: fmt(sum((r) => out(r) && r.treatment === 'OUT_OF_SCOPE', 'taxableAmount')), inputs: fmt(sum((r) => inn(r) && r.treatment === 'OUT_OF_SCOPE', 'taxableAmount')) },
      summary: { totalVatDue: fmt(supplyVat), recoverableVat: fmt(expVat), netVatDue: fmt(net), position: net.gte(0) ? 'PAYABLE' : 'REFUNDABLE' },
      transactionCount: rows.length,
    };
  }
}
