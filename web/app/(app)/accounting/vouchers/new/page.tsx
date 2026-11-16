'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PageHeader } from '@/components/ui';
import { VoucherEditor } from '@/modules/VoucherEditor';

function Inner() {
  const router = useRouter(); const sp = useSearchParams();
  return <div><PageHeader title="New voucher" subtitle="Posted vouchers cannot be edited — corrections use reversal and replacement." /><VoucherEditor defaultType={sp.get('type') ?? undefined} onSaved={(id) => router.push(`/accounting/vouchers/${id}`)} /></div>;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
