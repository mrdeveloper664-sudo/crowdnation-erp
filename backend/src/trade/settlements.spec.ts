import { D } from '../common/money';
import { carryingBase } from './settlements.service';

const txWith = (prior: Array<{ amount: string; baseAmount: string | null }>) => ({
  settlementAllocation: { findMany: async () => prior.map((p) => ({ amount: D(p.amount), baseAmount: p.baseAmount === null ? null : D(p.baseAmount) })) },
}) as any;
const doc = { id: 'd', total: D('100.00'), exchangeRate: D('3.6725') }; // 367.25 in base

describe('carryingBase', () => {
  it('a partial settlement clears amount x invoice rate', async () => {
    expect((await carryingBase(txWith([]), doc, D('33.33'), 2)).toFixed(2)).toBe('122.40');
  });
  it('the settlement that exhausts the invoice clears the exact base remainder (no rounding residue)', async () => {
    const prior = [{ amount: '33.33', baseAmount: '122.40' }, { amount: '33.33', baseAmount: '122.40' }];
    expect((await carryingBase(txWith(prior), doc, D('33.34'), 2)).toFixed(2)).toBe('122.45'); // 367.25 - 244.80, not 33.34 x 3.6725 = 122.44
  });
  it('legacy base-currency allocations (null base amount) count as their own amount', async () => {
    const base = { id: 'b', total: D('500.00'), exchangeRate: D(1) };
    expect((await carryingBase(txWith([{ amount: '200.00', baseAmount: null }]), base, D('300.00'), 2)).toFixed(2)).toBe('300.00');
  });
});
