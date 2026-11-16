import 'package:flutter_test/flutter_test.dart';
import 'package:nexerp_mobile/core/token_store.dart';
import 'package:nexerp_mobile/models/models.dart';
import 'package:nexerp_mobile/providers/providers.dart';
import 'package:nexerp_mobile/repositories/draft_store.dart';
import 'package:nexerp_mobile/repositories/repositories.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'test_helpers.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('AuthProvider', () {
    test('successful login stores tokens and loads the session with permissions', () async {
      final tokens = MemoryTokenStore();
      final a = FakeAdapter({'POST /auth/login': (o) {
        expect(o.data['companyCode'], 'DEMO'); // upper-cased
        return (status: 200, body: ok({'accessToken': 'A', 'refreshToken': 'R'}));
      }, 'GET /auth/me': (o) => (status: 200, body: ok(meJson()))});
      final auth = AuthProvider(AuthRepository(makeClient(a, tokens: tokens), tokens));
      expect(await auth.login('demo', 'admin@demo.test', 'Demo@12345678'), isTrue);
      expect(auth.status, AuthStatus.signedIn);
      expect(auth.can('voucher', 'post'), isTrue);
      expect(auth.can('user', 'delete'), isFalse);
      expect(await tokens.accessToken, 'A');
    });

    test('failed login exposes the server message and stays signed out', () async {
      final tokens = MemoryTokenStore();
      final a = FakeAdapter({'POST /auth/login': (o) => (status: 401, body: failure('Invalid company code, email or password'))});
      final auth = AuthProvider(AuthRepository(makeClient(a, tokens: tokens), tokens));
      expect(await auth.login('DEMO', 'x@y.zz', 'bad'), isFalse);
      expect(auth.error, contains('Invalid'));
      expect(auth.status, isNot(AuthStatus.signedIn));
      expect(await tokens.accessToken, isNull);
    });

    test('init without tokens is signed out; offline with tokens keeps the session', () async {
      final empty = MemoryTokenStore();
      final auth1 = AuthProvider(AuthRepository(makeClient(FakeAdapter({}), tokens: empty), empty));
      await auth1.init();
      expect(auth1.status, AuthStatus.signedOut);
      final t = MemoryTokenStore()..save('A', 'R');
      final auth2 = AuthProvider(AuthRepository(makeClient(FakeAdapter({}), tokens: t), t)); // no routes => connection error
      await auth2.init();
      expect(auth2.status, AuthStatus.signedIn);
    });

    test('logout clears tokens', () async {
      final tokens = MemoryTokenStore()..save('A', 'R');
      final a = FakeAdapter({'POST /auth/logout': (o) => (status: 200, body: ok({'loggedOut': true})), 'GET /auth/me': (o) => (status: 200, body: ok(meJson()))});
      final auth = AuthProvider(AuthRepository(makeClient(a, tokens: tokens), tokens));
      await auth.init();
      await auth.logout();
      expect(auth.status, AuthStatus.signedOut);
      expect(await tokens.refreshToken, isNull);
    });
  });

  group('List providers', () {
    test('VoucherProvider loads and paginates', () async {
      Map<String, Object?> v(String n) => {'id': n, 'number': n, 'type': 'JOURNAL', 'status': 'POSTED', 'voucherDate': '2026-01-01', 'totalAmount': '10.00', 'currency': 'AED'};
      final a = FakeAdapter({'GET /vouchers': (o) => o.queryParameters['page'] == 2
          ? (status: 200, body: ok([v('JV-3')], meta: {'totalPages': 2}))
          : (status: 200, body: ok([v('JV-1'), v('JV-2')], meta: {'totalPages': 2}))});
      final p = VoucherProvider(AccountingRepository(makeClient(a)));
      await p.load();
      expect(p.items.map((e) => e.number), ['JV-1', 'JV-2']);
      await p.more();
      expect(p.items.length, 3);
      await p.more(); // no more pages: no extra request
      expect(a.calls.length, 2);
    });

    test('providers surface load errors', () async {
      final a = FakeAdapter({'GET /ledgers': (o) => (status: 500, body: failure('Internal server error'))});
      final p = LedgerProvider(AccountingRepository(makeClient(a)));
      await p.load();
      expect(p.error, 'Internal server error');
      expect(p.items, isEmpty);
    });
  });

  group('Offline drafts', () {
    LocalDraft draft(String id) => LocalDraft(id: id, kind: 'voucher', title: 'PAYMENT', payload: {'type': 'PAYMENT', 'date': '2026-01-01', 'lines': []}, createdAt: DateTime(2026, 1, 1));

    test('store round-trips drafts', () async {
      final s = DraftStore();
      await s.add(draft('1'));
      await s.add(draft('2'));
      expect((await s.all()).map((d) => d.id), ['1', '2']);
      await s.update(draft('1').withError('bad'));
      expect((await s.all()).first.error, 'bad');
      await s.remove('1');
      expect((await s.all()).single.id, '2');
    });

    test('sync creates drafts on the server and removes them; sync never posts', () async {
      final a = FakeAdapter({'POST /vouchers': (o) => (status: 201, body: ok({'id': 'v1', 'number': 'PV-1', 'type': 'PAYMENT', 'status': 'DRAFT', 'voucherDate': '2026-01-01', 'totalAmount': '5.00', 'currency': 'AED'}))});
      final c = makeClient(a);
      final p = DraftProvider(DraftStore(), AccountingRepository(c), ExpenseRepository(c));
      await p.add(draft('1'));
      await p.sync();
      expect(p.drafts, isEmpty);
      expect(a.calls.map((c) => c.path), ['/vouchers']); // only create - no /post call
      expect(p.lastMessage, contains('synced'));
    });

    test('server-rejected drafts are kept with the reason; offline keeps everything', () async {
      var offline = false;
      final a = FakeAdapter({'POST /vouchers': (o) => (status: 422, body: failure('Account 5202 is inactive'))});
      final c = makeClient(a);
      final p = DraftProvider(DraftStore(), AccountingRepository(c), ExpenseRepository(c));
      await p.add(draft('1'));
      await p.sync();
      expect(p.drafts.single.error, contains('inactive'));
      offline = true;
      final c2 = makeClient(FakeAdapter({})); // every call -> offline
      final p2 = DraftProvider(DraftStore(), AccountingRepository(c2), ExpenseRepository(c2));
      await p2.load();
      await p2.sync();
      expect(p2.drafts.length, 1);
      expect(p2.lastMessage, contains('offline'));
      expect(offline, isTrue);
    });
  });

  group('Models', () {
    test('ReportModel detects statements and formats money columns', () {
      final r = ReportModel.fromJson({'title': 'P&L', 'columns': [{'key': 'particulars', 'label': 'Particulars'}, {'key': 'amount', 'label': 'Amount', 'type': 'money', 'align': 'right'}], 'rows': [{'particulars': 'Sales', 'amount': '1234.5'}], 'summary': [{'label': 'Net profit', 'value': '10.00'}]});
      expect(r.isStatement, isTrue);
      expect(r.format(r.columns.last, r.rows.first['amount']), '1,234.50');
      expect(r.summary.single.key, 'Net profit');
    });
    test('UserSession permission checks', () {
      final s = UserSession.fromJson(meJson());
      expect(s.can('voucher', 'approve'), isTrue);
      expect(s.can('report'), isTrue);
      expect(s.can('user', 'view'), isFalse);
      expect(s.company.baseCurrency, 'AED');
    });
  });
}
