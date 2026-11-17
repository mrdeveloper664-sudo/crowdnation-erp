'use client';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PageHeader } from '@/components/ui';
import { ReportViewer } from '@/components/ReportViewer';
import Link from 'next/link';

function Inner() {
  const { name } = useParams<{ name: string }>(); const sp = useSearchParams();
  const initial: Record<string, string> = {}; sp.forEach((v, k) => { initial[k] = v; });
  return <div><PageHeader title={name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} actions={<Link className="text-sm text-brand-700 hover:underline" href="/reports">← All reports</Link>} /><ReportViewer name={name} initial={initial} /></div>;
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
