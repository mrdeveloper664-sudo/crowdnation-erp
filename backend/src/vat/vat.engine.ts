import { D, Decimal, DecimalInput, round } from '../common/money';

export interface VatCalc { net: Decimal; vat: Decimal; gross: Decimal }

/**
 * Pure VAT arithmetic. No rates are hard-coded: callers pass the effective rate (percent)
 * from the tax_rates table. Rounds half-up to `dp` places.
 */
export function calculateVat(amount: DecimalInput, ratePercent: DecimalInput, inclusive: boolean, dp = 2): VatCalc {
  const rate = D(ratePercent);
  const a = D(amount);
  if (inclusive) {
    const net = round(a.mul(100).div(rate.add(100)), dp);
    return { net, vat: a.sub(net), gross: a };
  }
  const vat = round(a.mul(rate).div(100), dp);
  return { net: a, vat, gross: a.add(vat) };
}
