// Server-rendered view for the self-service home (v2.24.0).
//
// Pure presentational - no hooks, no client APIs - so the dashboard HTML
// streams straight from the RSC render and the LCP paints with real content
// (previously: skeleton -> hydrate -> fetch -> re-render gated the LCP
// behind ~2 extra seconds on the Lighthouse mobile CPU).
//
// Timezone note: attendance clock-in/out render with an EXPLICIT
// Africa/Nairobi timezone. The old client version formatted with the
// viewer's local zone, which silently drifted for anyone whose device
// wasn't on Kenyan time; the product is Kenya-only, so pinning the zone is
// both a fix and a consistency guarantee between server and client renders.

import Link from 'next/link';
import { ArrowRight, CalendarClock, Palmtree, Wallet, Target, UserRound, BadgeCheck } from 'lucide-react';
import { EmptyState, ProgressMeter, StatusBadge } from '@/components/hr/self-service-ui';
// v2.24.0: formatters come from the DIRECTIVE-FREE module - a server
// component may not call functions exported from a 'use client' module.
import { formatKes, formatDate } from '@/components/hr/self-service-format';

// v2.49.0: the employee-facing "your payslip is issued" notice strip.
export interface PayslipNoticeItem {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  actionUrl: string | null;
  actionLabel: string | null;
}

export interface HomeDashboardDto {
  profile: {
    firstName: string;
    lastName: string;
    employeeCode: string | null;
    jobTitle: string | null;
    employmentType: string;
    status: string;
    hireDate: string;
    monthsOfService: number;
  };
  payslips: Array<{ id: string; periodLabel: string; netPay: string; grossPay: string; totalDeductions: string; payslipNumber: string | null; runStatus: string; issuedAt: string }>;
  leave: {
    balances: Array<{ leaveTypeId: string; name: string; code: string; allocatedDays: string; usedDays: string; pendingDays: string; carryForwardDays: string; availableDays: string }>;
    pendingLeaveCount: number;
  };
  attendanceToday: { date: string; status: string; checkIn: string | null; checkOut: string | null; workingHours: string; lateMinutes: number } | null;
  goals: Array<{ id: string; title: string; metricSource: string; status: string; targetValue: string; currentValue: string; progressPct: number; dueDate: string | null }>;
}

const EAT = 'Africa/Nairobi';

function eatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-KE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: EAT,
  });
}

export function HomeView({ data, payslipNotices = [] }: { data: HomeDashboardDto; payslipNotices?: PayslipNoticeItem[] }) {
  const { profile } = data;
  const initials = `${profile.firstName?.[0] ?? ''}${profile.lastName?.[0] ?? ''}`.toUpperCase();
  const primaryLeave = data.leave.balances[0];
  const latestPayslip = data.payslips[0];

  return (
    <div className="space-y-4" data-testid="selfservice-home">
      {/* v2.49.0: "your payslip is issued" notice strip — the personal
          good news renders FIRST, above the stat tiles, in the same teal
          family the bell row and the email use. Up to 3 latest notices;
          the newest carries the badge, the rest stay quiet rows. */}
      {payslipNotices.length > 0 ? (
        <section
          aria-label="Payslip notices"
          className="overflow-hidden rounded-2xl bg-gradient-to-br from-teal-400 via-teal-500 to-emerald-500 p-[1px] shadow-sm"
          data-testid="payslip-notices"
        >
          <div className="rounded-2xl bg-card p-4 sm:p-5">
            <div className="space-y-3">
              {payslipNotices.map((notice, i) => (
                <div key={notice.id} className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ring-inset ring-black/5 dark:ring-white/10 ${
                      i === 0
                        ? 'bg-gradient-to-br from-teal-500/15 to-emerald-500/15 text-teal-600 dark:text-teal-400'
                        : 'bg-muted text-muted-foreground'
                    }`}
                    aria-hidden
                  >
                    {i === 0 ? <BadgeCheck className="h-5 w-5" /> : <Wallet className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-semibold tracking-tight">{notice.title}</p>
                      {i === 0 ? (
                        <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300">
                          New
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{notice.message}</p>
                  </div>
                  {notice.actionUrl ? (
                    <Link
                      href={notice.actionUrl}
                      className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-teal-600 px-2.5 py-1 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-teal-700"
                    >
                      {notice.actionLabel ?? 'View'}
                      <ArrowRight className="h-3 w-3" aria-hidden />
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Profile hero */}
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 via-orange-400 to-rose-400 p-[1px] shadow-sm">
        <div className="rounded-2xl bg-card p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-base font-bold text-white shadow-inner">
              {initials || <UserRound className="h-6 w-6" aria-hidden />}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">{profile.firstName} {profile.lastName}</h1>
              <p className="truncate text-sm text-muted-foreground">
                {profile.jobTitle ?? 'Team member'} · {profile.employmentType.toLowerCase()}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {profile.employeeCode ?? 'No staff number'} · {profile.monthsOfService} mo at Mbumah
              </p>
            </div>
            <div className="ml-auto hidden sm:block">
              <StatusBadge status={profile.status} />
            </div>
          </div>
        </div>
      </section>

      {/* Stat tiles */}
      <section className="grid grid-cols-2 gap-3" aria-label="Quick summary">
        <Link href="/employees/me/payslips" className="group">
          <div className="h-full rounded-2xl border bg-card p-4 shadow-sm transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                <Wallet className="h-4 w-4" aria-hidden />
              </span>
              Latest payslip
            </div>
            <p className="text-xl font-bold tracking-tight">{latestPayslip ? formatKes(latestPayslip.netPay) : '—'}</p>
            <p className="text-xs text-muted-foreground">{latestPayslip ? latestPayslip.periodLabel : 'No payslips yet'}</p>
          </div>
        </Link>
        <Link href="/employees/me/leave" className="group">
          <div className="h-full rounded-2xl border bg-card p-4 shadow-sm transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
                <Palmtree className="h-4 w-4" aria-hidden />
              </span>
              Leave available
            </div>
            <p className="text-xl font-bold tracking-tight">
              {primaryLeave ? `${Number(primaryLeave.availableDays).toLocaleString()} d` : '—'}
            </p>
            <p className="text-xs text-muted-foreground">
              {data.leave.pendingLeaveCount > 0
                ? `${data.leave.pendingLeaveCount} request${data.leave.pendingLeaveCount > 1 ? 's' : ''} pending`
                : primaryLeave?.name ?? 'No balances yet'}
            </p>
          </div>
        </Link>
      </section>

      {/* Today's attendance */}
      <section className="rounded-2xl border bg-card p-4 shadow-sm" aria-label="Today's attendance">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-sky-500" aria-hidden /> Today
          </h2>
          {data.attendanceToday ? <StatusBadge status={data.attendanceToday.status} /> : null}
        </div>
        {data.attendanceToday ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-muted/60 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">In</p>
              <p className="text-sm font-semibold">
                {data.attendanceToday.checkIn ? eatTime(data.attendanceToday.checkIn) : '—'}
              </p>
            </div>
            <div className="rounded-xl bg-muted/60 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Out</p>
              <p className="text-sm font-semibold">
                {data.attendanceToday.checkOut ? eatTime(data.attendanceToday.checkOut) : '—'}
              </p>
            </div>
            <div className="rounded-xl bg-muted/60 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Hours</p>
              <p className="text-sm font-semibold">{Number(data.attendanceToday.workingHours).toFixed(1)}</p>
            </div>
          </div>
        ) : (
          <p className="py-2 text-center text-sm text-muted-foreground">No attendance recorded today yet.</p>
        )}
      </section>

      {/* Goals preview */}
      <section aria-label="My goals" className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Target className="h-4 w-4 text-violet-500" aria-hidden /> My goals
          </h2>
          <Link href="/employees/me/goals" className="flex items-center gap-1 text-xs font-medium text-sky-600 hover:underline dark:text-sky-400">
            All goals <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
        {data.goals.length === 0 ? (
          <EmptyState icon={<Target className="h-8 w-8" aria-hidden />} title="No goals yet" hint="Your manager will set goals for you here." />
        ) : (
          data.goals.slice(0, 3).map((g) => (
            <div key={g.id} className="rounded-2xl border bg-card p-3.5 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium">{g.title}</p>
                <StatusBadge status={g.status} />
              </div>
              <ProgressMeter pct={g.progressPct} label={`Progress on ${g.title}`} tone={g.status === 'ACHIEVED' ? 'good' : g.status === 'MISSED' ? 'bad' : 'info'} />
              <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
                <span>{Number(g.currentValue).toLocaleString()} / {Number(g.targetValue).toLocaleString()}</span>
                <span>due {formatDate(g.dueDate)}</span>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
