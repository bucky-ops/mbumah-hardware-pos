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

export const dynamic = 'force-dynamic';

export default async function EmployeeHome() {
  const guard = await loadSelfPortal('hr.payroll.read.own');
  if (!guard.ok) return guard.note;

  let data: HomeDashboardDto;
  try {
    // Same service the API route renders - identical DTO shape (JSON-safe
    // values), so the cache-writer mirror stays compatible.
    data = (await getMyDashboard(guard.employee)) as HomeDashboardDto;
  } catch {
    return <ErrorNote message="Could not load your dashboard. Try again in a moment." />;
  }

  return (
    <>
      <SelfDashboardCacheWriter data={data} />
      <HomeView data={data} />
    </>
  );
}
