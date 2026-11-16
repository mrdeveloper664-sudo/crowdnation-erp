'use client';
import React, { useState } from 'react';
import { ApiError } from '@/lib/api';
import { Combobox, Option } from './Combobox';
import { Alert, Button, Field, Input, Modal, Select, Textarea } from './ui';

export interface FieldDef {
  name: string; label: string; type?: 'text' | 'email' | 'password' | 'money' | 'number' | 'int' | 'date' | 'select' | 'combo' | 'textarea' | 'checkbox' | 'datetime';
  required?: boolean; options?: Option[]; endpoint?: string; map?: (row: any) => Option; placeholder?: string; hint?: string; span?: 2; showIf?: (v: Record<string, any>) => boolean; defaultValue?: any;
}

const MONEY = /^\d{1,15}(\.\d{1,4})?$/;

export function validate(fields: FieldDef[], v: Record<string, any>) {
  const e: Record<string, string> = {};
  for (const f of fields) {
    if (f.showIf && !f.showIf(v)) continue;
    const val = v[f.name];
    if (f.required && (val === undefined || val === '' || val === null)) { e[f.name] = 'Required'; continue; }
    if (val === undefined || val === '') continue;
    if (f.type === 'money' && !MONEY.test(String(val))) e[f.name] = 'Enter an amount like 1250.50';
    if (f.type === 'email' && !/^\S+@\S+\.\S+$/.test(String(val))) e[f.name] = 'Enter a valid email';
    if (f.type === 'int' && !/^\d+$/.test(String(val))) e[f.name] = 'Whole number';
  }
  return e;
}

export function clean(fields: FieldDef[], v: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const f of fields) {
    if (f.showIf && !f.showIf(v)) continue;
    const val = v[f.name];
    if (val === undefined || val === '' || val === null) continue;
    out[f.name] = f.type === 'int' ? Number(val) : f.type === 'datetime' ? new Date(val).toISOString() : val;
  }
  return out;
}

export function FormFields({ fields, values, setValues, errors }: { fields: FieldDef[]; values: Record<string, any>; setValues: (v: Record<string, any>) => void; errors: Record<string, string> }) {
  const set = (name: string, val: any) => setValues({ ...values, [name]: val });
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.filter((f) => !f.showIf || f.showIf(values)).map((f) => {
        const v = values[f.name] ?? '';
        let input: React.ReactNode;
        if (f.type === 'select') input = <Select value={v} onChange={(e) => set(f.name, e.target.value)}><option value="">{f.placeholder ?? 'Select…'}</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>;
        else if (f.type === 'combo') input = <Combobox value={v} endpoint={f.endpoint} options={f.options} map={f.map} onChange={(x) => set(f.name, x)} placeholder={f.placeholder} />;
        else if (f.type === 'textarea') input = <Textarea value={v} onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} />;
        else if (f.type === 'checkbox') input = <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} />;
        else input = <Input type={f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : f.type === 'password' ? 'password' : f.type === 'email' ? 'email' : 'text'} inputMode={f.type === 'money' || f.type === 'number' ? 'decimal' : undefined} value={v} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />;
        return <div key={f.name} className={f.span === 2 || f.type === 'textarea' ? 'sm:col-span-2' : ''}><Field label={f.label} error={errors[f.name]} hint={f.hint} required={f.required}>{input}</Field></div>;
      })}
    </div>
  );
}

export function FormModal({ open, onClose, title, fields, initial, onSubmit, submitLabel = 'Save', wide }: {
  open: boolean; onClose: () => void; title: string; fields: FieldDef[]; initial?: Record<string, any>; onSubmit: (values: Record<string, any>) => Promise<unknown>; submitLabel?: string; wide?: boolean;
}) {
  const defaults = () => ({ ...Object.fromEntries(fields.filter((f) => f.defaultValue !== undefined).map((f) => [f.name, f.defaultValue])), ...initial });
  const [values, setValues] = useState<Record<string, any>>(defaults);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState('');
  const [busy, setBusy] = useState(false);
  React.useEffect(() => { if (open) { setValues(defaults()); setErrors({}); setApiError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const errs = validate(fields, values); setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setApiError('');
    try { await onSubmit(clean(fields, values)); onClose(); }
    catch (err) { setApiError(err instanceof ApiError ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} wide={wide} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => submit()} disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button></>}>
      <form onSubmit={submit} className="space-y-4">
        {apiError && <Alert>{apiError}</Alert>}
        <FormFields fields={fields} values={values} setValues={setValues} errors={errors} />
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
