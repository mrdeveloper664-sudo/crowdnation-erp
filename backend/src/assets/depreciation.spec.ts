import { monthlyDepreciation } from './depreciation';

describe('monthlyDepreciation', () => {
  const sl = { cost: '12000', salvage: '0', lifeMonths: 12, method: 'SL' };
  it('straight line = (cost - salvage) / life', () => { expect(monthlyDepreciation(sl, '0').toFixed(2)).toBe('1000.00'); });
  it('uses salvage value', () => { expect(monthlyDepreciation({ ...sl, salvage: '2000', lifeMonths: 10 }, '0').toFixed(2)).toBe('1000.00'); });
  it('never goes below salvage (last month capped)', () => {
    expect(monthlyDepreciation({ cost: '1000', salvage: '100', lifeMonths: 3, method: 'SL' }, '600').toFixed(2)).toBe('300.00');
    expect(monthlyDepreciation({ cost: '1000', salvage: '100', lifeMonths: 3, method: 'SL' }, '900').toFixed(2)).toBe('0.00');
  });
  it('rounds to cents and fully depreciates', () => {
    let acc = '0'; let total = 0;
    for (let i = 0; i < 6; i++) { const m = monthlyDepreciation({ cost: '1000', salvage: '0', lifeMonths: 6, method: 'SL' }, acc); total += m.toNumber(); acc = total.toFixed(2); }
    expect(total).toBeCloseTo(1000, 2);
  });
  it('double declining balance depreciates faster at first and stops at salvage', () => {
    const first = monthlyDepreciation({ cost: '12000', salvage: '1000', lifeMonths: 60, method: 'DB' }, '0');
    expect(first.toFixed(2)).toBe('400.00'); // 12000 * (2/5) / 12
    expect(monthlyDepreciation({ cost: '12000', salvage: '1000', lifeMonths: 60, method: 'DB' }, '10990').toFixed(2)).toBe('10.00');
  });
});
