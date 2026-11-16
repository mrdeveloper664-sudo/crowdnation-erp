import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../core/api_client.dart';
import '../core/money.dart';
import '../providers/providers.dart';
import '../repositories/draft_store.dart';
import '../repositories/repositories.dart';
import '../widgets/common.dart';

const _statuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED'];
const _types = ['PAYMENT', 'RECEIPT', 'JOURNAL', 'CONTRA', 'SALES', 'PURCHASE'];

class VouchersScreen extends StatefulWidget {
  const VouchersScreen({super.key});
  @override
  State<VouchersScreen> createState() => _VouchersScreenState();
}

class _VouchersScreenState extends State<VouchersScreen> {
  final _search = TextEditingController();
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => context.read<VoucherProvider>().load());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<VoucherProvider>();
    final can = context.watch<AuthProvider>().can('voucher', 'create');
    return Scaffold(
      appBar: AppBar(title: const Text('Vouchers'), actions: [IconButton(icon: const Icon(Icons.edit_note), tooltip: 'Local drafts', onPressed: () => context.push('/drafts'))]),
      floatingActionButton: can ? FloatingActionButton.extended(onPressed: () => _chooseType(context), icon: const Icon(Icons.add), label: const Text('New')) : null,
      body: Column(children: [
        Padding(padding: const EdgeInsets.fromLTRB(12, 8, 12, 0), child: TextField(controller: _search, decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search number, reference, narration'), onSubmitted: (v) => p.load(type: p.type, status: p.status, search: v))),
        SizedBox(height: 44, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 8), children: [
          Padding(padding: const EdgeInsets.all(4), child: ChoiceChip(label: const Text('All status'), selected: p.status == null, onSelected: (_) => p.load(type: p.type, search: _search.text))),
          for (final s in _statuses) Padding(padding: const EdgeInsets.all(4), child: ChoiceChip(label: Text(s.replaceAll('_', ' ')), selected: p.status == s, onSelected: (_) => p.load(type: p.type, status: s, search: _search.text))),
        ])),
        SizedBox(height: 44, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 8), children: [
          Padding(padding: const EdgeInsets.all(4), child: ChoiceChip(label: const Text('All types'), selected: p.type == null, onSelected: (_) => p.load(status: p.status, search: _search.text))),
          for (final t in _types) Padding(padding: const EdgeInsets.all(4), child: ChoiceChip(label: Text(t), selected: p.type == t, onSelected: (_) => p.load(type: t, status: p.status, search: _search.text))),
        ])),
        Expanded(
          child: AsyncList(
            loading: p.loading, error: p.error, isEmpty: p.items.isEmpty, itemCount: p.items.length, onRefresh: () => p.load(type: p.type, status: p.status, search: _search.text), onEnd: p.more, emptyText: 'No vouchers found',
            itemBuilder: (_, i) {
              final v = p.items[i];
              return Card(child: ListTile(onTap: () => context.push('/vouchers/${v.id}'), title: Row(children: [Expanded(child: Text(v.number, style: const TextStyle(fontWeight: FontWeight.w700))), StatusChip(v.status)]),
                  subtitle: Text('${v.type.replaceAll('_', ' ')} · ${v.date}${v.narration == null ? '' : '\n${v.narration}'}', maxLines: 2, overflow: TextOverflow.ellipsis), isThreeLine: v.narration != null, trailing: Amount(v.total, currency: v.currency, bold: true)));
            },
          ),
        ),
      ]),
    );
  }

  void _chooseType(BuildContext context) {
    showModalBottomSheet(context: context, showDragHandle: true, builder: (_) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
      for (final e in {'payment': ('Payment voucher', 'Money paid out of cash/bank', Icons.north_east), 'receipt': ('Receipt voucher', 'Money received into cash/bank', Icons.south_west), 'journal': ('Journal voucher', 'Any balanced debit / credit entry', Icons.balance)}.entries)
        ListTile(leading: Icon(e.value.$3), title: Text(e.value.$1), subtitle: Text(e.value.$2), onTap: () { Navigator.pop(context); context.push('/vouchers/new/${e.key}'); }),
    ])));
  }
}

class VoucherDetailScreen extends StatefulWidget {
  const VoucherDetailScreen({super.key, required this.id});
  final String id;
  @override
  State<VoucherDetailScreen> createState() => _VoucherDetailScreenState();
}

class _VoucherDetailScreenState extends State<VoucherDetailScreen> {
  dynamic v;
  String? error;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      v = await context.read<AccountingRepository>().voucher(widget.id);
      error = null;
    } on ApiException catch (e) {
      error = e.message;
    }
    if (mounted) setState(() {});
  }

  Future<void> _act(String action, {String? reason, String ok = 'Done'}) async {
    setState(() => busy = true);
    try {
      await context.read<AccountingRepository>().voucherAction(widget.id, action, reason: reason);
      if (mounted) showSnack(context, ok);
      await _load();
      if (mounted) context.read<VoucherProvider>().load();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    if (error != null && v == null) return Scaffold(appBar: AppBar(), body: ErrorView(error!, onRetry: _load));
    if (v == null) return Scaffold(appBar: AppBar(), body: const Center(child: CircularProgressIndicator()));
    final s = v.status as String;
    final actions = <Widget>[
      if (['DRAFT', 'REJECTED'].contains(s) && auth.can('voucher', 'create')) FilledButton.tonal(onPressed: busy ? null : () => _act('submit', ok: 'Submitted for approval'), child: const Text('Submit for approval')),
      if (s == 'PENDING_APPROVAL' && auth.can('voucher', 'approve')) FilledButton(onPressed: busy ? null : () => _act('approve', ok: 'Approved'), child: const Text('Approve')),
      if (s == 'PENDING_APPROVAL' && auth.can('voucher', 'approve')) OutlinedButton(onPressed: busy ? null : () async { final r = await askReason(context, 'Reject voucher'); if (r != null) _act('reject', reason: r, ok: 'Rejected'); }, child: const Text('Reject')),
      if (['DRAFT', 'APPROVED'].contains(s) && auth.can('voucher', 'post')) FilledButton(onPressed: busy ? null : () async { if (await confirm(context, 'Post voucher?', 'Posting creates an immutable journal entry.')) _act('post', ok: 'Posted'); }, child: const Text('Post')),
      if (s == 'POSTED' && auth.can('voucher', 'cancel')) OutlinedButton(style: OutlinedButton.styleFrom(foregroundColor: Colors.red.shade700, minimumSize: const Size.fromHeight(48)), onPressed: busy ? null : () async { final r = await askReason(context, 'Cancel (reverse) voucher'); if (r != null) _act('cancel', reason: r, ok: 'Cancelled by reversal'); }, child: const Text('Cancel (reverse)')),
    ];
    return Scaffold(
      appBar: AppBar(title: Text(v.number as String)),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(12), children: [
          Card(child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [Expanded(child: Text((v.type as String).replaceAll('_', ' '), style: Theme.of(context).textTheme.titleMedium)), StatusChip(s)]),
            const SizedBox(height: 6),
            Text('${v.date}${v.reference == null ? '' : ' · Ref ${v.reference}'}', style: const TextStyle(color: Colors.blueGrey)),
            if (v.narration != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(v.narration as String)),
            const SizedBox(height: 8),
            Amount(v.total as String, currency: v.currency as String, bold: true),
            if (v.rejectedReason != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('Rejected: ${v.rejectedReason}', style: TextStyle(color: Colors.red.shade700))),
          ]))),
          const SizedBox(height: 8),
          Text('Entries', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 4),
          for (final l in v.lines as List) Card(margin: const EdgeInsets.only(bottom: 6), child: ListTile(dense: true, title: Text(l.accountName as String), subtitle: (l.description as String).isEmpty ? null : Text(l.description as String), trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
            if (Money.parse(l.debit as String) > Decimal.zero) Text('Dr ${Money.format(l.debit)}', style: const TextStyle(fontWeight: FontWeight.w600)),
            if (Money.parse(l.credit as String) > Decimal.zero) Text('Cr ${Money.format(l.credit)}', style: const TextStyle(fontWeight: FontWeight.w600)),
          ]))),
          const SizedBox(height: 12),
          for (final a in actions) Padding(padding: const EdgeInsets.only(bottom: 8), child: a),
        ]),
      ),
    );
  }
}

// ----------------------------------------------------------------------------- create forms

class _LineEdit {
  _LineEdit();
  LookupOption? account;
  final debit = TextEditingController();
  final credit = TextEditingController();
  final desc = TextEditingController();
  void dispose() { debit.dispose(); credit.dispose(); desc.dispose(); }
}

/// Payment / Receipt / Journal voucher entry designed for phones (no desktop grid).
class VoucherCreateScreen extends StatefulWidget {
  const VoucherCreateScreen({super.key, required this.kind});
  final String kind; // payment | receipt | journal
  @override
  State<VoucherCreateScreen> createState() => _VoucherCreateScreenState();
}

class _VoucherCreateScreenState extends State<VoucherCreateScreen> {
  DateTime date = DateTime.now();
  LookupOption? bank, other; // payment/receipt: cash-bank + counter ledger
  final amount = TextEditingController(), reference = TextEditingController(), narration = TextEditingController();
  final List<_LineEdit> lines = [_LineEdit(), _LineEdit()];
  bool busy = false;
  String? error;

  bool get isJournal => widget.kind == 'journal';
  String get typeName => widget.kind.toUpperCase();

  @override
  void dispose() {
    amount.dispose(); reference.dispose(); narration.dispose();
    for (final l in lines) { l.dispose(); }
    super.dispose();
  }

  Decimal get totalDr => Money.sum(lines.map((l) => l.debit.text));
  Decimal get totalCr => Money.sum(lines.map((l) => l.credit.text));

  /// Builds the API payload. Returns an error string instead when the form is invalid.
  (Map<String, dynamic>?, String?) _buildPayload() {
    final base = <String, dynamic>{'type': typeName, 'date': DateField.iso(date), if (reference.text.trim().isNotEmpty) 'reference': reference.text.trim(), if (narration.text.trim().isNotEmpty) 'narration': narration.text.trim()};
    if (!isJournal) {
      if (bank == null) return (null, widget.kind == 'payment' ? 'Select the cash/bank ledger you pay from' : 'Select the cash/bank ledger receiving the money');
      if (other == null) return (null, widget.kind == 'payment' ? 'Select who/what you are paying' : 'Select who is paying you');
      if (!Money.isValidAmount(amount.text) || Money.parse(amount.text) <= Decimal.zero) return (null, 'Enter a valid amount (up to 4 decimals)');
      final a = amount.text.trim();
      final isPay = widget.kind == 'payment';
      base['lines'] = [
        {'accountId': other!.id, isPay ? 'debit' : 'credit': a},
        {'accountId': bank!.id, isPay ? 'credit' : 'debit': a},
      ];
      return (base, null);
    }
    final used = lines.where((l) => l.account != null && (l.debit.text.isNotEmpty || l.credit.text.isNotEmpty)).toList();
    if (used.length < 2) return (null, 'A journal needs at least two lines');
    for (final l in used) {
      if (l.debit.text.isNotEmpty && l.credit.text.isNotEmpty) return (null, 'Each line is either a debit or a credit');
      for (final t in [l.debit.text, l.credit.text]) {
        if (t.isNotEmpty && !Money.isValidAmount(t)) return (null, 'Invalid amount "$t"');
      }
    }
    if (totalDr != totalCr) return (null, 'Out of balance by ${Money.format(totalDr - totalCr)}');
    base['lines'] = [for (final l in used) {'accountId': l.account!.id, if (l.debit.text.isNotEmpty) 'debit': l.debit.text.trim(), if (l.credit.text.isNotEmpty) 'credit': l.credit.text.trim(), if (l.desc.text.isNotEmpty) 'description': l.desc.text.trim()}];
    return (base, null);
  }

  Future<void> _save({required bool post}) async {
    final (payload, err) = _buildPayload();
    if (err != null) { setState(() => error = err); return; }
    setState(() { busy = true; error = null; });
    final accounting = context.read<AccountingRepository>();
    final drafts = context.read<DraftProvider>();
    try {
      final v = await accounting.createVoucher(payload!);
      if (post) await accounting.voucherAction(v.id, 'post');
      if (!mounted) return;
      showSnack(context, post ? '${v.number} posted' : '${v.number} saved as draft');
      context.read<VoucherProvider>().load();
      context.go('/vouchers/${v.id}');
    } on ApiException catch (e) {
      if (e.offline) {
        // Offline: keep it on the device. It is only ever created as a DRAFT when synced.
        await drafts.add(LocalDraft(id: DateTime.now().microsecondsSinceEpoch.toString(), kind: 'voucher', title: '$typeName ${DateField.iso(date)} · ${narration.text.trim().isEmpty ? 'no narration' : narration.text.trim()}', payload: payload!, createdAt: DateTime.now()));
        if (!mounted) return;
        showSnack(context, 'Offline - saved on this device. Sync it later; it will not be posted until you review it online.');
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
    final canPost = context.read<AuthProvider>().can('voucher', 'post');
    final title = {'payment': 'Payment voucher', 'receipt': 'Receipt voucher', 'journal': 'Journal voucher'}[widget.kind]!;
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        DateField(label: 'Date', value: date, onChanged: (d) => setState(() => date = d)),
        const SizedBox(height: 12),
        if (!isJournal) ...[
          PickerField(label: widget.kind == 'payment' ? 'Pay from (cash / bank)' : 'Deposit to (cash / bank)', value: bank?.label, onTap: () async { final r = await pickLedger(context, accounting, type: 'CASH,BANK', title: 'Cash / bank'); if (r != null) setState(() => bank = r); }),
          const SizedBox(height: 12),
          PickerField(label: widget.kind == 'payment' ? 'Paid to (payee / expense ledger)' : 'Received from (customer / income ledger)', value: other?.label, onTap: () async { final r = await pickLedger(context, accounting); if (r != null) setState(() => other = r); }),
          const SizedBox(height: 12),
          TextField(key: const Key('amount'), controller: amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount')),
        ] else ...[
          for (var i = 0; i < lines.length; i++) Card(margin: const EdgeInsets.only(bottom: 10), child: Padding(padding: const EdgeInsets.all(12), child: Column(children: [
            Row(children: [Text('Line ${i + 1}', style: const TextStyle(fontWeight: FontWeight.w600)), const Spacer(), if (lines.length > 2) IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.close, size: 18), onPressed: () => setState(() => lines.removeAt(i).dispose()))]),
            PickerField(label: 'Ledger', value: lines[i].account?.label, onTap: () async { final r = await pickLedger(context, accounting); if (r != null) setState(() => lines[i].account = r); }),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: TextField(controller: lines[i].debit, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Debit'), onChanged: (v) { if (v.isNotEmpty) lines[i].credit.clear(); setState(() {}); })),
              const SizedBox(width: 8),
              Expanded(child: TextField(controller: lines[i].credit, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Credit'), onChanged: (v) { if (v.isNotEmpty) lines[i].debit.clear(); setState(() {}); })),
            ]),
          ]))),
          OutlinedButton.icon(onPressed: () => setState(() => lines.add(_LineEdit())), icon: const Icon(Icons.add), label: const Text('Add line')),
          const SizedBox(height: 8),
          Card(color: totalDr == totalCr && totalDr > Decimal.zero ? Colors.green.shade50 : Colors.amber.shade50, child: Padding(padding: const EdgeInsets.all(12), child: Row(children: [Expanded(child: Text('Dr ${Money.format(totalDr)}   Cr ${Money.format(totalCr)}')), Text(totalDr == totalCr && totalDr > Decimal.zero ? 'Balanced ✓' : 'Diff ${Money.format(totalDr - totalCr)}', style: const TextStyle(fontWeight: FontWeight.w700))]))),
        ],
        const SizedBox(height: 12),
        TextField(controller: reference, decoration: const InputDecoration(labelText: 'Reference (optional)')),
        const SizedBox(height: 12),
        TextField(controller: narration, maxLines: 2, decoration: const InputDecoration(labelText: 'Narration (optional)')),
        if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, key: const Key('formError'), style: TextStyle(color: Colors.red.shade700))),
        const SizedBox(height: 20),
        if (canPost) FilledButton(key: const Key('savePost'), onPressed: busy ? null : () => _save(post: true), child: const Text('Save & post')),
        if (canPost) const SizedBox(height: 8),
        OutlinedButton(key: const Key('saveDraft'), style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)), onPressed: busy ? null : () => _save(post: false), child: busy ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Save as draft')),
      ]),
    );
  }
}
