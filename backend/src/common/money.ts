import { Prisma } from '@prisma/client';

// Banker-neutral, commercial rounding for money. NEVER use JS numbers for amounts.
Prisma.Decimal.set({ rounding: Prisma.Decimal.ROUND_HALF_UP, precision: 40 });

export type Decimal = Prisma.Decimal;
export const Decimal = Prisma.Decimal;
export type DecimalInput = string | number | Prisma.Decimal;

export const ZERO = new Prisma.Decimal(0);

export function D(v: DecimalInput | null | undefined): Prisma.Decimal {
  if (v === null || v === undefined || v === '') return new Prisma.Decimal(0);
  return new Prisma.Decimal(v);
}

export function round(v: DecimalInput, dp = 2): Prisma.Decimal {
  return D(v).toDecimalPlaces(dp, Prisma.Decimal.ROUND_HALF_UP);
}

export function decimalPlaces(v: DecimalInput): number {
  return D(v).decimalPlaces();
}

/** Serialize a Decimal as a fixed-point string (what the API returns). */
export function fmt(v: DecimalInput | null | undefined, dp = 2): string {
  return D(v).toFixed(dp);
}
