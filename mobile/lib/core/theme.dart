import 'package:flutter/material.dart';

class AppTheme {
  static const brand = Color(0xFF2F61E0);
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(seedColor: brand, brightness: Brightness.light);
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: const Color(0xFFF6F8FB),
      appBarTheme: const AppBarTheme(centerTitle: false, backgroundColor: Colors.white, foregroundColor: Color(0xFF0F172A), elevation: 0, scrolledUnderElevation: 1),
      cardTheme: CardThemeData(color: Colors.white, elevation: 0, margin: EdgeInsets.zero, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Color(0xFFE2E8F0)))),
      inputDecorationTheme: InputDecorationTheme(border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)), isDense: true, filled: true, fillColor: Colors.white),
      filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)))),
      navigationBarTheme: const NavigationBarThemeData(backgroundColor: Colors.white, height: 64),
    );
  }

  static Color statusColor(String s) {
    switch (s) {
      case 'POSTED':
      case 'APPROVED':
      case 'PAID':
      case 'REIMBURSED':
        return const Color(0xFF059669);
      case 'PENDING_APPROVAL':
      case 'SUBMITTED':
        return const Color(0xFFD97706);
      case 'CANCELLED':
      case 'REJECTED':
        return const Color(0xFFDC2626);
      case 'CONFIRMED':
      case 'CONVERTED':
        return const Color(0xFF2563EB);
      default:
        return const Color(0xFF64748B);
    }
  }
}
