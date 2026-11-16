import 'dart:async';
import 'package:dio/dio.dart';
import 'config.dart';
import 'token_store.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.status, this.details, this.offline = false});
  final String message;
  final int? status;
  final Object? details;

  /// True when the server could not be reached (use local drafts instead of failing).
  final bool offline;
  bool get isValidation => status == 400 || status == 422 || status == 409;
  @override
  String toString() => message;
}

class ApiResponse {
  ApiResponse(this.data, this.meta);
  final dynamic data;
  final Map<String, dynamic>? meta;
  List<dynamic> get list => data as List<dynamic>;
  Map<String, dynamic> get map => data as Map<String, dynamic>;
}

/// Dio wrapper: bearer auth from secure storage, single-flight token refresh on 401,
/// unified error mapping of the API's { success:false, error:{message} } envelope.
class ApiClient {
  ApiClient({required this.tokens, Dio? dio, String? baseUrl, this.onSessionExpired})
      : _dio = dio ?? Dio(BaseOptions(baseUrl: baseUrl ?? AppConfig.apiUrl, connectTimeout: AppConfig.connectTimeout, receiveTimeout: AppConfig.receiveTimeout, headers: {'Accept': 'application/json'})) {
    _dio.interceptors.add(InterceptorsWrapper(onRequest: _onRequest, onError: _onError));
  }

  final Dio _dio;
  final TokenStore tokens;
  final void Function()? onSessionExpired;
  Completer<bool>? _refreshing;

  Future<void> _onRequest(RequestOptions o, RequestInterceptorHandler h) async {
    if (o.extra['auth'] != false) {
      final t = await tokens.accessToken;
      if (t != null) o.headers['Authorization'] = 'Bearer $t';
    }
    h.next(o);
  }

  Future<void> _onError(DioException e, ErrorInterceptorHandler h) async {
    final req = e.requestOptions;
    if (e.response?.statusCode == 401 && req.extra['auth'] != false && req.extra['retried'] != true) {
      if (await _refresh()) {
        req.extra['retried'] = true;
        req.headers['Authorization'] = 'Bearer ${await tokens.accessToken}';
        try {
          return h.resolve(await _dio.fetch(req));
        } on DioException catch (e2) {
          return h.next(e2);
        }
      }
      onSessionExpired?.call();
    }
    h.next(e);
  }

  Future<bool> _refresh() {
    if (_refreshing != null) return _refreshing!.future;
    final c = _refreshing = Completer<bool>();
    () async {
      try {
        final rt = await tokens.refreshToken;
        if (rt == null) {
          c.complete(false);
          return;
        }
        // separate Dio (no auth interceptor, so a failing refresh cannot recurse) sharing the transport
        final bare = Dio(BaseOptions(baseUrl: _dio.options.baseUrl, connectTimeout: _dio.options.connectTimeout, receiveTimeout: _dio.options.receiveTimeout))..httpClientAdapter = _dio.httpClientAdapter;
        final r = await bare.post('/auth/refresh', data: {'refreshToken': rt});
        final d = r.data['data'];
        await tokens.save(d['accessToken'], d['refreshToken']);
        c.complete(true);
      } catch (_) {
        await tokens.clear();
        c.complete(false);
      } finally {
        _refreshing = null;
      }
    }();
    return c.future;
  }

  ApiException _map(DioException e) {
    if (e.type == DioExceptionType.connectionError || e.type == DioExceptionType.connectionTimeout || e.type == DioExceptionType.receiveTimeout || e.type == DioExceptionType.sendTimeout) {
      return ApiException('You appear to be offline. The server could not be reached.', offline: true);
    }
    final body = e.response?.data;
    final err = body is Map ? body['error'] : null;
    var msg = err is Map ? (err['message'] ?? 'Request failed').toString() : 'Request failed (${e.response?.statusCode ?? '?'})';
    final details = err is Map ? err['details'] : null;
    if (details is List && details.isNotEmpty) msg = details.join('; ');
    return ApiException(msg, status: e.response?.statusCode, details: details);
  }

  Future<ApiResponse> _send(Future<Response<dynamic>> Function() call) async {
    try {
      final r = await call();
      final b = r.data;
      if (b is Map && b['success'] == true) return ApiResponse(b['data'], (b['meta'] as Map?)?.cast<String, dynamic>());
      throw ApiException('Unexpected response from server', status: r.statusCode);
    } on DioException catch (e) {
      throw _map(e);
    }
  }

  Future<ApiResponse> get(String path, {Map<String, dynamic>? query}) => _send(() => _dio.get(path, queryParameters: _clean(query)));
  Future<ApiResponse> post(String path, {Object? body, bool auth = true}) => _send(() => _dio.post(path, data: body ?? {}, options: Options(extra: {'auth': auth})));
  Future<ApiResponse> put(String path, {Object? body}) => _send(() => _dio.put(path, data: body ?? {}));
  Future<ApiResponse> patch(String path, {Object? body}) => _send(() => _dio.patch(path, data: body ?? {}));
  Future<ApiResponse> delete(String path) => _send(() => _dio.delete(path));

  Map<String, dynamic>? _clean(Map<String, dynamic>? q) => q == null ? null : (Map.of(q)..removeWhere((k, v) => v == null || v == ''));
}
