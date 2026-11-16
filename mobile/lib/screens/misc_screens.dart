import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../core/api_client.dart';
import '../models/models.dart';
import '../providers/providers.dart';
import '../repositories/repositories.dart';
import '../widgets/common.dart';

class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final drafts = context.watch<DraftProvider>().drafts.length;
    final unread = context.watch<NotificationProvider>().unread;
    Widget tile(IconData i, String t, String route, {String? sub, Widget? trailing, bool show = true}) => show ? ListTile(leading: Icon(i), title: Text(t), subtitle: sub == null ? null : Text(sub), trailing: trailing ?? const Icon(Icons.chevron_right), onTap: () => context.push(route)) : const SizedBox.shrink();
    return Scaffold(
      appBar: AppBar(title: const Text('More')),
      body: ListView(children: [
        ListTile(leading: CircleAvatar(child: Text((auth.session?.name ?? '?')[0].toUpperCase())), title: Text(auth.session?.name ?? ''), subtitle: Text('${auth.session?.company.name ?? ''} · ${auth.session?.roles.join(', ') ?? ''}'), onTap: () => context.push('/profile')),
        const Divider(),
        tile(Icons.account_balance_wallet_outlined, 'Ledgers', '/ledgers', sub: 'Balances and statements', show: auth.can('ledger')),
        tile(Icons.people_outline, 'Customers', '/customers', show: auth.can('customer')),
        tile(Icons.local_shipping_outlined, 'Suppliers', '/suppliers', show: auth.can('supplier')),
        tile(Icons.shopping_cart_outlined, 'Purchases', '/purchases', sub: 'Bills, orders, debit notes', show: auth.can('purchase')),
        tile(Icons.receipt_long_outlined, 'Expenses', '/expenses', show: auth.can('expense')),
        tile(Icons.fact_check_outlined, 'Approvals', '/approvals', sub: 'Vouchers and expenses waiting for you', show: auth.can('voucher', 'approve') || auth.can('expense', 'approve')),
        tile(Icons.notifications_outlined, 'Notifications', '/notifications', trailing: unread > 0 ? Badge(label: Text('$unread')) : const Icon(Icons.chevron_right)),
        tile(Icons.edit_note, 'Offline drafts', '/drafts', sub: drafts == 0 ? 'Nothing waiting to sync' : '$drafts waiting to sync', trailing: drafts > 0 ? Badge(label: Text('$drafts')) : const Icon(Icons.chevron_right)),
        tile(Icons.person_outline, 'Profile', '/profile'),
      ]),
    );
  }
}

class ApprovalsScreen extends StatefulWidget {
  const ApprovalsScreen({super.key});
  @override
  State<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

class _ApprovalsScreenState extends State<ApprovalsScreen> {
  List<VoucherModel> vouchers = [];
  List<ExpenseModel> expenses = [];
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final auth = context.read<AuthProvider>();
    final accRepo = context.read<AccountingRepository>();
    final expRepo = context.read<ExpenseRepository>();
    setState(() { loading = true; error = null; });
    try {
      if (auth.can('voucher', 'approve')) vouchers = (await accRepo.vouchers(status: 'PENDING_APPROVAL')).items;
      if (auth.can('expense', 'approve')) expenses = await expRepo.list(status: 'SUBMITTED');
    } on ApiException catch (e) {
      error = e.message;
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> _decide(Future<void> Function() fn, String ok) async {
    try {
      await fn();
      if (mounted) showSnack(context, ok);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final acc = context.read<AccountingRepository>();
    final exp = context.read<ExpenseRepository>();
    return Scaffold(
      appBar: AppBar(title: const Text('Approvals')),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? ErrorView(error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(12), children: [
                    if (vouchers.isEmpty && expenses.isEmpty) const Padding(padding: EdgeInsets.only(top: 120), child: EmptyView('You are all caught up', icon: Icons.verified_outlined)),
                    if (vouchers.isNotEmpty) Text('Vouchers', style: Theme.of(context).textTheme.titleSmall),
                    for (final v in vouchers) Card(margin: const EdgeInsets.only(top: 8), child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      InkWell(onTap: () => context.push('/vouchers/${v.id}'), child: Row(children: [Expanded(child: Text('${v.number} · ${v.type.replaceAll('_', ' ')}', style: const TextStyle(fontWeight: FontWeight.w700))), Amount(v.total, currency: v.currency, bold: true)])),
                      if (v.narration != null) Text(v.narration!, style: const TextStyle(color: Colors.blueGrey)),
                      const SizedBox(height: 8),
                      Row(children: [
                        Expanded(child: FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(0, 42)), onPressed: () => _decide(() => acc.voucherAction(v.id, 'approve'), '${v.number} approved'), child: const Text('Approve'))),
                        const SizedBox(width: 8),
                        Expanded(child: OutlinedButton(style: OutlinedButton.styleFrom(minimumSize: const Size(0, 42)), onPressed: () async { final r = await askReason(context, 'Reject ${v.number}'); if (r != null) _decide(() => acc.voucherAction(v.id, 'reject', reason: r), 'Rejected'); }, child: const Text('Reject'))),
                      ]),
                    ]))),
                    if (expenses.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 16), child: Text('Expenses', style: Theme.of(context).textTheme.titleSmall)),
                    for (final e in expenses) Card(margin: const EdgeInsets.only(top: 8), child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [Expanded(child: Text('${e.number} · ${e.description}', style: const TextStyle(fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis)), Amount(e.total, bold: true)]),
                      Text('${e.kind} · ${e.date}', style: const TextStyle(color: Colors.blueGrey)),
                      const SizedBox(height: 8),
                      Row(children: [
                        Expanded(child: FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(0, 42)), onPressed: () => _decide(() => exp.action(e.id, 'approve'), '${e.number} approved & posted'), child: const Text('Approve'))),
                        const SizedBox(width: 8),
                        Expanded(child: OutlinedButton(style: OutlinedButton.styleFrom(minimumSize: const Size(0, 42)), onPressed: () async { final r = await askReason(context, 'Reject ${e.number}'); if (r != null) _decide(() => exp.action(e.id, 'reject', reason: r), 'Rejected'); }, child: const Text('Reject'))),
                      ]),
                    ]))),
                  ]),
                ),
    );
  }
}

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => context.read<NotificationProvider>().load());
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<NotificationProvider>();
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications'), actions: [TextButton(onPressed: p.unread == 0 ? null : p.markAll, child: const Text('Mark all read'))]),
      body: AsyncList(
        loading: p.loading, error: p.error, isEmpty: p.items.isEmpty, itemCount: p.items.length, onRefresh: p.load, emptyText: "You're all caught up",
        itemBuilder: (_, i) {
          final n = p.items[i];
          return Card(color: n.read ? null : Colors.blue.shade50, child: ListTile(leading: Icon(n.read ? Icons.notifications_none : Icons.notifications_active, color: n.read ? Colors.blueGrey : Theme.of(context).colorScheme.primary), title: Text(n.title, style: TextStyle(fontWeight: n.read ? FontWeight.w400 : FontWeight.w700)), subtitle: n.body == null ? null : Text(n.body!), trailing: Text('${n.createdAt.day}/${n.createdAt.month}', style: const TextStyle(fontSize: 11, color: Colors.blueGrey)), onTap: () => p.markRead(n.id)));
        },
      ),
    );
  }
}

class DraftsScreen extends StatefulWidget {
  const DraftsScreen({super.key});
  @override
  State<DraftsScreen> createState() => _DraftsScreenState();
}

class _DraftsScreenState extends State<DraftsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => context.read<DraftProvider>().load());
  }

  @override
  Widget build(BuildContext context) {
    final p = context.watch<DraftProvider>();
    return Scaffold(
      appBar: AppBar(title: const Text('Offline drafts')),
      body: Column(children: [
        Card(margin: const EdgeInsets.all(12), color: Colors.blue.shade50, child: const Padding(padding: EdgeInsets.all(12), child: Text('Drafts entered offline are stored on this device. Syncing creates DRAFTS on the server, where they are validated. Nothing is posted until you review and post it online.'))),
        if (p.lastMessage != null) Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: Text(p.lastMessage!, style: const TextStyle(color: Colors.blueGrey))),
        Expanded(child: p.drafts.isEmpty ? const EmptyView('No drafts waiting', icon: Icons.cloud_done_outlined) : ListView.separated(padding: const EdgeInsets.all(12), itemCount: p.drafts.length, separatorBuilder: (_, _) => const SizedBox(height: 8), itemBuilder: (_, i) {
          final d = p.drafts[i];
          return Card(child: ListTile(leading: Icon(d.kind == 'voucher' ? Icons.receipt_long : Icons.payments_outlined), title: Text(d.title, maxLines: 2, overflow: TextOverflow.ellipsis), subtitle: d.error == null ? Text('Saved ${d.createdAt.toLocal().toString().substring(0, 16)}') : Text('Rejected by server: ${d.error}', style: TextStyle(color: Colors.red.shade700)), trailing: IconButton(icon: const Icon(Icons.delete_outline), tooltip: 'Discard', onPressed: () async { if (await confirm(context, 'Discard draft?', 'This removes it from the device.')) p.discard(d.id); })));
        })),
        Padding(padding: const EdgeInsets.all(12), child: FilledButton.icon(onPressed: p.syncing || p.drafts.isEmpty ? null : p.sync, icon: p.syncing ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.sync), label: const Text('Sync now'))),
      ]),
    );
  }
}

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final s = context.watch<AuthProvider>().session;
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Center(child: CircleAvatar(radius: 36, child: Text((s?.name ?? '?')[0].toUpperCase(), style: const TextStyle(fontSize: 28)))),
        const SizedBox(height: 12),
        Center(child: Text(s?.name ?? '', style: Theme.of(context).textTheme.titleLarge)),
        Center(child: Text(s?.email ?? '', style: const TextStyle(color: Colors.blueGrey))),
        const SizedBox(height: 20),
        Card(child: Column(children: [
          ListTile(leading: const Icon(Icons.business), title: Text(s?.company.name ?? ''), subtitle: Text('Code ${s?.company.code} · ${s?.company.baseCurrency}${s?.company.trn != null ? ' · TRN ${s!.company.trn}' : ''}')),
          ListTile(leading: const Icon(Icons.badge_outlined), title: const Text('Roles'), subtitle: Text(s?.roles.join(', ') ?? '')),
        ])),
        const SizedBox(height: 12),
        OutlinedButton.icon(onPressed: () => _changePassword(context), icon: const Icon(Icons.lock_outline), label: const Text('Change password')),
        const SizedBox(height: 8),
        FilledButton.icon(style: FilledButton.styleFrom(backgroundColor: Colors.red.shade700), onPressed: () async { if (await confirm(context, 'Sign out?', 'Offline drafts stay on this device.')) { if (context.mounted) await context.read<AuthProvider>().logout(); } }, icon: const Icon(Icons.logout), label: const Text('Sign out')),
      ]),
    );
  }

  Future<void> _changePassword(BuildContext context) async {
    final cur = TextEditingController(), next = TextEditingController();
    final ok = await showDialog<bool>(context: context, builder: (_) => AlertDialog(title: const Text('Change password'), content: Column(mainAxisSize: MainAxisSize.min, children: [TextField(controller: cur, obscureText: true, decoration: const InputDecoration(labelText: 'Current password')), const SizedBox(height: 8), TextField(controller: next, obscureText: true, decoration: const InputDecoration(labelText: 'New password', helperText: '10+ chars, upper, lower and a digit'))]), actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')), FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(90, 40)), onPressed: () => Navigator.pop(context, true), child: const Text('Change'))]));
    if (ok != true || !context.mounted) return;
    try {
      await context.read<AuthRepository>().changePassword(cur.text, next.text);
      if (context.mounted) { showSnack(context, 'Password changed - please sign in again'); await context.read<AuthProvider>().logout(); }
    } on ApiException catch (e) {
      if (context.mounted) showSnack(context, e.message, error: true);
    }
  }
}
