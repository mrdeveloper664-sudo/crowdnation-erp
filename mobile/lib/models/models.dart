import '../core/money.dart';

T? _s<T>(dynamic v) => v is T ? v : null;

class Company {
  Company({required this.id, required this.code, required this.name, required this.baseCurrency, this.trn});
  final String id, code, name, baseCurrency;
  final String? trn;
  factory Company.fromJson(Map<String, dynamic> j) => Company(id: j['id'], code: j['code'], name: j['name'], baseCurrency: j['baseCurrency'] ?? 'AED', trn: _s<String>(j['trn']));
}

class UserSession {
  UserSession({required this.id, required this.name, required this.email, required this.roles, required this.permissions, required this.company});
  final String id, name, email;
  final List<String> roles;
  final Set<String> permissions;
  final Company company;
  bool can(String resource, [String action = 'view']) => permissions.contains('$resource:$action');
  factory UserSession.fromJson(Map<String, dynamic> j) => UserSession(
        id: j['id'], name: j['name'], email: j['email'],
        roles: (j['roles'] as List).map((r) => r['name'].toString()).toList(),
        permissions: (j['permissions'] as List).map((p) => p.toString()).toSet(),
        company: Company.fromJson(j['company']),
      );
}

class DashboardData {
  DashboardData(this.json);
  final Map<String, dynamic> json;
  String str(String k) => (json[k] ?? '0.00').toString();
  Map<String, dynamic> get vat => (json['vat'] as Map).cast();
  Map<String, dynamic> get alerts => (json['alerts'] as Map).cast();
  Map<String, dynamic> get period => (json['period'] as Map).cast();
  List<Map<String, dynamic>> series(String k) => ((json[k] as List?) ?? []).map((e) => (e as Map).cast<String, dynamic>()).toList();
  List<Map<String, dynamic>> get topCustomers => series('topCustomers');
}

class LedgerSummary {
  LedgerSummary({required this.id, required this.code, required this.name, required this.type, required this.groupName, required this.debit, required this.credit, required this.balance, this.side});
  final String id, code, name, type, groupName, debit, credit, balance;
  final String? side;
  factory LedgerSummary.fromJson(Map<String, dynamic> j) => LedgerSummary(id: j['id'], code: j['code'], name: j['name'], type: j['type'], groupName: (j['groupName'] ?? j['group']?['name'] ?? '').toString(), debit: j['debit'].toString(), credit: j['credit'].toString(), balance: j['balance'].toString(), side: _s<String>(j['balanceSide']));
}

class StatementLine {
  StatementLine({required this.entryId, required this.entryNumber, required this.date, required this.narration, required this.debit, required this.credit, required this.running, required this.side});
  final String entryId, entryNumber, date, narration, debit, credit, running;
  final String? side;
  factory StatementLine.fromJson(Map<String, dynamic> j) => StatementLine(entryId: j['entryId'], entryNumber: j['entryNumber'], date: j['date'], narration: (j['narration'] ?? '').toString(), debit: j['debit'], credit: j['credit'], running: j['running']['amount'], side: _s<String>(j['running']['side']));
}

class VoucherLineModel {
  VoucherLineModel({required this.accountId, this.accountName = '', this.debit = '0.00', this.credit = '0.00', this.description = ''});
  final String accountId, accountName, debit, credit, description;
  factory VoucherLineModel.fromJson(Map<String, dynamic> j) => VoucherLineModel(accountId: j['accountId'], accountName: j['account'] == null ? '' : '${j['account']['code']} ${j['account']['name']}', debit: j['debit'].toString(), credit: j['credit'].toString(), description: (j['description'] ?? '').toString());
}

class VoucherModel {
  VoucherModel({required this.id, required this.number, required this.type, required this.status, required this.date, required this.total, required this.currency, this.reference, this.narration, this.lines = const [], this.rejectedReason});
  final String id, number, type, status, date, total, currency;
  final String? reference, narration, rejectedReason;
  final List<VoucherLineModel> lines;
  factory VoucherModel.fromJson(Map<String, dynamic> j) => VoucherModel(
        id: j['id'], number: j['number'], type: j['type'], status: j['status'], date: j['voucherDate'], total: j['totalAmount'].toString(), currency: j['currency'] ?? 'AED',
        reference: _s<String>(j['reference']), narration: _s<String>(j['narration']), rejectedReason: _s<String>(j['rejectedReason']),
        lines: ((j['lines'] as List?) ?? []).map((l) => VoucherLineModel.fromJson((l as Map).cast())).toList(),
      );
}

class DocumentModel {
  DocumentModel({required this.id, required this.number, required this.type, required this.status, required this.date, required this.partyName, required this.total, required this.net, required this.vat, required this.currency, this.outstanding, this.lines = const [], this.partyId = ''});
  final String id, number, type, status, date, partyName, total, net, vat, currency, partyId;
  final String? outstanding;
  final List<Map<String, dynamic>> lines;
  factory DocumentModel.fromJson(Map<String, dynamic> j) => DocumentModel(
        id: j['id'], number: j['number'], type: j['type'], status: j['status'], date: j['docDate'], partyName: (j['party']?['name'] ?? '').toString(), partyId: (j['partyId'] ?? '').toString(),
        total: j['total'].toString(), net: j['net'].toString(), vat: j['vat'].toString(), currency: j['currency'] ?? 'AED', outstanding: _s<String>(j['outstanding']),
        lines: ((j['lines'] as List?) ?? []).map((l) => (l as Map).cast<String, dynamic>()).toList(),
      );
}

class PartyModel {
  PartyModel({required this.id, required this.code, required this.name, this.email, this.phone, this.trn, this.balance = '0.00', this.side, this.accountId = ''});
  final String id, code, name, balance, accountId;
  final String? email, phone, trn, side;
  factory PartyModel.fromJson(Map<String, dynamic> j) => PartyModel(id: j['id'], code: j['code'], name: j['name'], email: _s<String>(j['email']), phone: _s<String>(j['phone']), trn: _s<String>(j['trn']), balance: (j['balance'] ?? '0.00').toString(), side: _s<String>(j['balanceSide']), accountId: (j['accountId'] ?? '').toString());
}

class ExpenseModel {
  ExpenseModel({required this.id, required this.number, required this.status, required this.kind, required this.date, required this.description, required this.total, required this.vat});
  final String id, number, status, kind, date, description, total, vat;
  factory ExpenseModel.fromJson(Map<String, dynamic> j) => ExpenseModel(id: j['id'], number: j['number'], status: j['status'], kind: j['kind'], date: j['expenseDate'], description: j['description'], total: j['total'].toString(), vat: j['vat'].toString());
}

class NotificationModel {
  NotificationModel({required this.id, required this.title, this.body, required this.read, required this.createdAt});
  final String id, title;
  final String? body;
  final bool read;
  final DateTime createdAt;
  factory NotificationModel.fromJson(Map<String, dynamic> j) => NotificationModel(id: j['id'], title: j['title'], body: _s<String>(j['body']), read: j['readAt'] != null, createdAt: DateTime.tryParse(j['createdAt'] ?? '') ?? DateTime.now());
}

class ReportColumn {
  ReportColumn({required this.key, required this.label, this.align, this.type});
  final String key, label;
  final String? align, type;
  factory ReportColumn.fromJson(Map<String, dynamic> j) => ReportColumn(key: j['key'], label: j['label'], align: _s<String>(j['align']), type: _s<String>(j['type']));
}

class ReportModel {
  ReportModel({required this.title, this.subtitle, required this.columns, required this.rows, required this.summary});
  final String title;
  final String? subtitle;
  final List<ReportColumn> columns;
  final List<Map<String, dynamic>> rows;
  final List<MapEntry<String, String>> summary;
  factory ReportModel.fromJson(Map<String, dynamic> j) => ReportModel(
        title: j['title'], subtitle: _s<String>(j['subtitle']),
        columns: (j['columns'] as List).map((c) => ReportColumn.fromJson((c as Map).cast())).toList(),
        rows: (j['rows'] as List).map((r) => (r as Map).cast<String, dynamic>()).toList(),
        summary: ((j['summary'] as List?) ?? []).map((s) => MapEntry(s['label'].toString(), s['value'].toString())).toList(),
      );
  bool get isStatement => columns.length == 2 && columns.last.type == 'money';
  String format(ReportColumn c, dynamic v) => c.type == 'money' && v != null ? Money.format(v) : (v ?? '').toString();
}
