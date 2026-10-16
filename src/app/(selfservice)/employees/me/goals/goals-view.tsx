'use client';

// MBUMAH HARDWARE POS - goals client view (v2.28.0)
//
// Goals and reviews are server-rendered and arrive as props; the
// interactive half is the self-acknowledge action for SUBMITTED reviews,
// which POSTs through the API route and then router.refresh() so the SSR
// render picks up the acknowledged state.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { BadgeCheck, Target, TrendingUp } from 'lucide-react';
import { apiSend, EmptyState, ErrorNote, ProgressMeter, StatusBadge, formatDate } from '@/components/hr/self-service-ui';

export interface GoalDto {
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
export interface ReviewDto {
  id: string;
  cycleName: string;
  status: string;
  acknowledgedAt: string | null;
  createdAt: string;
}

export function GoalsView({ initialGoals, initialReviews }: { initialGoals: GoalDto[]; initialReviews: ReviewDto[] }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const acknowledge = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await apiSend(`/api/self-service/me/reviews/${id}/acknowledge`, 'POST');
      // Re-run the server render - the review comes back acknowledged.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not acknowledge.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {error ? <ErrorNote message={error} /> : null}

      {/* Goals */}
      {initialGoals.length === 0 ? (
        <EmptyState icon={<Target className="h-8 w-8" aria-hidden />} title="No goals yet" hint="Goals your manager assigns will show progress here." />
      ) : (
        <section aria-label="My goals" className="space-y-3">
          {initialGoals.map((g) => (
            <div key={g.id} className="rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
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
              <ProgressMeter pct={g.progressPct} label={`Progress on ${g.title}`} tone={g.status === 'ACHIEVED' ? 'good' : g.status === 'MISSED' ? 'bad' : 'info'} />
              <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                <span>
                  <strong className="text-foreground tabular-nums">{Number(g.currentValue).toLocaleString()}</strong> of{' '}
                  <span className="tabular-nums">{Number(g.targetValue).toLocaleString()}</span> ({g.progressPct}%)
                </span>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Reviews */}
      <section aria-label="My reviews" className="space-y-2">
        <h2 className="px-1 text-sm font-semibold">My reviews</h2>
        {initialReviews.length === 0 ? (
          <EmptyState icon={<BadgeCheck className="h-8 w-8" aria-hidden />} title="No reviews yet" hint="When a manager submits your review it appears here to acknowledge." />
        ) : (
          <ul className="space-y-2">
            {initialReviews.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-3.5 py-3 shadow-sm transition-shadow hover:shadow-md">
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
