import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../core/money.dart';
import '../providers/providers.dart';
import '../widgets/common.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<DashboardProvider>().load();
      context.read<NotificationProvider>().load();
      context.read<DraftProvider>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<DashboardProvider>();
    final auth = context.watch<AuthProvider>();
    final unread = context.watch<NotificationProvider>().unread;
    final drafts = context.watch<DraftProvider>().drafts.length;
    final d = p.data;
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(auth.session?.company.name ?? 'NEXERP', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)), Text(d != null ? '${d.period['label']} · ${d.period['from']} → ${d.period['to']}' : 'Dashboard', style: const TextStyle(fontSize: 11, color: Colors.blueGrey))]),
        actions: [
          IconButton(onPressed: () => context.push('/notifications'), icon: Badge(isLabelVisible: unread > 0, label: Text('$unread'), child: const Icon(Icons.notifications_outlined)), tooltip: 'Notifications'),
        ],
      ),
      body: p.loading && d == null
          ? const Center(child: CircularProgressIndicator())
          : p.error != null && d == null
              ? ErrorView(p.error!, onRetry: p.load)
              : RefreshIndicator(
                  onRefresh: p.load,
                  child: ListView(padding: const EdgeInsets.fromLTRB(12, 8, 12, 96), children: [
                    if (drafts > 0) Card(color: Colors.amber.shade50, child: ListTile(leading: const Icon(Icons.edit_note), title: Text('$drafts draft(s) saved on this device'), subtitle: const Text('Tap to review and sync'), onTap: () => context.push('/drafts'))),
                    if (d != null) ...[
                      GridView.count(shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), crossAxisCount: 2, mainAxisSpacing: 8, crossAxisSpacing: 8, childAspectRatio: 1.9, children: [
                        StatCard(label: 'Revenue', value: Money.format(d.str('revenue'))),
                        StatCard(label: 'Expenses', value: Money.format(d.str('expenses'))),
                        StatCard(label: 'Net profit', value: Money.format(d.str('netProfit')), negative: d.str('netProfit').startsWith('-')),
                        StatCard(label: 'VAT position', value: Money.format(d.vat['net']), sub: 'Out ${Money.format(d.vat['output'])} · In ${Money.format(d.vat['input'])}'),
                        StatCard(label: 'Cash', value: Money.format(d.str('cashBalance'))),
                        StatCard(label: 'Bank', value: Money.format(d.str('bankBalance'))),
                        StatCard(label: 'Receivables', value: Money.format(d.str('receivables'))),
                        StatCard(label: 'Payables', value: Money.format(d.str('payables'))),
                      ]),
                      const SizedBox(height: 8),
                      StatCard(label: 'Inventory value', value: Money.format(d.str('inventoryValue'))),
                      const SizedBox(height: 12),
                      _Chart(title: 'Sales (net, monthly)', data: d.series('salesPerformance'), color: Theme.of(context).colorScheme.primary),
                      const SizedBox(height: 8),
                      _Chart(title: 'Purchases (net, monthly)', data: d.series('purchasePerformance'), color: Colors.amber.shade700),
                      const SizedBox(height: 12),
                      Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('Needs attention', style: Theme.of(context).textTheme.titleSmall),
                        const SizedBox(height: 6),
                        for (final e in {'Vouchers awaiting approval': 'pendingVoucherApprovals', 'Expenses awaiting approval': 'pendingExpenseApprovals', 'Overdue invoices': 'overdueInvoices', 'Draft documents': 'draftDocuments', 'Low stock items': 'lowStockItems'}.entries)
                          Padding(padding: const EdgeInsets.symmetric(vertical: 3), child: Row(children: [Expanded(child: Text(e.key)), Text('${d.alerts[e.value]}', style: TextStyle(fontWeight: FontWeight.w700, color: (d.alerts[e.value] as num) > 0 ? Colors.amber.shade800 : Colors.blueGrey))])),
                      ]))),
                      if (d.topCustomers.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Top customers', style: Theme.of(context).textTheme.titleSmall), for (final c in d.topCustomers) ListTile(dense: true, contentPadding: EdgeInsets.zero, title: Text(c['name'].toString()), trailing: Amount(c['total'].toString(), bold: true))]))),
                      ],
                    ],
                  ]),
                ),
    );
  }
}

class _Chart extends StatelessWidget {
  const _Chart({required this.title, required this.data, required this.color});
  final String title;
  final List<Map<String, dynamic>> data;
  final Color color;
  @override
  Widget build(BuildContext context) {
    final values = data.map((e) => Money.parse(e['amount'].toString()).abs().toDouble()).toList(); // display only
    final max = values.fold<double>(1, (a, b) => b > a ? b : a);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          if (data.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Center(child: Text('No posted documents in this period', style: TextStyle(color: Colors.blueGrey))))
          else SizedBox(height: 120, child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            for (var i = 0; i < data.length; i++) Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 3), child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
              Text(Money.format(data[i]['amount'], dp: 0), style: const TextStyle(fontSize: 9)),
              const SizedBox(height: 2),
              Container(height: (values[i] / max * 80).clamp(2, 80), decoration: BoxDecoration(color: color, borderRadius: const BorderRadius.vertical(top: Radius.circular(4)))),
              const SizedBox(height: 2),
              Text(data[i]['month'].toString().substring(2), style: const TextStyle(fontSize: 9, color: Colors.blueGrey)),
            ]))),
          ])),
        ]),
      ),
    );
  }
}
