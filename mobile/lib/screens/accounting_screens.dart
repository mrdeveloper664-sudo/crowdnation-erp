import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../core/money.dart';
import '../models/models.dart';
import '../providers/providers.dart';
import '../repositories/repositories.dart';
import '../widgets/common.dart';

const _ledgerTypes = ['CASH', 'BANK', 'CUSTOMER', 'SUPPLIER', 'INCOME', 'EXPENSE', 'VAT_INPUT', 'VAT_OUTPUT', 'FIXED_ASSET', 'INVENTORY', 'CAPITAL'];

class LedgersScreen extends StatefulWidget {
  const LedgersScreen({super.key});
  @override
  State<LedgersScreen> createState() => _LedgersScreenState();
}

class _LedgersScreenState extends State<LedgersScreen> {
  final _search = TextEditingController();
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => context.read<LedgerProvider>().load());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<LedgerProvider>();
    return Scaffold(
      appBar: AppBar(title: const Text('Ledgers')),
      body: Column(children: [
        Padding(padding: const EdgeInsets.fromLTRB(12, 8, 12, 0), child: TextField(controller: _search, decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search ledgers'), onSubmitted: (v) => p.load(type: p.type, search: v))),
        SizedBox(height: 48, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 8), children: [
          Padding(padding: const EdgeInsets.all(4), child: ChoiceChip(label: const Text('All'), selected: p.type == null, onSelected: (_) => p.load(search: _search.text))),
          for (final t in _ledgerTypes) Padding(padding: const EdgeInsets.all(4), child: ChoiceChip(label: Text(t.replaceAll('_', ' ')), selected: p.type == t, onSelected: (_) => p.load(type: t, search: _search.text))),
        ])),
        Expanded(
          child: AsyncList(
            loading: p.loading, error: p.error, isEmpty: p.items.isEmpty, itemCount: p.items.length, emptyText: 'No ledgers match', onRefresh: () => p.load(type: p.type, search: _search.text),
            itemBuilder: (_, i) {
              final l = p.items[i];
              return Card(child: ListTile(onTap: () => context.push('/ledgers/${l.id}'), title: Text(l.name, maxLines: 1, overflow: TextOverflow.ellipsis), subtitle: Text('${l.code} · ${l.groupName}'), trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [Amount(l.balance, side: l.side, bold: true), Text(l.type.replaceAll('_', ' '), style: const TextStyle(fontSize: 10, color: Colors.blueGrey))])));
            },
          ),
        ),
      ]),
    );
  }
}

class LedgerDetailScreen extends StatefulWidget {
  const LedgerDetailScreen({super.key, required this.id});
  final String id;
  @override
  State<LedgerDetailScreen> createState() => _LedgerDetailScreenState();
}

class _LedgerDetailScreenState extends State<LedgerDetailScreen> {
  LedgerSummary? ledger;
  final List<StatementLine> lines = [];
  Map<String, dynamic> meta = {};
  int page = 1;
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    _load(reset: true);
  }

  Future<void> _load({bool reset = false}) async {
    final repo = context.read<AccountingRepository>();
    if (reset) {
      page = 1;
      lines.clear();
    }
    setState(() { loading = true; error = null; });
    try {
      ledger ??= await repo.ledger(widget.id);
      final r = await repo.statement(widget.id, page: page);
      lines.addAll(r.lines);
      meta = r.meta;
    } catch (e) {
      error = e.toString();
    }
    if (mounted) setState(() => loading = false);
  }

  @override
  Widget build(BuildContext context) {
    final hasMore = page < ((meta['totalPages'] ?? 1) as int);
    return Scaffold(
      appBar: AppBar(title: Text(ledger?.name ?? 'Ledger')),
      body: error != null && lines.isEmpty
          ? ErrorView(error!, onRetry: () => _load(reset: true))
          : RefreshIndicator(
              onRefresh: () => _load(reset: true),
              child: ListView(padding: const EdgeInsets.all(12), children: [
                if (ledger != null) Card(child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${ledger!.code} · ${ledger!.groupName}', style: const TextStyle(color: Colors.blueGrey)),
                  const SizedBox(height: 6),
                  Row(children: [Expanded(child: _kv('Debit', Money.format(ledger!.debit))), Expanded(child: _kv('Credit', Money.format(ledger!.credit))), Expanded(child: _kv('Balance', '${Money.format(ledger!.balance)} ${ledger!.side ?? ''}'))]),
                ]))),
                const SizedBox(height: 8),
                Text('Statement', style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 4),
                for (final l in lines) Card(margin: const EdgeInsets.only(bottom: 6), child: ListTile(dense: true, title: Text(l.narration.isEmpty ? l.entryNumber : l.narration, maxLines: 2, overflow: TextOverflow.ellipsis), subtitle: Text('${l.date} · ${l.entryNumber}'),
                    trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                      if (Money.parse(l.debit) > Money.parse('0')) Text('+ ${Money.format(l.debit)}', style: TextStyle(color: Colors.green.shade700, fontWeight: FontWeight.w600)) else Text('- ${Money.format(l.credit)}', style: TextStyle(color: Colors.red.shade700, fontWeight: FontWeight.w600)),
                      Text('Bal ${Money.format(l.running)} ${l.side ?? ''}', style: const TextStyle(fontSize: 10, color: Colors.blueGrey)),
                    ]))),
                if (loading) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
                if (!loading && lines.isEmpty) const Padding(padding: EdgeInsets.all(32), child: EmptyView('No transactions')),
                if (!loading && hasMore) TextButton(onPressed: () { page++; _load(); }, child: const Text('Load more')),
              ]),
            ),
    );
  }

  Widget _kv(String k, String v) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(k, style: const TextStyle(fontSize: 11, color: Colors.blueGrey)), Text(v, style: const TextStyle(fontWeight: FontWeight.w700))]);
}
