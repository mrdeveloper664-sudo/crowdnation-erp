import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class LocalDraft {
  LocalDraft({required this.id, required this.kind, required this.title, required this.payload, required this.createdAt, this.error});
  final String id, kind, title; // kind: voucher | expense
  final Map<String, dynamic> payload;
  final DateTime createdAt;
  final String? error;

  LocalDraft withError(String? e) => LocalDraft(id: id, kind: kind, title: title, payload: payload, createdAt: createdAt, error: e);
  Map<String, dynamic> toJson() => {'id': id, 'kind': kind, 'title': title, 'payload': payload, 'createdAt': createdAt.toIso8601String(), 'error': error};
  factory LocalDraft.fromJson(Map<String, dynamic> j) => LocalDraft(id: j['id'], kind: j['kind'], title: j['title'], payload: (j['payload'] as Map).cast(), createdAt: DateTime.parse(j['createdAt']), error: j['error']);
}

/// Offline-friendly drafts. A draft is NEVER posted from here: syncing only creates a DRAFT on the
/// server, where it is validated (balance, periods, accounts). Posting stays an explicit online action.
class DraftStore {
  static const _key = 'nexerp_local_drafts_v1';

  Future<List<LocalDraft>> all() async {
    final p = await SharedPreferences.getInstance();
    final raw = p.getString(_key);
    if (raw == null) return [];
    return (jsonDecode(raw) as List).map((e) => LocalDraft.fromJson((e as Map).cast())).toList();
  }

  Future<void> _save(List<LocalDraft> l) async => (await SharedPreferences.getInstance()).setString(_key, jsonEncode(l.map((d) => d.toJson()).toList()));

  Future<void> add(LocalDraft d) async => _save([...await all(), d]);
  Future<void> remove(String id) async => _save((await all()).where((d) => d.id != id).toList());
  Future<void> update(LocalDraft d) async => _save((await all()).map((x) => x.id == d.id ? d : x).toList());
}
