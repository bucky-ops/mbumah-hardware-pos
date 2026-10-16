'use client';

// MBUMAH HARDWARE POS - /employees/me dashboard (v2.19.0)
// Mobile-first self-service home: profile, payslip peek, leave balances,
// today's attendance, and goal progress. Caches the last payload to
// localStorage so the page still renders when the device is offline.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight, CalendarClock, Palmtree, WifiOff, Wallet, Target, UserRound } from 'lucide-react';
import { apiGet, EmptyState, ErrorNote, ProgressMeter, StatusBadge, formatKes, formatDate } from '@/components/hr/self-service-ui';

interface DashboardDto {
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

const CACHE_KEY = 'mbt_self_dashboard_cache_v1';

function readCache(): DashboardDto | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: DashboardDto };
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export default function EmployeeHome() {
  const [data, setData] = useState<DashboardDto | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<DashboardDto>('/api/self-service/me');
      setData(d);
      setOffline(false);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: d }));
      } catch {
        /* storage full / private mode - ignore */
      }
    } catch (e) {
      const cached = readCache();
      if (cached) {
        setData(cached);
        setOffline(true);
      } else {
        setError(e instanceof Error ? e.message : 'Could not load your dashboard.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Hydration-safe cache hydration: apply the cached dashboard post-paint
    // so the first client render matches the server HTML.
    const cached = readCache();
    if (cached) {
      setData(cached);
      setLoading(false);
    }
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (!data) {
    return <ErrorNote message={error || 'No dashboard data available.'} />;
  }

  const { profile } = data;
  const initials = `${profile.firstName?.[0] ?? ''}${profile.lastName?.[0] ?? ''}`.toUpperCase();
  const primaryLeave = data.leave.balances[0];
  const latestPayslip = data.payslips[0];

  return (
    <div className="space-y-4">
      {offline ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
          <WifiOff className="h-4 w-4" aria-hidden /> Offline — showing your last synced dashboard.
        </div>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}

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
                {data.attendanceToday.checkIn ? new Date(data.attendanceToday.checkIn).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '—'}
              </p>
            </div>
            <div className="rounded-xl bg-muted/60 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Out</p>
              <p className="text-sm font-semibold">
                {data.attendanceToday.checkOut ? new Date(data.attendanceToday.checkOut).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) : '—'}
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
