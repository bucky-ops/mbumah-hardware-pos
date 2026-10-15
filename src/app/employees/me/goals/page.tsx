'use client';

// MBUMAH HARDWARE POS - /employees/me/goals (v2.19.0)
// Own goals with live progress (POS-sourced goals are computed from real
// sales — the value is never typed) and the employee's own performance
// reviews, including the self-acknowledge action for SUBMITTED reviews.

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BadgeCheck, Target, TrendingUp } from 'lucide-react';
import { apiGet, apiSend, EmptyState, ErrorNote, ProgressMeter, StatusBadge, formatDate } from '@/components/hr/self-service-ui';

interface GoalDto {
  id: string;
  title: string;
  metricSource: string;
  status: string;
  targetValue: string;
  currentValue: string;
  progressPct: number;
  dueDate: string | null;
  isPosSourced: boolean;
}
interface ReviewDto {
  id: string;
  cycleName: string;
  status: string;
  acknowledgedAt: string | null;
  createdAt: string;
}

export default function MyGoals() {
  const [goals, setGoals] = useState<GoalDto[] | null>(null);
  const [reviews, setReviews] = useState<ReviewDto[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [g, r] = await Promise.all([
        apiGet<GoalDto[]>('/api/self-service/me/goals'),
        apiGet<ReviewDto[]>('/api/self-service/me/reviews'),
      ]);
      setGoals(g);
      setReviews(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load goals.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const acknowledge = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await apiSend(`/api/self-service/me/reviews/${id}/acknowledge`, 'POST');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not acknowledge.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Target className="h-5 w-5 text-violet-500" aria-hidden /> My goals &amp; reviews
        </h1>
        <p className="text-sm text-muted-foreground">
          Sales goals update straight from the till — nothing for you to type. Acknowledge reviews your manager submits.
        </p>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      {/* Goals */}
      {!goals ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      ) : goals.length === 0 ? (
        <EmptyState icon={<Target className="h-8 w-8" aria-hidden />} title="No goals yet" hint="Goals your manager assigns will show progress here." />
      ) : (
        <section aria-label="My goals" className="space-y-3">
          {goals.map((g) => (
            <div key={g.id} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{g.title}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    {g.isPosSourced ? (
                      <>
                        <TrendingUp className="h-3 w-3 text-emerald-500" aria-hidden /> Computed from POS sales — not editable
                      </>
                    ) : (
                      'Manual goal'
                    )}
                    {g.dueDate ? ` · due ${formatDate(g.dueDate)}` : ''}
                  </p>
                </div>
                <StatusBadge status={g.status} />
              </div>
              <ProgressMeter pct={g.progressPct} tone={g.status === 'ACHIEVED' ? 'good' : g.status === 'MISSED' ? 'bad' : 'info'} />
              <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                <span>
                  <strong className="text-foreground">{Number(g.currentValue).toLocaleString()}</strong> of{' '}
                  {Number(g.targetValue).toLocaleString()} ({g.progressPct}%)
                </span>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Reviews */}
      <section aria-label="My reviews" className="space-y-2">
        <h2 className="px-1 text-sm font-semibold">My reviews</h2>
        {!reviews ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : reviews.length === 0 ? (
          <EmptyState icon={<BadgeCheck className="h-8 w-8" aria-hidden />} title="No reviews yet" hint="When a manager submits your review it appears here to acknowledge." />
        ) : (
          <ul className="space-y-2">
            {reviews.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-3.5 py-3 shadow-sm">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.cycleName}</p>
                  <p className="text-xs text-muted-foreground">
                    Submitted {formatDate(r.createdAt)}
                    {r.acknowledgedAt ? ` · acknowledged ${formatDate(r.acknowledgedAt)}` : ''}
                  </p>
                </div>
                {r.status === 'SUBMITTED' ? (
                  <Button size="sm" disabled={busy} onClick={() => void acknowledge(r.id)}>
                    <BadgeCheck className="h-4 w-4" aria-hidden /> Acknowledge
                  </Button>
                ) : (
                  <StatusBadge status={r.status} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
