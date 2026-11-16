import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'core/api_client.dart';
import 'core/router.dart';
import 'core/theme.dart';
import 'core/token_store.dart';
import 'providers/providers.dart';
import 'repositories/draft_store.dart';
import 'repositories/repositories.dart';
import 'screens/trade_screens.dart';

/// Composition root. Everything is injected, so tests can pass a fake [ApiClient] / [TokenStore].
class NexerpApp extends StatefulWidget {
  const NexerpApp({super.key, this.tokens, this.api, this.draftStore});
  final TokenStore? tokens;
  final ApiClient? api;
  final DraftStore? draftStore;
  @override
  State<NexerpApp> createState() => _NexerpAppState();
}

class _NexerpAppState extends State<NexerpApp> {
  late final TokenStore tokens = widget.tokens ?? SecureTokenStore();
  late final AuthProvider auth;
  late final ApiClient api;
  late final GoRouter router;
  late final AuthRepository authRepo;
  late final AccountingRepository accounting;
  late final TradeRepository trade;
  late final ExpenseRepository expenseRepo;

  @override
  void initState() {
    super.initState();
    api = widget.api ?? ApiClient(tokens: tokens, onSessionExpired: () => auth.sessionExpired());
    authRepo = AuthRepository(api, tokens);
    accounting = AccountingRepository(api);
    trade = TradeRepository(api);
    expenseRepo = ExpenseRepository(api);
    auth = AuthProvider(authRepo)..init();
    router = buildRouter(auth);
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: auth),
        Provider.value(value: authRepo),
        Provider.value(value: accounting),
        Provider.value(value: trade),
        Provider.value(value: expenseRepo),
        ChangeNotifierProvider(create: (_) => DashboardProvider(DashboardRepository(api))),
        ChangeNotifierProvider(create: (_) => LedgerProvider(accounting)),
        ChangeNotifierProvider(create: (_) => VoucherProvider(accounting)),
        ChangeNotifierProvider(create: (_) => DocumentProvider(trade, 'sales')),
        ChangeNotifierProvider(create: (_) => PurchaseDocumentProvider(trade)),
        ChangeNotifierProvider(create: (_) => CustomerProvider(trade)),
        ChangeNotifierProvider(create: (_) => SupplierProvider(trade)),
        ChangeNotifierProvider(create: (_) => ExpenseProvider(expenseRepo)),
        ChangeNotifierProvider(create: (_) => ReportProvider(ReportRepository(api))),
        ChangeNotifierProvider(create: (_) => NotificationProvider(NotificationRepository(api))),
        ChangeNotifierProvider(create: (_) => DraftProvider(widget.draftStore ?? DraftStore(), accounting, expenseRepo)),
      ],
      child: Consumer<AuthProvider>(
        builder: (context, a, _) => a.status == AuthStatus.unknown
            ? MaterialApp(theme: AppTheme.light(), home: const Scaffold(body: Center(child: CircularProgressIndicator())))
            : MaterialApp.router(title: 'NEXERP', theme: AppTheme.light(), routerConfig: router, debugShowCheckedModeBanner: false),
      ),
    );
  }
}
