import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../core/money.dart';
import '../models/models.dart';
import '../providers/providers.dart';
import '../widgets/common.dart';

class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});
  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  static const _groups = {
    'Financial statements': ['trial-balance', 'profit-and-loss', 'balance-sheet', 'cash-flow'],
    'Books': ['day-book', 'cash-book', 'bank-book', 'general-ledger'],
    'Receivables & payables': ['customer-outstanding', 'supplier-outstanding', 'accounts-receivable', 'accounts-payable'],
    'Tax, income & expense': ['vat', 'income-report', 'expense-report'],
    'Inventory': ['stock-summary', 'stock-valuation', 'low-stock'],
  };
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => context.read<ReportProvider>().loadCatalog());
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<ReportProvider>();
    final titles = {for (final r in p.catalog) r['name'].toString(): r['title'].toString()};
    return Scaffold(
      appBar: AppBar(title: const Text('Reports')),
      body: p.loading && p.catalog.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : p.error != null && p.catalog.isEmpty
              ? ErrorView(p.error!, onRetry: p.loadCatalog)
              : ListView(padding: const EdgeInsets.all(12), children: [
                  for (final g in _groups.entries) ...[
                    Padding(padding: const EdgeInsets.fromLTRB(4, 12, 4, 6), child: Text(g.key, style: Theme.of(context).textTheme.titleSmall?.copyWith(color: Colors.blueGrey))),
                    Card(child: Column(children: [for (final n in g.value.where(titles.containsKey)) ListTile(title: Text(titles[n]!), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/reports/$n'))])),
                  ],
                ]),
    );
  }
}

class ReportViewScreen extends StatefulWidget {
  const ReportViewScreen({super.key, required this.name});
  final String name;
  @override
  State<ReportViewScreen> createState() => _ReportViewScreenState();
}

class _ReportViewScreenState extends State<ReportViewScreen> {
  DateTime from = DateTime(DateTime.now().year, 1, 1), to = DateTime.now();
  bool get usesAsOf => ['balance-sheet', 'customer-outstanding', 'supplier-outstanding', 'accounts-receivable', 'accounts-payable', 'stock-summary', 'stock-valuation'].contains(widget.name);
  bool get noDates => widget.name == 'low-stock';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) { context.read<ReportProvider>().clear(); _run(); });
  }

  Future<void> _run() => context.read<ReportProvider>().runReport(widget.name, noDates ? {} : usesAsOf ? {'asOf': DateField.iso(to)} : {'from': DateField.iso(from), 'to': DateField.iso(to), 'pageSize': 200});

  @override
  Widget build(BuildContext context) {
    final p = context.watch<ReportProvider>();
    final r = p.report;
    return Scaffold(
      appBar: AppBar(title: Text(r?.title ?? 'Report')),
      body: Column(children: [
        if (!noDates) Padding(padding: const EdgeInsets.all(12), child: Row(children: [
          if (!usesAsOf) Expanded(child: DateField(label: 'From', value: from, onChanged: (d) { setState(() => from = d); _run(); })),
          if (!usesAsOf) const SizedBox(width: 8),
          Expanded(child: DateField(label: usesAsOf ? 'As of' : 'To', value: to, onChanged: (d) { setState(() => to = d); _run(); })),
        ])),
        Expanded(child: p.loading && r == null ? const Center(child: CircularProgressIndicator()) : p.error != null && r == null ? ErrorView(p.error!, onRetry: _run) : r == null ? const SizedBox() : RefreshIndicator(onRefresh: _run, child: _body(context, r))),
      ]),
    );
  }

  Widget _body(BuildContext context, ReportModel r) {
    return ListView(padding: const EdgeInsets.fromLTRB(12, 0, 12, 40), children: [
      if (r.subtitle != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(r.subtitle!, style: const TextStyle(color: Colors.blueGrey))),
      if (r.summary.isNotEmpty) Wrap(spacing: 8, runSpacing: 8, children: [for (final s in r.summary) Chip(label: Text('${s.key}: ${RegExp(r'^-?\d+\.\d+$').hasMatch(s.value) ? Money.format(s.value) : s.value}'))]),
      const SizedBox(height: 8),
      if (r.isStatement) ...[
        // two-column statements (P&L, balance sheet, cash flow): a clean list, not a table
        Card(child: Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Column(children: [for (final row in r.rows) _statementRow(context, r, row)]))),
      ] else ...[
        // wide reports: one card per record with key/value pairs
        for (final row in r.rows) _recordCard(context, r, row),
      ],
      if (r.rows.isEmpty) const Padding(padding: EdgeInsets.all(40), child: EmptyView('No data for this period')),
    ]);
  }

  Widget _statementRow(BuildContext context, ReportModel r, Map<String, dynamic> row) {
    final kind = row['_kind'];
    final label = (row[r.columns.first.key] ?? '').toString();
    final amt = row[r.columns.last.key];
    final bold = kind != null && kind != 'row';
    final drill = row['_drill'];
    return InkWell(
      onTap: drill is Map && drill['type'] == 'ledger' ? () => context.push('/ledgers/${drill['id']}') : null,
      child: Container(
        color: kind == 'header' ? Colors.blueGrey.shade50 : null,
        padding: EdgeInsets.fromLTRB(label.startsWith('   ') ? 28 : 14, 8, 14, 8),
        child: Row(children: [Expanded(child: Text(label.trim(), style: TextStyle(fontWeight: bold ? FontWeight.w700 : FontWeight.w400))), if (amt != null) Text(Money.format(amt), style: TextStyle(fontWeight: bold ? FontWeight.w700 : FontWeight.w500, fontFeatures: const [FontFeature.tabularFigures()]))]),
      ),
    );
  }

  Widget _recordCard(BuildContext context, ReportModel r, Map<String, dynamic> row) {
    final cols = r.columns;
    final title = cols.firstWhere((c) => ['name', 'particulars', 'account', 'voucher', 'sku'].contains(c.key), orElse: () => cols.first);
    final money = cols.where((c) => c.type == 'money').toList();
    final others = cols.where((c) => c != title && c.type != 'money' && (row[c.key] ?? '').toString().isNotEmpty).toList();
    final drill = row['_drill'];
    final isTotal = row['_kind'] == 'total';
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: isTotal ? Colors.blueGrey.shade50 : null,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: drill is Map ? () { if (drill['type'] == 'ledger') context.push('/ledgers/${drill['id']}'); if (drill['type'] == 'voucher') context.push('/vouchers/${drill['id']}'); } : null,
        child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text((row[title.key] ?? '').toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
          if (others.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(others.map((c) => (row[c.key]).toString()).join(' · '), style: const TextStyle(color: Colors.blueGrey, fontSize: 12))),
          if (money.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Wrap(spacing: 16, runSpacing: 4, children: [for (final c in money) if ((row[c.key] ?? '').toString().isNotEmpty) Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [Text(c.label, style: const TextStyle(fontSize: 10, color: Colors.blueGrey)), Text(Money.format(row[c.key]), style: const TextStyle(fontWeight: FontWeight.w600))])])),
        ])),
      ),
    );
  }
}
