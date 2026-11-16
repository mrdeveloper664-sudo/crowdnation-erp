import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, sumMoney, titleCase } from './format.ts';

test('money formats decimal strings', () => {
  assert.equal(money('1234567.5'), '1,234,567.50');
  assert.equal(money('-1000'), '-1,000.00');
  assert.equal(money('0.1', 4), '0.1000');
  assert.equal(money(''), '');
});
test('sumMoney has no floating point drift', () => {
  assert.equal(sumMoney(['0.10', '0.20']), '0.30');
  assert.equal(sumMoney(['100.10', undefined, '-0.05']), '100.05');
});
test('titleCase', () => assert.equal(titleCase('CREDIT_NOTE'), 'Credit Note'));
