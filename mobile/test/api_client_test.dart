import 'package:flutter_test/flutter_test.dart';
import 'package:nexerp_mobile/core/api_client.dart';
import 'package:nexerp_mobile/core/token_store.dart';
import 'test_helpers.dart';

void main() {
  test('unwraps the success envelope and sends the bearer token', () async {
    final tokens = MemoryTokenStore()..save('AT', 'RT');
    final a = FakeAdapter({'GET /ledgers': (o) => (status: 200, body: ok([{'id': 1}], meta: {'page': 1}))});
    final r = await makeClient(a, tokens: tokens).get('/ledgers');
    expect(r.list.length, 1);
    expect(r.meta?['page'], 1);
    expect(a.calls.single.headers['Authorization'], 'Bearer AT');
  });

  test('maps API errors, including validation details', () async {
    final a = FakeAdapter({
      'POST /vouchers': (o) => (status: 422, body: failure('Entry is not balanced: debit 10.00 <> credit 9.99')),
      'POST /x': (o) => (status: 400, body: {'success': false, 'error': {'message': 'Validation failed', 'details': ['amount must be a decimal string', 'date is required']}}),
    });
    final c = makeClient(a);
    await expectLater(c.post('/vouchers'), throwsA(isA<ApiException>().having((e) => e.message, 'message', contains('not balanced')).having((e) => e.isValidation, 'isValidation', true)));
    await expectLater(c.post('/x'), throwsA(isA<ApiException>().having((e) => e.message, 'message', 'amount must be a decimal string; date is required')));
  });

  test('connection failures are reported as offline', () async {
    final c = makeClient(FakeAdapter({}));
    await expectLater(c.get('/anything'), throwsA(isA<ApiException>().having((e) => e.offline, 'offline', true)));
  });

  test('refreshes the token once on 401 and retries the request', () async {
    final tokens = MemoryTokenStore()..save('OLD', 'RT');
    var attempts = 0;
    final a = FakeAdapter({
      'GET /dashboard': (o) {
        attempts++;
        return o.headers['Authorization'] == 'Bearer NEW' ? (status: 200, body: ok({'revenue': '1.00'})) : (status: 401, body: failure('expired'));
      },
      'POST /auth/refresh': (o) => (status: 200, body: ok({'accessToken': 'NEW', 'refreshToken': 'RT2'})),
    });
    final dio = makeDio(a);
    final client = ApiClient(tokens: tokens, dio: dio);
    final r = await client.get('/dashboard');
    expect(r.map['revenue'], '1.00');
    expect(attempts, 2);
    expect(await tokens.accessToken, 'NEW');
    expect(await tokens.refreshToken, 'RT2');
  });

  test('expired refresh token ends the session', () async {
    final tokens = MemoryTokenStore()..save('OLD', 'BAD');
    var expired = false;
    final a = FakeAdapter({'GET /me': (o) => (status: 401, body: failure('expired')), 'POST /auth/refresh': (o) => (status: 401, body: failure('Invalid refresh token'))});
    final client = ApiClient(tokens: tokens, dio: makeDio(a), onSessionExpired: () => expired = true);
    await expectLater(client.get('/me'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)));
    expect(expired, isTrue);
    expect(await tokens.accessToken, isNull);
  });
}
