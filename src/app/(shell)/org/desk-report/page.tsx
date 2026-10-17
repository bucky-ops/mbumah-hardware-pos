// /org/desk-report (v2.69.0) — the desk files its report: the printable
// per-branch roll-up of the leave review ledger, off the same read family
// as the Desk activity panel (v2.64.0) and the morning note (v2.67.0/
// v2.68.0). Org-role gated server-side by /api/org/desk-report.

import type { Metadata } from 'next';
import { DeskReportView } from '@/components/org/desk-report-view';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Desk Report | Mbumah Hardware POS',
};

export default function DeskReportPage() {
  return <DeskReportView />;
}
