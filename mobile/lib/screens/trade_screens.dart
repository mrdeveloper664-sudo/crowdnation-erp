import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../core/api_client.dart';
import '../core/money.dart';
import '../models/models.dart';
import '../providers/providers.dart';
import '../repositories/repositories.dart';
import '../widgets/common.dart';

const _salesTypes = {'INVOICE': 'Invoices', 'QUOTATION': 'Quotes', 'ORDER': 'Orders', 'CREDIT_NOTE': 'Credit notes'};
const _purchaseTypes = {'INVOICE': 'Invoices', 'ORDER': 'Orders', 'GRN': 'GRNs', 'DEBIT_NOTE': 'Debit notes'};

/// Sales invoices (side = sales) and purchase invoices (side = purchases).
class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key, required this.side});
  final String side;
  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  DocumentProvider get p => widget.side == 'sales' ? context.read<DocumentProvider>() : context.read<PurchaseDocumentProvider>();
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => p.load());
  }

  @override
  Widget build(BuildContext context) {
    final isSales = widget.side == 'sales';
    final prov = isSales ? context.watch<DocumentProvider>() : context.watch<PurchaseDocumentProvider>();
    final types = isSales ? _salesTypes : _purchaseTypes;
    final canCreate = context.watch<AuthProvider>().can(isSales ? 'sales' : 'purchase', 'create');
    return Scaffold(
      appBar: AppBar(title: Text(isSales ? 'Sales' : 'Purchases')),
      floatingActionButton: canCreate ? FloatingActionButton.extended(onPressed: () => context.push('/${widget.side}/new'), icon: const Icon(Icons.add), label: Text(isSales ? 'New invoice' : 'New bill')) : null,
      body: Column(children: [
        SizedBox(height: 52, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.all(8), children: [for (final e in types.entries) Padding(padding: const EdgeInsets.only(right: 8), child: ChoiceChip(label: Text(e.value), selected: prov.type == e.key, onSelected: (_) => prov.load(type: e.key)))])),
        Expanded(child: AsyncList(
          loading: prov.loading, error: prov.error, isEmpty: prov.items.isEmpty, itemCount: prov.items.length, onRefresh: () => prov.load(), onEnd: prov.more, emptyText: 'No documents',
          itemBuilder: (_, i) {
            final d = prov.items[i];
            return Card(child: ListTile(onTap: () => context.push('/${widget.side}/${d.id}'), title: Row(children: [Expanded(child: Text(d.number, style: const TextStyle(fontWeight: FontWeight.w700))), StatusChip(d.status)]),
                subtitle: Text('${d.partyName}\n${d.date}${d.outstanding != null && Money.parse(d.outstanding) > Decimal.zero ? ' · due ${Money.format(d.outstanding)}' : ''}'), isThreeLine: true, trailing: Amount(d.total, currency: d.currency, bold: true)));
          },
        )),
      ]),
    );
  }
}

class PurchaseDocumentProvider extends DocumentProvider {
  PurchaseDocumentProvider(TradeRepository repo) : super(repo, 'purchases');
}

class DocumentDetailScreen extends StatefulWidget {
  const DocumentDetailScreen({super.key, required this.side, required this.id});
  final String side, id;
  @override
  State<DocumentDetailScreen> createState() => _DocumentDetailScreenState();
}

class _DocumentDetailScreenState extends State<DocumentDetailScreen> {
  DocumentModel? d;
  String? error;
  bool busy = false;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      d = await context.read<TradeRepository>().document(widget.side, widget.id);
      error = null;
    } on ApiException catch (e) {
      error = e.message;
    }
    if (mounted) setState(() {});
  }

  Future<void> _act(String a, {String? reason, String ok = 'Done'}) async {
    setState(() => busy = true);
    try {
      await context.read<TradeRepository>().documentAction(widget.side, widget.id, a, reason: reason);
      if (mounted) showSnack(context, ok);
      await _load();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    if (error != null && d == null) return Scaffold(appBar: AppBar(), body: ErrorView(error!, onRetry: _load));
    final doc = d;
    if (doc == null) return Scaffold(appBar: AppBar(), body: const Center(child: CircularProgressIndicator()));
    final res = widget.side == 'sales' ? 'sales' : 'purchase';
    final auth = context.watch<AuthProvider>();
    final postable = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].contains(doc.type);
    return Scaffold(
      appBar: AppBar(title: Text(doc.number)),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        Card(child: Padding(padding: const EdgeInsets.all(14), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [Expanded(child: Text(doc.partyName, style: Theme.of(context).textTheme.titleMedium)), StatusChip(doc.status)]),
          Text('${doc.type.replaceAll('_', ' ')} · ${doc.date}', style: const TextStyle(color: Colors.blueGrey)),
          const Divider(height: 24),
          _row('Net', Money.format(doc.net)), _row('VAT', Money.format(doc.vat)), _row('Total ${doc.currency}', Money.format(doc.total), bold: true),
          if (doc.outstanding != null) _row('Outstanding', Money.format(doc.outstanding), bold: true),
        ]))),
        const SizedBox(height: 8),
        Text('Items', style: Theme.of(context).textTheme.titleSmall),
        for (final l in doc.lines) Card(margin: const EdgeInsets.only(top: 6), child: ListTile(dense: true, title: Text(l['description'].toString()), subtitle: Text('${l['quantity']} × ${Money.format(l['unitPrice'])}'), trailing: Amount(l['gross'].toString(), bold: true))),
        const SizedBox(height: 16),
        if (doc.status == 'DRAFT' && postable && auth.can(res, 'post')) FilledButton(onPressed: busy ? null : () async { if (await confirm(context, 'Post to ledger?', 'Creates accounting, VAT and stock entries.')) _act('post', ok: 'Posted'); }, child: const Text('Post')),
        if (doc.status == 'DRAFT' && !postable && auth.can(res, 'edit')) FilledButton(onPressed: busy ? null : () => _act('confirm', ok: 'Confirmed'), child: const Text('Confirm')),
        if (['DRAFT', 'CONFIRMED', 'POSTED'].contains(doc.status) && auth.can(res, 'cancel')) Padding(padding: const EdgeInsets.only(top: 8), child: OutlinedButton(style: OutlinedButton.styleFrom(foregroundColor: Colors.red.shade700, minimumSize: const Size.fromHeight(48)), onPressed: busy ? null : () async { final r = await askReason(context, 'Cancel ${doc.number}'); if (r != null) _act('cancel', reason: r, ok: 'Cancelled'); }, child: const Text('Cancel document'))),
      ]),
    );
  }

  Widget _row(String k, String v, {bool bold = false}) => Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Row(children: [Text(k, style: const TextStyle(color: Colors.blueGrey)), const Spacer(), Text(v, style: TextStyle(fontWeight: bold ? FontWeight.w700 : FontWeight.w500))]));
}

class _ItemEdit {
  final desc = TextEditingController(), qty = TextEditingController(text: '1'), price = TextEditingController();
  String taxCode = 'STD';
  void dispose() { desc.dispose(); qty.dispose(); price.dispose(); }
}

class DocumentCreateScreen extends StatefulWidget {
  const DocumentCreateScreen({super.key, required this.side});
  final String side;
  @override
  State<DocumentCreateScreen> createState() => _DocumentCreateScreenState();
}

class _DocumentCreateScreenState extends State<DocumentCreateScreen> {
  DateTime date = DateTime.now();
  PartyModel? party;
  bool inclusive = false, busy = false;
  String? error;
  final notes = TextEditingController();
  final items = [_ItemEdit()];
  List<Map<String, dynamic>> rates = [];

  @override
  void initState() {
    super.initState();
    context.read<TradeRepository>().taxRates().then((r) { if (mounted) setState(() => rates = r); }).catchError((_) {});
  }

  @override
  void dispose() {
    notes.dispose();
    for (final i in items) { i.dispose(); }
    super.dispose();
  }

  Decimal _rate(String code) {
    final m = rates.where((r) => r['code'] == code && r['isActive'] == true).toList()..sort((a, b) => b['effectiveFrom'].compareTo(a['effectiveFrom']));
    return m.isEmpty ? Decimal.zero : Money.parse(m.first['rate'].toString());
  }

  /// Display-only estimate; the server calculates the authoritative figures.
  ({Decimal net, Decimal vat}) estimate() {
    var net = Decimal.zero, vat = Decimal.zero;
    for (final i in items) {
      final base = (Money.parse(i.qty.text) * Money.parse(i.price.text)).round(scale: 2);
      final r = _rate(i.taxCode);
      if (inclusive) {
        final n = (base * Decimal.fromInt(100) / (Decimal.fromInt(100) + r)).toDecimal(scaleOnInfinitePrecision: 6).round(scale: 2);
        net += n; vat += base - n;
      } else {
        net += base; vat += (base * r / Decimal.fromInt(100)).toDecimal(scaleOnInfinitePrecision: 6).round(scale: 2);
      }
    }
    return (net: net, vat: vat);
  }

  Future<void> _save(bool post) async {
    final isSales = widget.side == 'sales';
    if (party == null) { setState(() => error = 'Select a ${isSales ? 'customer' : 'supplier'}'); return; }
    final used = items.where((i) => i.desc.text.trim().isNotEmpty).toList();
    if (used.isEmpty) { setState(() => error = 'Add at least one item'); return; }
    for (final i in used) {
      if (!RegExp(r'^\d{1,12}(\.\d{1,4})?$').hasMatch(i.qty.text.trim()) || !Money.isValidAmount(i.price.text)) { setState(() => error = 'Check quantity and price on "${i.desc.text}"'); return; }
    }
    setState(() { busy = true; error = null; });
    final repo = context.read<TradeRepository>();
    try {
      final doc = await repo.createDocument(widget.side, {'type': 'INVOICE', 'partyId': party!.id, 'date': DateField.iso(date), 'pricesIncludeVat': inclusive, if (notes.text.trim().isNotEmpty) 'notes': notes.text.trim(),
        'lines': [for (final i in used) {'description': i.desc.text.trim(), 'quantity': i.qty.text.trim(), 'unitPrice': i.price.text.trim(), 'taxCode': i.taxCode}]});
      if (post) await repo.documentAction(widget.side, doc.id, 'post');
      if (!mounted) return;
      showSnack(context, post ? '${doc.number} posted' : '${doc.number} saved as draft');
      (isSales ? context.read<DocumentProvider>() : context.read<PurchaseDocumentProvider>()).load();
      context.go('/${widget.side}/${doc.id}');
    } on ApiException catch (e) {
      setState(() => error = e.offline ? 'You are offline. Invoices need a connection (use a voucher draft for offline entry).' : e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isSales = widget.side == 'sales';
    final repo = context.read<TradeRepository>();
    final est = estimate();
    final canPost = context.read<AuthProvider>().can(isSales ? 'sales' : 'purchase', 'post');
    final codes = {...rates.map((r) => r['code'].toString()), 'STD'}.toList();
    return Scaffold(
      appBar: AppBar(title: Text(isSales ? 'New invoice' : 'New purchase bill')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        PickerField(label: isSales ? 'Customer' : 'Supplier', value: party?.name, onTap: () async {
          final r = await pickLookup(context, title: isSales ? 'Customers' : 'Suppliers', search: (q) async => (await repo.parties(isSales ? 'customers' : 'suppliers', search: q)).map((p) => LookupOption(p.id, p.name, p.code)).toList());
          if (r != null) setState(() => party = PartyModel(id: r.id, code: r.hint ?? '', name: r.label));
        }),
        const SizedBox(height: 12),
        DateField(label: 'Date', value: date, onChanged: (d) => setState(() => date = d)),
        SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Prices include VAT'), value: inclusive, onChanged: (v) => setState(() => inclusive = v)),
        for (var n = 0; n < items.length; n++) Card(margin: const EdgeInsets.only(bottom: 10), child: Padding(padding: const EdgeInsets.all(12), child: Column(children: [
          Row(children: [Text('Item ${n + 1}', style: const TextStyle(fontWeight: FontWeight.w600)), const Spacer(), if (items.length > 1) IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.close, size: 18), onPressed: () => setState(() => items.removeAt(n).dispose()))]),
          TextField(controller: items[n].desc, decoration: const InputDecoration(labelText: 'Description'), onChanged: (_) => setState(() {})),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: TextField(controller: items[n].qty, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Qty'), onChanged: (_) => setState(() {}))),
            const SizedBox(width: 8),
            Expanded(flex: 2, child: TextField(controller: items[n].price, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Unit price'), onChanged: (_) => setState(() {}))),
            const SizedBox(width: 8),
            Expanded(child: DropdownButtonFormField<String>(initialValue: items[n].taxCode, items: [for (final c in codes) DropdownMenuItem(value: c, child: Text(c))], onChanged: (v) => setState(() => items[n].taxCode = v ?? 'STD'), decoration: const InputDecoration(labelText: 'Tax'))),
          ]),
        ]))),
        OutlinedButton.icon(onPressed: () => setState(() => items.add(_ItemEdit())), icon: const Icon(Icons.add), label: const Text('Add item')),
        const SizedBox(height: 12),
        TextField(controller: notes, maxLines: 2, decoration: const InputDecoration(labelText: 'Notes (optional)')),
        const SizedBox(height: 12),
        Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(children: [
          Row(children: [const Text('Net'), const Spacer(), Text(Money.format(est.net))]),
          Row(children: [const Text('VAT'), const Spacer(), Text(Money.format(est.vat))]),
          const Divider(),
          Row(children: [const Text('Total (estimate)', style: TextStyle(fontWeight: FontWeight.w700)), const Spacer(), Text(Money.format(est.net + est.vat), style: const TextStyle(fontWeight: FontWeight.w700))]),
        ]))),
        if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: TextStyle(color: Colors.red.shade700))),
        const SizedBox(height: 16),
        if (canPost) FilledButton(onPressed: busy ? null : () => _save(true), child: const Text('Save & post')),
        if (canPost) const SizedBox(height: 8),
        OutlinedButton(style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)), onPressed: busy ? null : () => _save(false), child: const Text('Save as draft')),
      ]),
    );
  }
}

// ----------------------------------------------------------------------------- parties

class PartiesScreen extends StatefulWidget {
  const PartiesScreen({super.key, required this.kind});
  final String kind; // customers | suppliers
  @override
  State<PartiesScreen> createState() => _PartiesScreenState();
}

class _PartiesScreenState extends State<PartiesScreen> {
  final _search = TextEditingController();
  PartyProvider get p => widget.kind == 'customers' ? context.read<CustomerProvider>() : context.read<SupplierProvider>();
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => p.load());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final prov = widget.kind == 'customers' ? context.watch<CustomerProvider>() : context.watch<SupplierProvider>();
    final canCreate = context.watch<AuthProvider>().can(widget.kind == 'customers' ? 'customer' : 'supplier', 'create');
    final label = widget.kind == 'customers' ? 'Customers' : 'Suppliers';
    return Scaffold(
      appBar: AppBar(title: Text(label)),
      floatingActionButton: canCreate ? FloatingActionButton.extended(onPressed: () async { await context.push('/${widget.kind}/new'); prov.load(); }, icon: const Icon(Icons.person_add), label: const Text('New')) : null,
      body: Column(children: [
        Padding(padding: const EdgeInsets.fromLTRB(12, 8, 12, 4), child: TextField(controller: _search, decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: 'Search $label'), onSubmitted: (v) => prov.load(search: v))),
        Expanded(child: AsyncList(
          loading: prov.loading, error: prov.error, isEmpty: prov.items.isEmpty, itemCount: prov.items.length, onRefresh: () => prov.load(search: _search.text), emptyText: 'No ${label.toLowerCase()} yet',
          itemBuilder: (_, i) {
            final x = prov.items[i];
            return Card(child: ListTile(onTap: () => context.push('/${widget.kind}/${x.id}'), leading: CircleAvatar(child: Text(x.name.isEmpty ? '?' : x.name[0].toUpperCase())), title: Text(x.name), subtitle: Text([x.code, if (x.phone != null) x.phone!].join(' · ')), trailing: Amount(x.balance, side: x.side, bold: true)));
          },
        )),
      ]),
    );
  }
}

class CustomerProvider extends PartyProvider {
  CustomerProvider(TradeRepository repo) : super(repo, 'customers');
}

class SupplierProvider extends PartyProvider {
  SupplierProvider(TradeRepository repo) : super(repo, 'suppliers');
}

class PartyDetailScreen extends StatefulWidget {
  const PartyDetailScreen({super.key, required this.kind, required this.id});
  final String kind, id;
  @override
  State<PartyDetailScreen> createState() => _PartyDetailScreenState();
}

class _PartyDetailScreenState extends State<PartyDetailScreen> {
  PartyModel? p;
  String? error;
  @override
  void initState() {
    super.initState();
    context.read<TradeRepository>().party(widget.kind, widget.id).then((x) { if (mounted) setState(() => p = x); }).catchError((e) { if (mounted) setState(() => error = e.toString()); });
  }

  @override
  Widget build(BuildContext context) {
    if (error != null) return Scaffold(appBar: AppBar(), body: ErrorView(error!));
    final x = p;
    if (x == null) return Scaffold(appBar: AppBar(), body: const Center(child: CircularProgressIndicator()));
    return Scaffold(
      appBar: AppBar(title: Text(x.name)),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(x.code, style: const TextStyle(color: Colors.blueGrey)),
          if (x.email != null) ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: const Icon(Icons.email_outlined), title: Text(x.email!)),
          if (x.phone != null) ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: const Icon(Icons.phone_outlined), title: Text(x.phone!)),
          if (x.trn != null) ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: const Icon(Icons.receipt_long_outlined), title: Text('TRN ${x.trn}')),
          const Divider(),
          Row(children: [const Text('Balance'), const Spacer(), Amount(x.balance, side: x.side, bold: true)]),
        ]))),
        const SizedBox(height: 12),
        FilledButton.icon(onPressed: () => context.push('/ledgers/${x.accountId}'), icon: const Icon(Icons.receipt), label: const Text('View statement')),
      ]),
    );
  }
}

class PartyCreateScreen extends StatefulWidget {
  const PartyCreateScreen({super.key, required this.kind});
  final String kind;
  @override
  State<PartyCreateScreen> createState() => _PartyCreateScreenState();
}

class _PartyCreateScreenState extends State<PartyCreateScreen> {
  final _form = GlobalKey<FormState>();
  final name = TextEditingController(), email = TextEditingController(), phone = TextEditingController(), trn = TextEditingController();
  bool busy = false;
  String? error;

  @override
  void dispose() {
    name.dispose(); email.dispose(); phone.dispose(); trn.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() { busy = true; error = null; });
    try {
      await context.read<TradeRepository>().createParty(widget.kind, {'name': name.text.trim(), if (email.text.trim().isNotEmpty) 'email': email.text.trim(), if (phone.text.trim().isNotEmpty) 'phone': phone.text.trim(), if (trn.text.trim().isNotEmpty) 'trn': trn.text.trim()});
      if (mounted) context.pop();
    } on ApiException catch (e) {
      setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(widget.kind == 'customers' ? 'New customer' : 'New supplier')),
        body: Form(key: _form, child: ListView(padding: const EdgeInsets.all(16), children: [
          TextFormField(controller: name, decoration: const InputDecoration(labelText: 'Name'), validator: (v) => (v ?? '').trim().length < 2 ? 'Enter a name' : null),
          const SizedBox(height: 12),
          TextFormField(controller: email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email'), validator: (v) => (v ?? '').trim().isEmpty || RegExp(r'^\S+@\S+\.\S+$').hasMatch(v!.trim()) ? null : 'Invalid email'),
          const SizedBox(height: 12),
          TextFormField(controller: phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Phone')),
          const SizedBox(height: 12),
          TextFormField(controller: trn, decoration: const InputDecoration(labelText: 'VAT TRN')),
          if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: TextStyle(color: Colors.red.shade700))),
          const SizedBox(height: 20),
          FilledButton(onPressed: busy ? null : _save, child: const Text('Save')),
        ])),
      );
}
