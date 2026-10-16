// MBUMAH HARDWARE POS - shared self-service portal guard (v2.28.0)
//
// SERVER module - every /employees/me/* page runs the same three-step guard
// before it may touch employee data:
//   1. signed in?
//   2. HR module enabled for the org AND the page's permission granted?
//   3. an employee profile is linked to the account?
//
// v2.28.0 extracts this from the (previously duplicated inline) home page
// so the SSR rollout across payslips / attendance / leave / goals /
// documents shares ONE implementation - the guard contract cannot drift
// between pages (it already had subtly drifted: the home page rendered a
// "sign in" affordance, the client pages rendered bare error notes).

import Link from 'next/link';
import { LogIn, ShieldOff } from 'lucide-react';
import {
  getSessionFromCookies,
  type AuthSession,
} from '@/lib/auth';
import { hasHrPermission, type HrPermissionKey } from '@/lib/hr/permissions';
import { isHrModuleEnabled } from '@/lib/hr/feature-flag';
import { ChangePasswordScreen } from '@/components/change-password-screen';
import {
  resolveSelfEmployee,
  type SelfEmployee,
} from '@/lib/hr/self-service';

export function PortalNote({
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

export type SelfPortalGuard =
  | { ok: false; note: React.ReactNode }
  | { ok: true; session: AuthSession; employee: SelfEmployee };

/**
 * Resolve the signed-in employee for a self-service page, or produce the
 * portal note that must be rendered instead of page content. `permission`
 * is the page's read permission (e.g. 'hr.payroll.read.own') - it is checked
 * against the session role exactly like selfServiceGuard does for the API
 * routes, so the page and its API agree on access.
 */
export async function loadSelfPortal(permission: HrPermissionKey): Promise<SelfPortalGuard> {
  const session = await getSessionFromCookies();
  if (!session) {
    return {
      ok: false,
      note: (
        <PortalNote
          icon={<LogIn className="h-5 w-5" aria-hidden />}
          title="Sign in to open your workspace"
          hint="Your payslips, leave, attendance and goals are private to your account."
          showSignIn
        />
      ),
    };
  }

  // v2.44.0: first sign-in password rotation — a temporary-password session
  // gets the forced "Set a new password" screen INSTEAD of every portal
  // page (server-rendered; the client API gate enforces the same rule on
  // every /api route, so there is nothing to browse past this).
  if (session.mustChangePassword) {
    return { ok: false, note: <ChangePasswordScreen /> };
  }

  const enabled = await isHrModuleEnabled(session.organizationId);
  if (!enabled || !hasHrPermission(session.role, permission)) {
    return {
      ok: false,
      note: (
        <PortalNote
          icon={<ShieldOff className="h-5 w-5" aria-hidden />}
          title="Self-service is not available for your account"
          hint="Ask your manager or HR if you believe this is a mistake."
        />
      ),
    };
  }

  const employee = await resolveSelfEmployee(session);
  if (!employee) {
    return {
      ok: false,
      note: (
        <PortalNote
          icon={<ShieldOff className="h-5 w-5" aria-hidden />}
          title="No employee profile is linked to your account"
          hint="Ask HR to link one - then this page shows your payslips, leave and goals."
        />
      ),
    };
  }

  return { ok: true, session, employee };
}

/**
 * Shared page header for the self-service portal (v2.28.0 styling pass).
 * A gradient icon tile, the page title and the supporting line - one
 * component so the five portal pages finally share the same visual rhythm
 * (they previously each hand-rolled a slightly different header).
 */
export function SelfPageHeader({
  icon,
  tone,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  /** Tailwind classes for the icon tile background, e.g. 'from-emerald-500/15 to-sky-500/15 text-emerald-600 dark:text-emerald-400'. */
  tone: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm ring-1 ring-inset ring-black/5 dark:ring-white/10 ${tone}`}
          aria-hidden
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {action ? <div className="shrink-0 pt-1">{action}</div> : null}
    </div>
  );
}
