import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nexerp_mobile/app.dart';
import 'package:nexerp_mobile/core/token_store.dart';
import 'package:nexerp_mobile/providers/providers.dart';
import 'package:nexerp_mobile/repositories/draft_store.dart';
import 'package:nexerp_mobile/repositories/repositories.dart';
import 'package:nexerp_mobile/screens/voucher_screens.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'test_helpers.dart';

Map<String, Handler> baseRoutes({List<Map<String, Object?>>? posted}) => {
      'POST /auth/login': (o) => o.data['password'] == 'Demo@12345678' ? (status: 200, body: ok({'accessToken': 'A', 'refreshToken': 'R'})) : (status: 401, body: failure('Invalid company code, email or password')),
      'GET /auth/me': (o) => (status: 200, body: ok(meJson())),
      'GET /dashboard': (o) => (status: 200, body: ok({
            'period': {'label': 'FY2026', 'from': '2026-01-01', 'to': '2026-11-16'}, 'revenue': '5000.00', 'expenses': '4500.00', 'netProfit': '500.00', 'cashBalance': '2000.00', 'bankBalance': '43500.00',
            'receivables': '0.00', 'payables': '0.00', 'inventoryValue': '0.00', 'vat': {'output': '0.00', 'input': '0.00', 'net': '0.00'}, 'salesPerformance': [], 'purchasePerformance': [], 'topCustomers': [],
            'alerts': {'pendingVoucherApprovals': 2, 'draftDocuments': 0, 'overdueInvoices': 0, 'pendingExpenseApprovals': 0, 'pendingLeaveRequests': 0, 'lowStockItems': 0},
          })),
      'GET /notifications': (o) => (status: 200, body: ok([], meta: {'unread': 0})),
      'GET /chart-of-accounts/accounts': (o) => (status: 200, body: ok([
            {'id': 'acc-bank', 'code': '1112', 'name': 'Bank Account', 'type': 'BANK'}, {'id': 'acc-rent', 'code': '5202', 'name': 'Rent', 'type': 'EXPENSE'},
          ])),
      'POST /vouchers': (o) { posted?.add((o.data as Map).cast()); return (status: 201, body: ok({'id': 'v1', 'number': 'PV-2026-00001', 'type': 'PAYMENT', 'status': 'DRAFT', 'voucherDate': '2026-11-16', 'totalAmount': '125.50', 'currency': 'AED'})); },
      'GET /vouchers': (o) => (status: 200, body: ok([], meta: {'totalPages': 1})),
      'GET /vouchers/v1': (o) => (status: 200, body: ok({'id': 'v1', 'number': 'PV-2026-00001', 'type': 'PAYMENT', 'status': 'DRAFT', 'voucherDate': '2026-11-16', 'totalAmount': '125.50', 'currency': 'AED', 'lines': []})),
    };

Future<void> pumpScreen(WidgetTester t, Widget screen, FakeAdapter adapter) async {
  SharedPreferences.setMockInitialValues({});
  final tokens = MemoryTokenStore()..save('A', 'R');
  final api = makeClient(adapter, tokens: tokens);
  final accounting = AccountingRepository(api);
  final expenses = ExpenseRepository(api);
  final auth = AuthProvider(AuthRepository(api, tokens));
  await t.runAsync(() => auth.init()); // real async (Dio timers) must not run inside the fake clock
  t.view.physicalSize = const Size(800, 2600); // tall enough that lazily-built lists render every field
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  final router = GoRouter(routes: [
    GoRoute(path: '/', builder: (_, _) => const Scaffold(body: Text('home'))),
    GoRoute(path: '/create', builder: (_, _) => screen),
    GoRoute(path: '/vouchers/:id', builder: (_, s) => Scaffold(body: Text('detail ${s.pathParameters['id']}'))),
  ]);
  await t.pumpWidget(MultiProvider(
    providers: [
      ChangeNotifierProvider.value(value: auth),
      Provider.value(value: accounting),
      ChangeNotifierProvider(create: (_) => VoucherProvider(accounting)),
      ChangeNotifierProvider(create: (_) => DraftProvider(DraftStore(), accounting, expenses)),
    ],
    child: MaterialApp.router(routerConfig: router),
  ));
  await t.pumpAndSettle();
  router.push('/create');
  await t.pumpAndSettle();
}

void main() {
  testWidgets('login form validates input before calling the API', (t) async {
    SharedPreferences.setMockInitialValues({});
    final adapter = FakeAdapter(baseRoutes());
    await t.pumpWidget(NexerpApp(tokens: MemoryTokenStore(), api: makeClient(adapter), draftStore: DraftStore()));
    await t.pumpAndSettle();
    expect(find.text('Sign in to your company'), findsOneWidget);
    await t.tap(find.byKey(const Key('loginButton')));
    await t.pump();
    expect(find.text('Enter your company code'), findsOneWidget);
    expect(find.text('Enter a valid email'), findsOneWidget);
    expect(find.text('Enter your password'), findsOneWidget);
    expect(adapter.calls.where((c) => c.path == '/auth/login'), isEmpty);
  });

  testWidgets('wrong password shows the server error; correct login opens the dashboard', (t) async {
    SharedPreferences.setMockInitialValues({});
    final adapter = FakeAdapter(baseRoutes());
    final tokens = MemoryTokenStore();
    await t.pumpWidget(NexerpApp(tokens: tokens, api: makeClient(adapter, tokens: tokens), draftStore: DraftStore()));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('companyCode')), 'demo');
    await t.enterText(find.byKey(const Key('email')), 'admin@demo.test');
    await t.enterText(find.byKey(const Key('password')), 'wrong');
    await t.tap(find.byKey(const Key('loginButton')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('loginError')), findsOneWidget);
    expect(find.textContaining('Invalid company code'), findsOneWidget);

    await t.enterText(find.byKey(const Key('password')), 'Demo@12345678');
    await t.tap(find.byKey(const Key('loginButton')));
    await t.pumpAndSettle();
    expect(find.text('Demo Trading LLC'), findsOneWidget);
    expect(find.text('5,000.00'), findsOneWidget); // revenue card from /dashboard
    expect(find.text('Vouchers'), findsWidgets); // bottom navigation
    expect(await tokens.accessToken, 'A');
  });

  testWidgets('journal voucher: requires two lines and a balanced total', (t) async {
    await pumpScreen(t, const VoucherCreateScreen(kind: 'journal'), FakeAdapter(baseRoutes()));
    await t.ensureVisible(find.byKey(const Key('saveDraft')));
    await t.tap(find.byKey(const Key('saveDraft')));
    await t.pumpAndSettle();
    expect(find.text('A journal needs at least two lines'), findsOneWidget);
  });

  testWidgets('payment voucher builds Dr payee / Cr bank and creates a draft', (t) async {
    final posted = <Map<String, Object?>>[];
    await pumpScreen(t, const VoucherCreateScreen(kind: 'payment'), FakeAdapter(baseRoutes(posted: posted)));
    // missing ledgers -> validation message, nothing sent
    await t.ensureVisible(find.byKey(const Key('saveDraft')));
    await t.tap(find.byKey(const Key('saveDraft')));
    await t.pumpAndSettle();
    expect(find.textContaining('Select the cash/bank ledger'), findsOneWidget);
    expect(posted, isEmpty);

    await t.tap(find.text('Pay from (cash / bank)'));
    await t.pumpAndSettle();
    await t.tap(find.text('1112  Bank Account'));
    await t.pumpAndSettle();
    await t.tap(find.text('Paid to (payee / expense ledger)'));
    await t.pumpAndSettle();
    await t.tap(find.text('5202  Rent'));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('amount')), '12.3456789'); // too many decimals
    await t.ensureVisible(find.byKey(const Key('saveDraft')));
    await t.tap(find.byKey(const Key('saveDraft')));
    await t.pumpAndSettle();
    expect(find.textContaining('valid amount'), findsOneWidget);

    await t.enterText(find.byKey(const Key('amount')), '125.50');
    await t.ensureVisible(find.byKey(const Key('saveDraft')));
    await t.tap(find.byKey(const Key('saveDraft')));
    await t.pumpAndSettle();
    expect(posted.length, 1);
    final body = posted.single;
    expect(body['type'], 'PAYMENT');
    final lines = (body['lines'] as List).cast<Map>();
    expect(lines[0], {'accountId': 'acc-rent', 'debit': '125.50'});
    expect(lines[1], {'accountId': 'acc-bank', 'credit': '125.50'});
    expect(find.text('detail v1'), findsOneWidget); // navigated to the created voucher
  });

  testWidgets('offline: the voucher is stored as a local draft instead of being lost', (t) async {
    final routes = baseRoutes();
    routes.remove('POST /vouchers'); // -> connection error = offline
    await pumpScreen(t, const VoucherCreateScreen(kind: 'receipt'), FakeAdapter(routes));
    await t.tap(find.text('Deposit to (cash / bank)'));
    await t.pumpAndSettle();
    await t.tap(find.text('1112  Bank Account'));
    await t.pumpAndSettle();
    await t.tap(find.text('Received from (customer / income ledger)'));
    await t.pumpAndSettle();
    await t.tap(find.text('5202  Rent'));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('amount')), '40.00');
    await t.ensureVisible(find.byKey(const Key('saveDraft')));
    await t.tap(find.byKey(const Key('saveDraft')));
    await t.pumpAndSettle();
    final stored = await t.runAsync(() => DraftStore().all()) ?? [];
    expect(stored.length, 1);
    expect(stored.single.kind, 'voucher');
    expect(stored.single.payload['type'], 'RECEIPT');
  });
}
