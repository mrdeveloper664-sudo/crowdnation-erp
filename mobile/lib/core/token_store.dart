import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract class TokenStore {
  Future<String?> get accessToken;
  Future<String?> get refreshToken;
  Future<void> save(String access, String refresh);
  Future<void> clear();
}

/// Tokens live in the platform keychain / keystore, never in plain preferences.
class SecureTokenStore implements TokenStore {
  SecureTokenStore([FlutterSecureStorage? storage]) : _s = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _s;
  @override
  Future<String?> get accessToken => _s.read(key: 'access');
  @override
  Future<String?> get refreshToken => _s.read(key: 'refresh');
  @override
  Future<void> save(String access, String refresh) async {
    await _s.write(key: 'access', value: access);
    await _s.write(key: 'refresh', value: refresh);
  }

  @override
  Future<void> clear() async {
    await _s.delete(key: 'access');
    await _s.delete(key: 'refresh');
  }
}

class MemoryTokenStore implements TokenStore {
  String? _a, _r;
  @override
  Future<String?> get accessToken async => _a;
  @override
  Future<String?> get refreshToken async => _r;
  @override
  Future<void> save(String access, String refresh) async {
    _a = access;
    _r = refresh;
  }

  @override
  Future<void> clear() async {
    _a = null;
    _r = null;
  }
}
