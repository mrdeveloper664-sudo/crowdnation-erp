import 'package:decimal/decimal.dart';
import 'package:intl/intl.dart';

/// All amounts are exact decimals (never double). The API sends/accepts decimal strings.
class Money {
  static final RegExp _valid = RegExp(r'^\d{1,15}(\.\d{1,4})?$');

  /// Parses a decimal string; returns zero for null/empty/invalid.
  static Decimal parse(String? s) => (s == null || s.trim().isEmpty) ? Decimal.zero : (Decimal.tryParse(s.trim()) ?? Decimal.zero);

  static bool isValidAmount(String? s) => s != null && _valid.hasMatch(s.trim());

  static Decimal sum(Iterable<String?> values) => values.fold(Decimal.zero, (a, b) => a + parse(b));

  /// 1234567.5 -> "1,234,567.50"
  static String format(Object? v, {int dp = 2}) {
    if (v == null || (v is String && v.isEmpty)) return '';
    final d = v is Decimal ? v : Decimal.tryParse(v.toString());
    if (d == null) return v.toString();
    final fixed = d.toStringAsFixed(dp);
    final neg = fixed.startsWith('-');
    final parts = fixed.replaceFirst('-', '').split('.');
    final intPart = NumberFormat('#,##0').format(BigInt.parse(parts[0]).toInt());
    return '${neg ? '-' : ''}$intPart${dp > 0 ? '.${parts[1]}' : ''}';
  }

  /// Wire format with exactly [dp] decimals.
  static String wire(Decimal d, {int dp = 2}) => d.toStringAsFixed(dp);
}
