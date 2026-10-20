// MBUMAH HARDWARE POS - /employees/me dashboard (v2.28.0, SERVER-RENDERED)
// Mobile-first self-service home: profile, payslip peek, leave balances,
// today's attendance, and goal progress.
//
// v2.24.0 LCP REMEDIATION (docs/hr/self-service.md): the page used to be a
// client component that rendered skeletons, hydrated, fetched
// /api/self-service/me and re-rendered - the LCP waited on the whole serial
// chain (~3.9 s on the Lighthouse mobile CPU). It is now a server component:
// the session resolves via cookies(), the SAME getMyDashboard service the
// API route uses assembles the payload, and the HTML streams with real
// content (LCP ≈ FCP). The API route stays for client refreshes and other
// consumers; the offline localStorage mirror is kept by a tiny client
// island (cache-writer.tsx).
//
// v2.28.0: the inline guard/note block moved to the shared self-portal
// module (loadSelfPortal) - the SSR rollout across payslips / attendance /
// leave / goals / documents now shares ONE guard implementation.

import { getMyDashboard } from '@/lib/hr/self-service';
import { ErrorNote } from '@/components/hr/self-service-ui';
import { HomeView, type HomeDashboardDto } from './home-view';
import { SelfDashboardCacheWriter } from './cache-writer';
import { loadSelfPortal } from './self-portal';
import { db, runWithoutTenant } from '@/lib/db';
import { PAYSLIP_ISSUED_METADATA_MARKER, PAYROLL_PAID_METADATA_MARKER } from '@/lib/hr/payroll/run-digest';

export const dynamic = 'force-dynamic';

/** v2.49.0: the employee-facing "your payslip is issued" notice strip.
 *  v2.51.0: the strip now carries BOTH personal pay moments — 'issued'
 *  (teal, the payslip exists) and 'paid' (emerald, the money settled with
 *  the employee's own receipt in hand) — merged newest-first. */
export interface PayslipNoticeDto {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  actionUrl: string | null;
  actionLabel: string | null;
  /** 'issued' = payslip exists (v2.49.0) · 'paid' = money settled (v2.51.0). */
  kind: 'issued' | 'paid';
}

async function loadPayslipNotices(userId: string): Promise<PayslipNoticeDto[]> {
  try {
    // runWithoutTenant: the SAME cross-tenant read posture the feed API uses
    // for these rows (notification is store-scoped, but the portal strip is
    // scoped by userId — the session user only ever sees their own rows;
    // the feed API reads them the same way).
    const rows = await runWithoutTenant(() =>
      db.notification.findMany({
        where: {
          userId,
          category: 'HR',
          OR: [
            { metadata: { contains: PAYSLIP_ISSUED_METADATA_MARKER } },
            // v2.51.0: the personal "you've been paid" rows ride the same
            // strip — the two moments of one pay story, newest first.
            { metadata: { contains: PAYROLL_PAID_METADATA_MARKER } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
      actionUrl: r.actionUrl,
      actionLabel: r.actionLabel,
      kind: (r.metadata ?? '').includes(PAYROLL_PAID_METADATA_MARKER) ? ('paid' as const) : ('issued' as const),
    }));
  } catch {
    // The notice strip is best-effort garnish — the dashboard must render
    // even if this read ever hiccups.
    return [];
  }
}

export default async function EmployeeHome() {
  const guard = await loadSelfPortal('hr.payroll.read.own', '/employees/me');
  if (!guard.ok) return guard.note;

  let data: HomeDashboardDto;
  try {
    // Same service the API route renders - identical DTO shape (JSON-safe
    // values), so the cache-writer mirror stays compatible.
    data = (await getMyDashboard(guard.employee)) as HomeDashboardDto;
  } catch {
    return <ErrorNote message="Could not load your dashboard. Try again in a moment." />;
  }

  // v2.49.0: the latest personal payslip notices ride the dashboard render
  // (SSR — no extra client fetch, the strip paints with the page).
  const payslipNotices = await loadPayslipNotices(guard.session.userId);

  return (
    <>
      <SelfDashboardCacheWriter data={data} />
      <HomeView data={data} payslipNotices={payslipNotices} />
    </>
  );
}
