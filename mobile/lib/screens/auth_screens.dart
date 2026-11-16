import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/providers.dart';
import '../repositories/repositories.dart';
import '../widgets/common.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _code = TextEditingController(), _email = TextEditingController(), _pw = TextEditingController();
  bool _hide = true;

  @override
  void dispose() {
    _code.dispose();
    _email.dispose();
    _pw.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    await context.read<AuthProvider>().login(_code.text, _email.text, _pw.text);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _form,
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Container(width: 40, height: 40, alignment: Alignment.center, decoration: BoxDecoration(color: Theme.of(context).colorScheme.primary, borderRadius: BorderRadius.circular(10)), child: const Text('N', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 20))),
                    const SizedBox(width: 10),
                    Text('NEXERP', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
                  ]),
                  const SizedBox(height: 28),
                  Text('Sign in to your company', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 16),
                  TextFormField(key: const Key('companyCode'), controller: _code, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Company code'), validator: (v) => (v ?? '').trim().length < 3 ? 'Enter your company code' : null),
                  const SizedBox(height: 12),
                  TextFormField(key: const Key('email'), controller: _email, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.username], decoration: const InputDecoration(labelText: 'Email'), validator: (v) => RegExp(r'^\S+@\S+\.\S+$').hasMatch((v ?? '').trim()) ? null : 'Enter a valid email'),
                  const SizedBox(height: 12),
                  TextFormField(key: const Key('password'), controller: _pw, obscureText: _hide, autofillHints: const [AutofillHints.password], decoration: InputDecoration(labelText: 'Password', suffixIcon: IconButton(icon: Icon(_hide ? Icons.visibility : Icons.visibility_off), onPressed: () => setState(() => _hide = !_hide))), validator: (v) => (v ?? '').isEmpty ? 'Enter your password' : null, onFieldSubmitted: (_) => _submit()),
                  if (auth.error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(auth.error!, key: const Key('loginError'), style: TextStyle(color: Colors.red.shade700))),
                  const SizedBox(height: 20),
                  FilledButton(key: const Key('loginButton'), onPressed: auth.busy ? null : _submit, child: auth.busy ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Sign in')),
                  TextButton(onPressed: () => _forgot(context), child: const Text('Forgot password?')),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _forgot(BuildContext context) async {
    final code = TextEditingController(text: _code.text), email = TextEditingController(text: _email.text);
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Reset password'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [TextField(controller: code, decoration: const InputDecoration(labelText: 'Company code')), const SizedBox(height: 8), TextField(controller: email, decoration: const InputDecoration(labelText: 'Email'))]),
        actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')), FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(90, 40)), onPressed: () => Navigator.pop(context, true), child: const Text('Send'))],
      ),
    );
    if (ok == true && context.mounted) {
      try {
        await context.read<AuthRepository>().forgotPassword(code.text, email.text);
        if (context.mounted) showSnack(context, 'If the account exists, a reset email has been sent');
      } catch (e) {
        if (context.mounted) showSnack(context, e.toString(), error: true);
      }
    }
  }
}
