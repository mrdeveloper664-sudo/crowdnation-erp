import 'package:decimal/decimal.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexerp_mobile/core/money.dart';

void main() {
  group('Money', () {
    test('uses exact decimal arithmetic (no floating point drift)', () {
      expect(Money.sum(['0.10', '0.20']), Decimal.parse('0.30'));
      expect((Money.parse('0.1') + Money.parse('0.2')).toString(), '0.3');
      expect(Money.sum(['100.10', null, '', '-0.05']), Decimal.parse('100.05'));
    });
    test('formats with thousands separators', () {
      expect(Money.format('1234567.5'), '1,234,567.50');
      expect(Money.format('-1000'), '-1,000.00');
      expect(Money.format('0.1', dp: 4), '0.1000');
      expect(Money.format(''), '');
      expect(Money.format(null), '');
    });
    test('validates API amount strings', () {
      expect(Money.isValidAmount('125.50'), isTrue);
      expect(Money.isValidAmount('0.1234'), isTrue);
      expect(Money.isValidAmount('1.23456'), isFalse);
      expect(Money.isValidAmount('-5'), isFalse);
      expect(Money.isValidAmount('abc'), isFalse);
      expect(Money.isValidAmount(''), isFalse);
      expect(Money.isValidAmount(null), isFalse);
    });
    test('parse is forgiving, zero for invalid', () {
      expect(Money.parse('x'), Decimal.zero);
      expect(Money.parse(null), Decimal.zero);
    });
  });
}
