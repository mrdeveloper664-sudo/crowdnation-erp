import { D, Decimal, DecimalInput, ZERO, round } from '../common/money';

/** Depreciation for ONE month. Never depreciates below salvage value. */
export function monthlyDepreciation(a: { cost: DecimalInput; salvage: DecimalInput; lifeMonths: number; method: string }, accumulated: DecimalInput): Decimal {
  const cost = D(a.cost), salvage = D(a.salvage), acc = D(accumulated);
  const remaining = cost.sub(salvage).sub(acc);
  if (remaining.lte(0)) return ZERO;
  let m: Decimal;
  if (a.method === 'DB') m = round(cost.sub(acc).mul(D(2).div(D(a.lifeMonths).div(12))).div(12), 2); // double declining balance
  else m = round(cost.sub(salvage).div(a.lifeMonths), 2); // straight line
  return m.gt(remaining) ? remaining : m;
}
