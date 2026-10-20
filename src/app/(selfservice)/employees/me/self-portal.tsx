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
import { Clock, LogIn, ShieldOff } from 'lucide-react';
import {
  getSessionFromCookies,
  type AuthSession,
} from '@/lib/auth';
import { db } from '@/lib/db';
import {
  buildPortalReturnHref,
  idleExpired,
  SELF_SERVICE_IDLE_MS,
} from '@/lib/session-idle';
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
  returnPath,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  showSignIn?: boolean;
  /** v2.163.0: where the colleague was reading - carried to the login
   *  screen as ?next= so sign-in lands back on this page (validated by
   *  safeReturnPath; absent falls back to the plain login root). */
  returnPath?: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-6 text-center shadow-sm">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      {showSignIn ? (
        <>
          <Link
            href={buildPortalReturnHref(returnPath)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <LogIn className="h-3.5 w-3.5" aria-hidden /> Sign in
          </Link>
          {returnPath ? (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Signing in brings you straight back to this page.
            </p>
          ) : null}
        </>
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
export async function loadSelfPortal(
  permission: HrPermissionKey,
  // v2.163.0: the page's own path, carried into the note's sign-in link as
  // ?next= so the door swings back to where the colleague was reading.
  portalPath?: string,
): Promise<SelfPortalGuard> {
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
          returnPath={portalPath}
        />
      ),
    };
  }

  // v2.162.0 THE THIRTY-MINUTE CONTRACT — the SSR half. The same
  // server-side idle window the API guard enforces, checked on every portal
  // page render: an unattended portal (re-opened after a long pause, tab
  // never closed) renders the honest "signed out for your safety" note
  // instead of employee data. The session row is deleted so the cookie
  // cannot be replayed; fresh sessions slide lastActiveAt forward so a
  // colleague reading page after page is never interrupted mid-use.
  if (
    session.lastActiveAt &&
    idleExpired(session.lastActiveAt, new Date(), SELF_SERVICE_IDLE_MS)
  ) {
    if (session.sessionId) {
      await db.session
        .delete({ where: { id: session.sessionId } })
        .catch(() => {});
    }
    return {
      ok: false,
      note: (
        <PortalNote
          icon={<Clock className="h-5 w-5" aria-hidden />}
          title="Signed out for your safety"
          hint="This portal closes after 30 minutes of inactivity - your payslips, leave and goals stay private. Sign in again to continue."
          showSignIn
          returnPath={portalPath}
        />
      ),
    };
  }
  if (session.sessionId) {
    await db.session
      .update({
        where: { id: session.sessionId },
        data: { lastActiveAt: new Date() },
      })
      .catch(() => {});
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
  /** Tailwind classes for the icon tile background, e.g. 'from-emerald-500/15 to-sky-500/15 text-emerald-700 dark:text-emerald-400'. */
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
