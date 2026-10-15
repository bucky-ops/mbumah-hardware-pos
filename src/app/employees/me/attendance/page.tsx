'use client';

// MBUMAH HARDWARE POS - /employees/me/attendance (v2.19.0)
// Own attendance records with month summary tiles (present / late / absent /
// leave) and total hours worked.

import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { CalendarClock, CheckCircle2, Timer, XCircle } from 'lucide-react';
import { apiGet, EmptyState, ErrorNote, StatusBadge } from '@/components/hr/self-service-ui';

interface AttendanceRecordDto {
  id: string;
  date: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  workingHours: string;
  overtimeHours: string;
  lateMinutes: number;
}
interface AttendanceDto {
  records: AttendanceRecordDto[];
  summary: { month: Record<string, number>; monthHours: string; monthOvertime: string };
}

function timeOrDash(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
}

export default function MyAttendance() {
  const [data, setData] = useState<AttendanceDto | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const d = await apiGet<AttendanceDto>('/api/self-service/me/attendance?limit=60');
        if (active) setData(d);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Could not load attendance.');
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, []);

  const summary = data?.summary;
  const presentCount = (summary?.month.PRESENT ?? 0) + (summary?.month.REMOTE ?? 0);
  const lateCount = summary?.month.LATE ?? 0;
  const absentCount = summary?.month.ABSENT ?? 0;
  const leaveCount = summary?.month.LEAVE ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <CalendarClock className="h-5 w-5 text-sky-500" aria-hidden /> My attendance
        </h1>
        <p className="text-sm text-muted-foreground">Your punches and hours for recent days.</p>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      {/* Month summary */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="This month summary">
        {[
          { label: 'Present', value: presentCount, icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300' },
          { label: 'Late', value: lateCount, icon: Timer, tone: 'text-amber-600 bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300' },
          { label: 'Absent', value: absentCount, icon: XCircle, tone: 'text-rose-600 bg-rose-100 dark:bg-rose-950/60 dark:text-rose-300' },
          { label: 'On leave', value: leaveCount, icon: CalendarClock, tone: 'text-sky-600 bg-sky-100 dark:bg-sky-950/60 dark:text-sky-300' },
        ].map((tile) => (
          <div key={tile.label} className="rounded-2xl border bg-card p-3.5 shadow-sm">
            <span className={`mb-2 inline-flex h-7 w-7 items-center justify-center rounded-lg ${tile.tone}`}>
              <tile.icon className="h-4 w-4" aria-hidden />
            </span>
            <p className="text-xl font-bold tracking-tight">{tile.value}</p>
            <p className="text-xs text-muted-foreground">{tile.label} days</p>
          </div>
        ))}
      </section>

      {summary ? (
        <p className="rounded-xl border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
          This month: <strong className="text-foreground">{Number(summary.monthHours).toFixed(1)}h</strong> worked ·{' '}
          <strong className="text-foreground">{Number(summary.monthOvertime).toFixed(1)}h</strong> overtime.
        </p>
      ) : null}

      {!data ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      ) : data.records.length === 0 ? (
        <EmptyState icon={<CalendarClock className="h-8 w-8" aria-hidden />} title="No attendance yet" hint="Records appear after your first clock-in." />
      ) : (
        <ul className="space-y-2" aria-label="Attendance records">
          {data.records.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-xl border bg-card px-3.5 py-3 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-muted/70 text-[10px] leading-tight">
                <span className="font-bold">{new Date(r.date).getDate()}</span>
                <span className="uppercase text-muted-foreground">
                  {new Date(r.date).toLocaleDateString('en-KE', { month: 'short' })}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  {r.lateMinutes > 0 ? (
                    <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">{r.lateMinutes} min late</span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {timeOrDash(r.checkIn)} → {timeOrDash(r.checkOut)} · {Number(r.workingHours).toFixed(1)}h
                  {Number(r.overtimeHours) > 0 ? ` (+${Number(r.overtimeHours).toFixed(1)}h OT)` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
