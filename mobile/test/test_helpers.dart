import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:nexerp_mobile/core/api_client.dart';
import 'package:nexerp_mobile/core/token_store.dart';

typedef Handler = ({int status, Object? body}) Function(RequestOptions o);

/// In-memory HTTP adapter: route -> handler. Records every request.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.routes);
  final Map<String, Handler> routes; // key: "METHOD /path"
  final List<RequestOptions> calls = [];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    calls.add(options);
    final h = routes['${options.method} ${options.path}'];
    if (h == null) throw DioException(requestOptions: options, type: DioExceptionType.connectionError, error: 'no route');
    final r = h(options);
    return ResponseBody.fromString(jsonEncode(r.body), r.status, headers: {Headers.contentTypeHeader: ['application/json']});
  }

  @override
  void close({bool force = false}) {}
}

Map<String, Object?> ok(Object? data, {Map<String, Object?>? meta}) => {'success': true, 'data': data, 'meta': ?meta};
Map<String, Object?> failure(String message, {String code = 'ERR'}) => {'success': false, 'error': {'code': code, 'message': message}};

ApiClient makeClient(FakeAdapter adapter, {TokenStore? tokens, void Function()? onExpired}) {
  final dio = Dio(BaseOptions(baseUrl: 'http://test/api/v1'))..httpClientAdapter = adapter;
  return ApiClient(tokens: tokens ?? MemoryTokenStore(), dio: dio, onSessionExpired: onExpired);
}

Map<String, Object?> meJson({List<String> perms = const ['voucher:view', 'voucher:create', 'voucher:post', 'voucher:approve', 'ledger:view', 'sales:view', 'sales:create', 'sales:post', 'report:view']}) => {
      'id': 'u1', 'name': 'Demo Admin', 'email': 'admin@demo.test', 'roles': [{'id': 'r1', 'name': 'Company Administrator'}], 'permissions': perms,
      'company': {'id': 'c1', 'code': 'DEMO', 'name': 'Demo Trading LLC', 'baseCurrency': 'AED', 'trn': '100000000000003'},
    };

Dio makeDio(FakeAdapter adapter) => Dio(BaseOptions(baseUrl: 'http://test/api/v1'))..httpClientAdapter = adapter;
