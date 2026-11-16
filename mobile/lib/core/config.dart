/// Build-time configuration. Override with: flutter run --dart-define=API_URL=https://api.example.com/api/v1
/// Defaults: Android emulator reaches the host machine at 10.0.2.2; the iOS simulator at localhost.
class AppConfig {
  static const String apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:4100/api/v1');
  static const Duration connectTimeout = Duration(seconds: 12);
  static const Duration receiveTimeout = Duration(seconds: 30);
}
