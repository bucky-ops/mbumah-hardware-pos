// MBUMAH HARDWARE POS - /employees/me dashboard (v2.24.0, SERVER-RENDERED)
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
// island (cache-writer.tsx). Interactivity-bearing portal pages (payslips,
// attendance, leave, goals, documents) remain client components.

import Link from 'next/link';
import { LogIn, ShieldOff } from 'lucide-react';
import {
  getSessionFromCookies,
} from '@/lib/auth';
import { hasHrPermission } from '@/lib/hr/permissions';
import { isHrModuleEnabled } from '@/lib/hr/feature-flag';
import {
  resolveSelfEmployee,
  getMyDashboard,
} from '@/lib/hr/self-service';
import { ErrorNote } from '@/components/hr/self-service-ui';
import { HomeView, type HomeDashboardDto } from './home-view';
import { SelfDashboardCacheWriter } from './cache-writer';

export const dynamic = 'force-dynamic';

function PortalNote({
  icon,
  title,
  hint,
  showSignIn = false,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  showSignIn?: boolean;
}) {
  return (
    <div className="rounded-2xl border bg-card p-6 text-center shadow-sm">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      {showSignIn ? (
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <LogIn className="h-3.5 w-3.5" aria-hidden /> Sign in
        </Link>
      ) : null}
    </div>
  );
}

export default async function EmployeeHome() {
  const session = await getSessionFromCookies();
  if (!session) {
    return (
      <PortalNote
        icon={<LogIn className="h-5 w-5" aria-hidden />}
        title="Sign in to open your workspace"
        hint="Your payslips, leave, attendance and goals are private to your account."
        showSignIn
      />
    );
  }

  const enabled = await isHrModuleEnabled(session.organizationId);
  if (!enabled || !hasHrPermission(session.role, 'hr.payroll.read.own')) {
    return (
      <PortalNote
        icon={<ShieldOff className="h-5 w-5" aria-hidden />}
        title="Self-service is not available for your account"
        hint="Ask your manager or HR if you believe this is a mistake."
      />
    );
  }

  const employee = await resolveSelfEmployee(session);
  if (!employee) {
    return (
      <PortalNote
        icon={<ShieldOff className="h-5 w-5" aria-hidden />}
        title="No employee profile is linked to your account"
        hint="Ask HR to link one - then this page shows your payslips, leave and goals."
      />
    );
  }

  let data: HomeDashboardDto;
  try {
    // Same service the API route renders - identical DTO shape (JSON-safe
    // values), so the cache-writer mirror stays compatible.
    data = (await getMyDashboard(employee)) as HomeDashboardDto;
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
