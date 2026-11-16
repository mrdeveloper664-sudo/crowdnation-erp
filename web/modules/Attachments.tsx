'use client';
import { useRef, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { ApiError, api } from '@/lib/api';
import { Alert, Button, Card } from '@/components/ui';

export function Attachments({ entityType, entityId, canEdit = true }: { entityType: string; entityId: string; canEdit?: boolean }) {
  const { data, reload } = useApi<any[]>(`/attachments?entityType=${entityType}&entityId=${entityId}`);
  const input = useRef<HTMLInputElement>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    setErr(''); setBusy(true);
    if (file.size > 10 * 1024 * 1024) { setErr('File exceeds 10 MB'); setBusy(false); return; }
    const fd = new FormData(); fd.append('file', file);
    try { await api.upload(`/attachments?entityType=${entityType}&entityId=${entityId}`, fd); reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return (
    <Card title="Attachments" actions={canEdit && <><input ref={input} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx,.csv,.txt" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /><Button size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : 'Upload file'}</Button></>}>
      {err && <Alert>{err}</Alert>}
      <ul className="divide-y divide-slate-100 text-sm">
        {data?.map((a) => <li key={a.id} className="flex items-center justify-between py-2"><a className="text-brand-700 hover:underline" href={`/api/v1/attachments/${a.id}/download`}>{a.fileName}</a><span className="flex items-center gap-3 text-xs text-slate-400">{(a.sizeBytes / 1024).toFixed(0)} KB{canEdit && <button className="text-red-600 hover:underline" onClick={async () => { await api.del(`/attachments/${a.id}`); reload(); }}>Remove</button>}</span></li>)}
        {data?.length === 0 && <li className="py-3 text-slate-400">No attachments. PDF, images, Excel, Word, CSV up to 10 MB.</li>}
      </ul>
    </Card>
  );
}
