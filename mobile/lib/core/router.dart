import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../providers/providers.dart';
import '../screens/accounting_screens.dart';
import '../screens/auth_screens.dart';
import '../screens/expense_screens.dart';
import '../screens/home_screen.dart';
import '../screens/misc_screens.dart';
import '../screens/report_screens.dart';
import '../screens/trade_screens.dart';
import '../screens/voucher_screens.dart';

GoRouter buildRouter(AuthProvider auth) {
  final root = GlobalKey<NavigatorState>();
  return GoRouter(
    navigatorKey: root,
    initialLocation: '/',
    refreshListenable: auth,
    redirect: (context, state) {
      final loggedIn = auth.status == AuthStatus.signedIn;
      final onLogin = state.matchedLocation == '/login';
      if (auth.status == AuthStatus.unknown) return null;
      if (!loggedIn && !onLogin) return '/login';
      if (loggedIn && onLogin) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => Scaffold(
          body: shell,
          bottomNavigationBar: NavigationBar(
            selectedIndex: shell.currentIndex,
            onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
            destinations: const [
              NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Home'),
              NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long), label: 'Vouchers'),
              NavigationDestination(icon: Icon(Icons.point_of_sale_outlined), selectedIcon: Icon(Icons.point_of_sale), label: 'Sales'),
              NavigationDestination(icon: Icon(Icons.bar_chart_outlined), selectedIcon: Icon(Icons.bar_chart), label: 'Reports'),
              NavigationDestination(icon: Icon(Icons.menu), label: 'More'),
            ],
          ),
        ),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/', builder: (_, _) => const HomeScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/vouchers', builder: (_, _) => const VouchersScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/sales', builder: (_, _) => const DocumentsScreen(side: 'sales'))]),
          StatefulShellBranch(routes: [GoRoute(path: '/reports', builder: (_, _) => const ReportsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/more', builder: (_, _) => const MoreScreen())]),
        ],
      ),
      // detail / full-screen routes (hide the bottom bar)
      GoRoute(path: '/vouchers/new/:kind', parentNavigatorKey: root, builder: (_, s) => VoucherCreateScreen(kind: s.pathParameters['kind']!)),
      GoRoute(path: '/vouchers/:id', parentNavigatorKey: root, builder: (_, s) => VoucherDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/ledgers', parentNavigatorKey: root, builder: (_, _) => const LedgersScreen()),
      GoRoute(path: '/ledgers/:id', parentNavigatorKey: root, builder: (_, s) => LedgerDetailScreen(id: s.pathParameters['id']!)),
      GoRoute(path: '/sales/new', parentNavigatorKey: root, builder: (_, _) => const DocumentCreateScreen(side: 'sales')),
      GoRoute(path: '/sales/:id', parentNavigatorKey: root, builder: (_, s) => DocumentDetailScreen(side: 'sales', id: s.pathParameters['id']!)),
      GoRoute(path: '/purchases', parentNavigatorKey: root, builder: (_, _) => const DocumentsScreen(side: 'purchases')),
      GoRoute(path: '/purchases/new', parentNavigatorKey: root, builder: (_, _) => const DocumentCreateScreen(side: 'purchases')),
      GoRoute(path: '/purchases/:id', parentNavigatorKey: root, builder: (_, s) => DocumentDetailScreen(side: 'purchases', id: s.pathParameters['id']!)),
      GoRoute(path: '/customers', parentNavigatorKey: root, builder: (_, _) => const PartiesScreen(kind: 'customers')),
      GoRoute(path: '/customers/new', parentNavigatorKey: root, builder: (_, _) => const PartyCreateScreen(kind: 'customers')),
      GoRoute(path: '/customers/:id', parentNavigatorKey: root, builder: (_, s) => PartyDetailScreen(kind: 'customers', id: s.pathParameters['id']!)),
      GoRoute(path: '/suppliers', parentNavigatorKey: root, builder: (_, _) => const PartiesScreen(kind: 'suppliers')),
      GoRoute(path: '/suppliers/new', parentNavigatorKey: root, builder: (_, _) => const PartyCreateScreen(kind: 'suppliers')),
      GoRoute(path: '/suppliers/:id', parentNavigatorKey: root, builder: (_, s) => PartyDetailScreen(kind: 'suppliers', id: s.pathParameters['id']!)),
      GoRoute(path: '/expenses', parentNavigatorKey: root, builder: (_, _) => const ExpensesScreen()),
      GoRoute(path: '/expenses/new', parentNavigatorKey: root, builder: (_, _) => const ExpenseCreateScreen()),
      GoRoute(path: '/reports/:name', parentNavigatorKey: root, builder: (_, s) => ReportViewScreen(name: s.pathParameters['name']!)),
      GoRoute(path: '/approvals', parentNavigatorKey: root, builder: (_, _) => const ApprovalsScreen()),
      GoRoute(path: '/notifications', parentNavigatorKey: root, builder: (_, _) => const NotificationsScreen()),
      GoRoute(path: '/drafts', parentNavigatorKey: root, builder: (_, _) => const DraftsScreen()),
      GoRoute(path: '/profile', parentNavigatorKey: root, builder: (_, _) => const ProfileScreen()),
    ],
  );
}
