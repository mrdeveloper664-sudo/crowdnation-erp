import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../core/api_client.dart';
import '../core/money.dart';
import '../models/models.dart';
import '../providers/providers.dart';
import '../repositories/draft_store.dart';
import '../repositories/repositories.dart';
import '../widgets/common.dart';

class ExpensesScreen extends StatefulWidget {
  const ExpensesScreen({super.key});
  @override
  State<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends State<ExpensesScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => context.read<ExpenseProvider>().load());
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<ExpenseProvider>();
    final auth = context.watch<AuthProvider>();
    return Scaffold(
      appBar: AppBar(title: const Text('Expenses')),
      floatingActionButton: auth.can('expense', 'create') ? FloatingActionButton.extended(onPressed: () async { await context.push('/expenses/new'); if (context.mounted) p.load(status: p.status); }, icon: const Icon(Icons.add), label: const Text('Add expense')) : null,
      body: Column(children: [
        SizedBox(height: 52, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.all(8), children: [
          Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: const Text('All'), selected: p.status == null, onSelected: (_) => p.load())),
          for (final s in ['DRAFT', 'SUBMITTED', 'POSTED', 'REJECTED', 'REIMBURSED']) Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: Text(s), selected: p.status == s, onSelected: (_) => p.load(status: s))),
        ])),
        Expanded(child: AsyncList(
          loading: p.loading, error: p.error, isEmpty: p.items.isEmpty, itemCount: p.items.length, onRefresh: () => p.load(status: p.status), emptyText: 'No expenses',
          itemBuilder: (_, i) {
            final e = p.items[i];
            return Card(child: ListTile(onTap: () => _open(context, e), title: Text(e.description, maxLines: 1, overflow: TextOverflow.ellipsis), subtitle: Text('${e.number} · ${e.date} · ${e.kind}'), trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [Amount(e.total, bold: true), StatusChip(e.status)])));
          },
        )),
      ]),
    );
  }

  void _open(BuildContext context, ExpenseModel e) {
    final auth = context.read<AuthProvider>();
    final repo = context.read<ExpenseRepository>();
    final prov = context.read<ExpenseProvider>();
    showModalBottomSheet(context: context, showDragHandle: true, builder: (ctx) {
      Future<void> act(String a, {String? reason}) async {
        Navigator.pop(ctx);
        try {
          await repo.action(e.id, a, reason: reason);
          if (context.mounted) showSnack(context, 'Done');
        } on ApiException catch (x) {
          if (context.mounted) showSnack(context, x.message, error: true);
        }
        prov.load(status: prov.status);
      }

      return SafeArea(child: Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 16), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [Expanded(child: Text(e.number, style: Theme.of(ctx).textTheme.titleMedium)), StatusChip(e.status)]),
        const SizedBox(height: 4),
        Text(e.description),
        const SizedBox(height: 8),
        Text('Total ${Money.format(e.total)} (VAT ${Money.format(e.vat)}) · ${e.date}', style: const TextStyle(color: Colors.blueGrey)),
        const SizedBox(height: 16),
        if (['DRAFT', 'REJECTED'].contains(e.status) && auth.can('expense', 'create')) FilledButton(onPressed: () => act('submit'), child: const Text('Submit for approval')),
        if (e.status == 'SUBMITTED' && auth.can('expense', 'approve')) ...[
          FilledButton(onPressed: () => act('approve'), child: const Text('Approve & post')),
          const SizedBox(height: 8),
          OutlinedButton(style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)), onPressed: () async { final r = await askReason(ctx, 'Reject expense'); if (r != null) await act('reject', reason: r); }, child: const Text('Reject')),
        ],
      ])));
    });
  }
}

class ExpenseCreateScreen extends StatefulWidget {
  const ExpenseCreateScreen({super.key});
  @override
  State<ExpenseCreateScreen> createState() => _ExpenseCreateScreenState();
}

class _ExpenseCreateScreenState extends State<ExpenseCreateScreen> {
  DateTime date = DateTime.now();
  String kind = 'DIRECT', taxCode = 'STD';
  bool includesVat = false, busy = false;
  String? categoryId, error;
  LookupOption? paidFrom;
  List<Map<String, dynamic>> categories = [];
  final amount = TextEditingController(), description = TextEditingController();

  @override
  void initState() {
    super.initState();
    context.read<ExpenseRepository>().categories().then((c) { if (mounted) setState(() => categories = c); }).catchError((_) {});
  }

  @override
  void dispose() {
    amount.dispose();
    description.dispose();
    super.dispose();
  }

  Future<void> _save({required bool submit}) async {
    if (categoryId == null) { setState(() => error = 'Select a category'); return; }
    if (!Money.isValidAmount(amount.text) || Money.parse(amount.text) <= Decimal.zero) { setState(() => error = 'Enter a valid amount'); return; }
    if (description.text.trim().length < 2) { setState(() => error = 'Add a short description'); return; }
    if (kind == 'DIRECT' && paidFrom == null) { setState(() => error = 'Select the cash/bank ledger it was paid from'); return; }
    final payload = {'kind': kind, 'categoryId': categoryId, 'date': DateField.iso(date), 'description': description.text.trim(), 'amount': amount.text.trim(), 'includesVat': includesVat, 'taxCode': taxCode, if (kind == 'DIRECT') 'paidFromId': paidFrom!.id};
    setState(() { busy = true; error = null; });
    final repo = context.read<ExpenseRepository>();
    final drafts = context.read<DraftProvider>();
    try {
      final e = await repo.create(payload);
      if (submit) await repo.action(e.id, 'submit');
      if (!mounted) return;
      showSnack(context, submit ? '${e.number} submitted' : '${e.number} saved');
      context.pop();
    } on ApiException catch (e) {
      if (e.offline) {
        await drafts.add(LocalDraft(id: DateTime.now().microsecondsSinceEpoch.toString(), kind: 'expense', title: 'Expense ${DateField.iso(date)} · ${description.text.trim()}', payload: payload, createdAt: DateTime.now()));
        if (!mounted) return;
        showSnack(context, 'Offline - saved on this device. Sync it when you are back online.');
        context.pop();
      } else {
        setState(() => error = e.message);
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final accounting = context.read<AccountingRepository>();
    return Scaffold(
      appBar: AppBar(title: const Text('New expense')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        SegmentedButton<String>(segments: const [ButtonSegment(value: 'DIRECT', label: Text('Paid by company')), ButtonSegment(value: 'CLAIM', label: Text('My claim'))], selected: {kind}, onSelectionChanged: (s) => setState(() => kind = s.first)),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(initialValue: categoryId, hint: const Text('Category'), items: [for (final c in categories) DropdownMenuItem(value: c['id'].toString(), child: Text(c['name'].toString()))], onChanged: (v) => setState(() => categoryId = v), decoration: const InputDecoration(labelText: 'Category')),
        const SizedBox(height: 12),
        DateField(label: 'Date', value: date, onChanged: (d) => setState(() => date = d)),
        const SizedBox(height: 12),
        TextField(key: const Key('expenseAmount'), controller: amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount')),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Amount includes VAT'), value: includesVat, onChanged: (v) => setState(() => includesVat = v)),
        DropdownButtonFormField<String>(initialValue: taxCode, items: const [DropdownMenuItem(value: 'STD', child: Text('Standard rated 5%')), DropdownMenuItem(value: 'ZERO', child: Text('Zero rated')), DropdownMenuItem(value: 'EXEMPT', child: Text('Exempt')), DropdownMenuItem(value: 'OOS', child: Text('Out of scope (no VAT)'))], onChanged: (v) => setState(() => taxCode = v ?? 'STD'), decoration: const InputDecoration(labelText: 'VAT treatment')),
        const SizedBox(height: 12),
        if (kind == 'DIRECT') PickerField(label: 'Paid from (cash / bank)', value: paidFrom?.label, onTap: () async { final r = await pickLedger(context, accounting, type: 'CASH,BANK', title: 'Cash / bank'); if (r != null) setState(() => paidFrom = r); }),
        if (kind == 'DIRECT') const SizedBox(height: 12),
        TextField(controller: description, maxLines: 2, decoration: const InputDecoration(labelText: 'Description')),
        if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, key: const Key('expenseError'), style: TextStyle(color: Colors.red.shade700))),
        const SizedBox(height: 20),
        FilledButton(onPressed: busy ? null : () => _save(submit: true), child: const Text('Save & submit for approval')),
        const SizedBox(height: 8),
        OutlinedButton(style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)), onPressed: busy ? null : () => _save(submit: false), child: const Text('Save as draft')),
      ]),
    );
  }
}
