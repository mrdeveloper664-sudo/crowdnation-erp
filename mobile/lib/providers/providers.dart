import 'package:flutter/foundation.dart';
import '../core/api_client.dart';
import '../models/models.dart';
import '../repositories/draft_store.dart';
import '../repositories/repositories.dart';

/// Base: runs a loader, tracks loading/error, notifies listeners.
mixin Loadable on ChangeNotifier {
  bool loading = false;
  String? error;
  Future<void> run(Future<void> Function() job) async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      await job();
    } on ApiException catch (e) {
      error = e.message;
    } catch (e) {
      error = e.toString();
    } finally {
      loading = false;
      notifyListeners();
    }
  }
}

enum AuthStatus { unknown, signedOut, signedIn }

class AuthProvider extends ChangeNotifier {
  AuthProvider(this.repo);
  final AuthRepository repo;
  AuthStatus status = AuthStatus.unknown;
  UserSession? session;
  String? error;
  bool busy = false;

  bool can(String resource, [String action = 'view']) => session?.can(resource, action) ?? false;

  Future<void> init() async {
    if (!await repo.hasSession()) {
      status = AuthStatus.signedOut;
      notifyListeners();
      return;
    }
    try {
      session = await repo.me();
      status = AuthStatus.signedIn;
    } on ApiException catch (e) {
      status = e.offline ? AuthStatus.signedIn : AuthStatus.signedOut; // keep the session when merely offline
    }
    notifyListeners();
  }

  Future<bool> login(String code, String email, String password) async {
    busy = true;
    error = null;
    notifyListeners();
    try {
      await repo.login(code, email, password);
      session = await repo.me();
      status = AuthStatus.signedIn;
      return true;
    } on ApiException catch (e) {
      error = e.message;
      return false;
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    await repo.logout();
    session = null;
    status = AuthStatus.signedOut;
    notifyListeners();
  }

  void sessionExpired() {
    session = null;
    status = AuthStatus.signedOut;
    notifyListeners();
  }
}

class DashboardProvider extends ChangeNotifier with Loadable {
  DashboardProvider(this.repo);
  final DashboardRepository repo;
  DashboardData? data;
  Future<void> load() => run(() async => data = await repo.load());
}

class LedgerProvider extends ChangeNotifier with Loadable {
  LedgerProvider(this.repo);
  final AccountingRepository repo;
  List<LedgerSummary> items = [];
  String? type, search;
  Future<void> load({String? type, String? search}) {
    this.type = type;
    this.search = search;
    return run(() async => items = await repo.ledgers(type: type, search: search));
  }
}

class VoucherProvider extends ChangeNotifier with Loadable {
  VoucherProvider(this.repo);
  final AccountingRepository repo;
  List<VoucherModel> items = [];
  int page = 1, totalPages = 1;
  String? type, status, search;

  Future<void> load({String? type, String? status, String? search}) {
    this.type = type;
    this.status = status;
    this.search = search;
    page = 1;
    return run(() async {
      final r = await repo.vouchers(type: type, status: status, search: search);
      items = r.items;
      totalPages = (r.meta['totalPages'] ?? 1) as int;
    });
  }

  Future<void> more() async {
    if (loading || page >= totalPages) return;
    page++;
    await run(() async {
      final r = await repo.vouchers(type: type, status: status, search: search, page: page);
      items = [...items, ...r.items];
    });
  }
}

class DocumentProvider extends ChangeNotifier with Loadable {
  DocumentProvider(this.repo, this.side);
  final TradeRepository repo;
  final String side; // sales | purchases
  List<DocumentModel> items = [];
  int page = 1, totalPages = 1;
  String type = 'INVOICE';
  String? search;

  Future<void> load({String? type, String? search}) {
    if (type != null) this.type = type;
    this.search = search;
    page = 1;
    return run(() async {
      final r = await repo.documents(side, type: this.type, search: search);
      items = r.items;
      totalPages = (r.meta['totalPages'] ?? 1) as int;
    });
  }

  Future<void> more() async {
    if (loading || page >= totalPages) return;
    page++;
    await run(() async => items = [...items, ...(await repo.documents(side, type: type, search: search, page: page)).items]);
  }
}

class PartyProvider extends ChangeNotifier with Loadable {
  PartyProvider(this.repo, this.kind);
  final TradeRepository repo;
  final String kind; // customers | suppliers
  List<PartyModel> items = [];
  Future<void> load({String? search}) => run(() async => items = await repo.parties(kind, search: search));
}

class ExpenseProvider extends ChangeNotifier with Loadable {
  ExpenseProvider(this.repo);
  final ExpenseRepository repo;
  List<ExpenseModel> items = [];
  String? status;
  Future<void> load({String? status}) {
    this.status = status;
    return run(() async => items = await repo.list(status: status));
  }
}

class NotificationProvider extends ChangeNotifier with Loadable {
  NotificationProvider(this.repo);
  final NotificationRepository repo;
  List<NotificationModel> items = [];
  int unread = 0;
  Future<void> load() => run(() async {
        final r = await repo.list();
        items = r.items;
        unread = r.unread;
      });
  Future<void> markAll() async {
    await repo.markAllRead();
    await load();
  }

  Future<void> markRead(String id) async {
    await repo.markRead(id);
    await load();
  }
}

class ReportProvider extends ChangeNotifier with Loadable {
  ReportProvider(this.repo);
  final ReportRepository repo;
  List<Map<String, dynamic>> catalog = [];
  ReportModel? report;
  Future<void> loadCatalog() => run(() async => catalog = await repo.catalog());
  Future<void> runReport(String name, Map<String, dynamic> params) => run(() async => report = await repo.run(name, params));
  void clear() {
    report = null;
    notifyListeners();
  }
}

/// Local drafts + synchronisation. Sync creates server-side DRAFTS only; the backend validates them.
class DraftProvider extends ChangeNotifier {
  DraftProvider(this.store, this.accounting, this.expenses);
  final DraftStore store;
  final AccountingRepository accounting;
  final ExpenseRepository expenses;
  List<LocalDraft> drafts = [];
  bool syncing = false;
  String? lastMessage;

  Future<void> load() async {
    drafts = await store.all();
    notifyListeners();
  }

  Future<void> add(LocalDraft d) async {
    await store.add(d);
    await load();
  }

  Future<void> discard(String id) async {
    await store.remove(id);
    await load();
  }

  Future<void> sync() async {
    if (syncing) return;
    syncing = true;
    lastMessage = null;
    notifyListeners();
    var ok = 0, failed = 0;
    for (final d in await store.all()) {
      try {
        if (d.kind == 'voucher') {
          await accounting.createVoucher(d.payload);
        } else {
          await expenses.create(d.payload);
        }
        await store.remove(d.id);
        ok++;
      } on ApiException catch (e) {
        if (e.offline) {
          lastMessage = 'Still offline - $ok synced, remaining drafts kept.';
          break;
        }
        await store.update(d.withError(e.message)); // server rejected it: keep, show why
        failed++;
      }
    }
    lastMessage ??= '$ok synced as drafts on the server${failed > 0 ? ', $failed need attention' : ''}. Post them online after review.';
    syncing = false;
    await load();
  }
}
