import { calculateVat } from './vat.engine';

describe('calculateVat', () => {
  it('exclusive: 5% on 100.00', () => {
    const r = calculateVat('100.00', '5', false);
    expect([r.net.toFixed(2), r.vat.toFixed(2), r.gross.toFixed(2)]).toEqual(['100.00', '5.00', '105.00']);
  });
  it('inclusive: 105.00 -> 100.00 + 5.00', () => {
    const r = calculateVat('105.00', '5', true);
    expect([r.net.toFixed(2), r.vat.toFixed(2)]).toEqual(['100.00', '5.00']);
  });
  it('inclusive rounding keeps net + vat = gross', () => {
    for (const g of ['0.01', '9.99', '33.33', '1234.57', '99999.99']) {
      const r = calculateVat(g, '5', true);
      expect(r.net.add(r.vat).toFixed(2)).toBe(g);
    }
  });
  it('rounds half up and supports other rates', () => {
    expect(calculateVat('0.10', '5', false).vat.toFixed(2)).toBe('0.01'); // 0.005 -> 0.01
    expect(calculateVat('200', '7.5', false).vat.toFixed(2)).toBe('15.00');
    expect(calculateVat('50', '0', false).vat.toFixed(2)).toBe('0.00');
  });
});
