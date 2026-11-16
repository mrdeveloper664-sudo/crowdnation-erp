import '../core/api_client.dart';
import '../core/token_store.dart';
import '../models/models.dart';

class AuthRepository {
  AuthRepository(this.api, this.tokens);
  final ApiClient api;
  final TokenStore tokens;

  Future<void> login(String companyCode, String email, String password) async {
    final r = await api.post('/auth/login', body: {'companyCode': companyCode.trim().toUpperCase(), 'email': email.trim(), 'password': password}, auth: false);
    await tokens.save(r.map['accessToken'], r.map['refreshToken']);
  }

  Future<UserSession> me() async => UserSession.fromJson((await api.get('/auth/me')).map);

  Future<void> logout() async {
    final rt = await tokens.refreshToken;
    try {
      if (rt != null) await api.post('/auth/logout', body: {'refreshToken': rt}, auth: false);
    } catch (_) {}
    await tokens.clear();
  }

  Future<bool> hasSession() async => (await tokens.accessToken) != null || (await tokens.refreshToken) != null;
  Future<void> changePassword(String current, String next) => api.post('/auth/change-password', body: {'currentPassword': current, 'newPassword': next});
  Future<void> forgotPassword(String code, String email) => api.post('/auth/forgot-password', body: {'companyCode': code.trim().toUpperCase(), 'email': email.trim()}, auth: false);
}

class DashboardRepository {
  DashboardRepository(this.api);
  final ApiClient api;
  Future<DashboardData> load({String? financialYearId}) async => DashboardData((await api.get('/dashboard', query: {'financialYearId': financialYearId})).map);
}

class AccountingRepository {
  AccountingRepository(this.api);
  final ApiClient api;

  Future<List<LedgerSummary>> ledgers({String? type, String? search}) async => (await api.get('/ledgers', query: {'type': type, 'search': search})).list.map((e) => LedgerSummary.fromJson((e as Map).cast())).toList();

  Future<LedgerSummary> ledger(String id) async => LedgerSummary.fromJson((await api.get('/ledgers/$id')).map);

  Future<({List<StatementLine> lines, Map<String, dynamic> meta})> statement(String id, {int page = 1, String? from, String? to}) async {
    final r = await api.get('/ledgers/$id/statement', query: {'page': page, 'pageSize': 30, 'from': from, 'to': to});
    return (lines: r.list.map((e) => StatementLine.fromJson((e as Map).cast())).toList(), meta: r.meta ?? {});
  }

  /// Ledger lookups for pickers. [types] filters by account type (e.g. CASH,BANK).
  Future<List<Map<String, dynamic>>> accounts({String? search, String? type}) async =>
      (await api.get('/chart-of-accounts/accounts', query: {'search': search, 'type': type, 'active': 'true'})).list.map((e) => (e as Map).cast<String, dynamic>()).toList();

  Future<({List<VoucherModel> items, Map<String, dynamic> meta})> vouchers({String? type, String? status, String? search, int page = 1}) async {
    final r = await api.get('/vouchers', query: {'type': type, 'status': status, 'search': search, 'page': page, 'pageSize': 25});
    return (items: r.list.map((e) => VoucherModel.fromJson((e as Map).cast())).toList(), meta: r.meta ?? {});
  }

  Future<VoucherModel> voucher(String id) async => VoucherModel.fromJson((await api.get('/vouchers/$id')).map);
  Future<VoucherModel> createVoucher(Map<String, dynamic> body) async => VoucherModel.fromJson((await api.post('/vouchers', body: body)).map);
  Future<void> voucherAction(String id, String action, {String? reason}) => api.post('/vouchers/$id/$action', body: reason == null ? {} : {'reason': reason});
}

class TradeRepository {
  TradeRepository(this.api);
  final ApiClient api;

  Future<({List<DocumentModel> items, Map<String, dynamic> meta})> documents(String side, {String type = 'INVOICE', String? status, String? search, int page = 1}) async {
    final r = await api.get('/$side/documents', query: {'type': type, 'status': status, 'search': search, 'page': page, 'pageSize': 20});
    return (items: r.list.map((e) => DocumentModel.fromJson((e as Map).cast())).toList(), meta: r.meta ?? {});
  }

  Future<DocumentModel> document(String side, String id) async => DocumentModel.fromJson((await api.get('/$side/documents/$id')).map);
  Future<DocumentModel> createDocument(String side, Map<String, dynamic> body) async => DocumentModel.fromJson((await api.post('/$side/documents', body: body)).map);
  Future<void> documentAction(String side, String id, String action, {String? reason}) => api.post('/$side/documents/$id/$action', body: reason == null ? {} : {'reason': reason});

  Future<List<PartyModel>> parties(String kind, {String? search}) async => (await api.get('/$kind', query: {'search': search, 'pageSize': 100})).list.map((e) => PartyModel.fromJson((e as Map).cast())).toList();
  Future<PartyModel> party(String kind, String id) async => PartyModel.fromJson((await api.get('/$kind/$id')).map);
  Future<PartyModel> createParty(String kind, Map<String, dynamic> body) async => PartyModel.fromJson((await api.post('/$kind', body: body)).map);
  Future<List<Map<String, dynamic>>> taxRates() async => (await api.get('/vat/rates')).list.map((e) => (e as Map).cast<String, dynamic>()).toList();
}

class ExpenseRepository {
  ExpenseRepository(this.api);
  final ApiClient api;
  Future<List<ExpenseModel>> list({String? status}) async => (await api.get('/expenses', query: {'status': status, 'pageSize': 50})).list.map((e) => ExpenseModel.fromJson((e as Map).cast())).toList();
  Future<List<Map<String, dynamic>>> categories() async => (await api.get('/expenses/categories')).list.map((e) => (e as Map).cast<String, dynamic>()).toList();
  Future<ExpenseModel> create(Map<String, dynamic> body) async => ExpenseModel.fromJson((await api.post('/expenses', body: body)).map);
  Future<void> action(String id, String action, {String? reason}) => api.post('/expenses/$id/$action', body: reason == null ? {} : {'reason': reason});
}

class ReportRepository {
  ReportRepository(this.api);
  final ApiClient api;
  Future<List<Map<String, dynamic>>> catalog() async => (await api.get('/reports/catalog')).list.map((e) => (e as Map).cast<String, dynamic>()).toList();
  Future<ReportModel> run(String name, Map<String, dynamic> params) async => ReportModel.fromJson((await api.get('/reports/run/$name', query: params)).map);
}

class NotificationRepository {
  NotificationRepository(this.api);
  final ApiClient api;
  Future<({List<NotificationModel> items, int unread})> list() async {
    final r = await api.get('/notifications');
    return (items: r.list.map((e) => NotificationModel.fromJson((e as Map).cast())).toList(), unread: (r.meta?['unread'] ?? 0) as int);
  }

  Future<void> markRead(String id) => api.post('/notifications/$id/read');
  Future<void> markAllRead() => api.post('/notifications/read-all');
}
