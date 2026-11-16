# NEXERP mobile (Flutter)

Provider state management, Dio HTTP client (token refresh interceptor), GoRouter navigation, secure token storage.

Structure: `lib/core` (api client, router, theme, money), `lib/models`, `lib/providers`, `lib/repositories`, `lib/screens`, `lib/widgets`.

```bash
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:4100/api/v1   # Android emulator -> host machine
flutter analyze && flutter test
```

Offline drafts: vouchers and expenses entered without a connection are stored on the device and synced later as **drafts**. Posting is always an explicit online action validated by the backend.
