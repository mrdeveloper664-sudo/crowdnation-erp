import 'package:flutter/material.dart';
import '../core/api_client.dart';
import '../core/money.dart';
import '../core/theme.dart';
import '../repositories/repositories.dart';

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key});
  final String status;
  @override
  Widget build(BuildContext context) {
    final c = AppTheme.statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(status.replaceAll('_', ' '), style: TextStyle(color: c, fontSize: 11, fontWeight: FontWeight.w600)),
    );
  }
}

class StatCard extends StatelessWidget {
  const StatCard({super.key, required this.label, required this.value, this.sub, this.negative = false});
  final String label, value;
  final String? sub;
  final bool negative;
  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(label.toUpperCase(), style: Theme.of(context).textTheme.labelSmall?.copyWith(color: Colors.blueGrey, letterSpacing: .5)),
          const SizedBox(height: 4),
          FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(value, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700, color: negative ? Colors.red.shade700 : null))),
          if (sub != null) Text(sub!, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.blueGrey)),
        ]),
      ),
    );
  }
}

class Amount extends StatelessWidget {
  const Amount(this.value, {super.key, this.currency, this.bold = false, this.side});
  final String value;
  final String? currency, side;
  final bool bold;
  @override
  Widget build(BuildContext context) => Text('${Money.format(value)}${side != null ? ' $side' : ''}${currency != null ? ' $currency' : ''}',
      style: TextStyle(fontFeatures: const [FontFeature.tabularFigures()], fontWeight: bold ? FontWeight.w700 : FontWeight.w500));
}

class ErrorView extends StatelessWidget {
  const ErrorView(this.message, {super.key, this.onRetry});
  final String message;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.cloud_off, size: 40, color: Colors.red.shade300),
          const SizedBox(height: 8),
          Text(message, textAlign: TextAlign.center),
          if (onRetry != null) TextButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Retry')),
        ])),
      );
}

class EmptyView extends StatelessWidget {
  const EmptyView(this.message, {super.key, this.icon = Icons.inbox_outlined});
  final String message;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Center(child: Column(mainAxisSize: MainAxisSize.min, children: [Icon(icon, size: 44, color: Colors.blueGrey.shade200), const SizedBox(height: 8), Text(message, style: const TextStyle(color: Colors.blueGrey))]));
}

/// Pull-to-refresh list with loading / error / empty handling and optional infinite scroll.
class AsyncList extends StatelessWidget {
  const AsyncList({super.key, required this.loading, required this.error, required this.isEmpty, required this.onRefresh, required this.itemCount, required this.itemBuilder, this.emptyText = 'Nothing here yet', this.onEnd, this.padding = const EdgeInsets.fromLTRB(12, 8, 12, 96)});
  final bool loading, isEmpty;
  final String? error;
  final Future<void> Function() onRefresh;
  final int itemCount;
  final Widget Function(BuildContext, int) itemBuilder;
  final String emptyText;
  final VoidCallback? onEnd;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context) {
    if (loading && itemCount == 0) return const Center(child: CircularProgressIndicator());
    if (error != null && itemCount == 0) return ErrorView(error!, onRetry: onRefresh);
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: isEmpty
          ? ListView(children: [SizedBox(height: 260, child: EmptyView(emptyText))])
          : NotificationListener<ScrollNotification>(
              onNotification: (n) {
                if (onEnd != null && n.metrics.pixels >= n.metrics.maxScrollExtent - 200) onEnd!();
                return false;
              },
              child: ListView.separated(padding: padding, itemCount: itemCount, separatorBuilder: (_, _) => const SizedBox(height: 8), itemBuilder: itemBuilder)),
    );
  }
}

void showSnack(BuildContext context, String msg, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(msg), backgroundColor: error ? Colors.red.shade700 : null, behavior: SnackBarBehavior.floating));
}

Future<String?> askReason(BuildContext context, String title) async {
  final c = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (_) => AlertDialog(
      title: Text(title),
      content: TextField(controller: c, autofocus: true, maxLines: 3, decoration: const InputDecoration(hintText: 'Reason (min 3 characters)')),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(90, 40)), onPressed: () => c.text.trim().length >= 3 ? Navigator.pop(context, c.text.trim()) : null, child: const Text('Confirm'))],
    ),
  );
}

Future<bool> confirm(BuildContext context, String title, String message) async =>
    await showDialog<bool>(context: context, builder: (_) => AlertDialog(title: Text(title), content: Text(message), actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')), FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(90, 40)), onPressed: () => Navigator.pop(context, true), child: const Text('Confirm'))])) ?? false;

/// Searchable bottom-sheet picker backed by an async lookup.
class LookupOption {
  LookupOption(this.id, this.label, [this.hint]);
  final String id, label;
  final String? hint;
}

Future<LookupOption?> pickLookup(BuildContext context, {required String title, required Future<List<LookupOption>> Function(String search) search}) {
  return showModalBottomSheet<LookupOption>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => _LookupSheet(title: title, search: search),
  );
}

class _LookupSheet extends StatefulWidget {
  const _LookupSheet({required this.title, required this.search});
  final String title;
  final Future<List<LookupOption>> Function(String) search;
  @override
  State<_LookupSheet> createState() => _LookupSheetState();
}

class _LookupSheetState extends State<_LookupSheet> {
  List<LookupOption> items = [];
  bool loading = true;
  String? error;
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load('');
  }

  Future<void> _load(String q) async {
    final id = ++_seq;
    setState(() => loading = true);
    try {
      final r = await widget.search(q);
      if (id == _seq && mounted) setState(() { items = r; loading = false; error = null; });
    } on ApiException catch (e) {
      if (id == _seq && mounted) setState(() { loading = false; error = e.message; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.7,
        child: Column(children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: TextField(autofocus: true, decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: 'Search ${widget.title.toLowerCase()}'), onChanged: _load)),
          if (loading) const LinearProgressIndicator(minHeight: 2),
          if (error != null) Padding(padding: const EdgeInsets.all(12), child: Text(error!, style: TextStyle(color: Colors.red.shade700))),
          Expanded(child: ListView.builder(itemCount: items.length, itemBuilder: (_, i) => ListTile(title: Text(items[i].label), subtitle: items[i].hint == null ? null : Text(items[i].hint!), onTap: () => Navigator.pop(context, items[i])))),
        ]),
      ),
    );
  }
}

Future<LookupOption?> pickLedger(BuildContext context, AccountingRepository repo, {String? type, String title = 'Ledger'}) => pickLookup(context,
    title: title, search: (q) async => (await repo.accounts(search: q, type: type)).map((a) => LookupOption(a['id'], '${a['code']}  ${a['name']}', a['type'])).toList());

class PickerField extends StatelessWidget {
  const PickerField({super.key, required this.label, required this.value, required this.onTap, this.error});
  final String label;
  final String? value, error;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: InputDecorator(decoration: InputDecoration(labelText: label, errorText: error, suffixIcon: const Icon(Icons.arrow_drop_down)), child: Text(value ?? 'Select…', style: TextStyle(color: value == null ? Colors.blueGrey : null))),
      );
}

class DateField extends StatelessWidget {
  const DateField({super.key, required this.label, required this.value, required this.onChanged});
  final String label;
  final DateTime value;
  final ValueChanged<DateTime> onChanged;
  static String iso(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: () async {
          final d = await showDatePicker(context: context, initialDate: value, firstDate: DateTime(2018), lastDate: DateTime(2100));
          if (d != null) onChanged(d);
        },
        child: InputDecorator(decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.calendar_today, size: 18)), child: Text(iso(value))),
      );
}
