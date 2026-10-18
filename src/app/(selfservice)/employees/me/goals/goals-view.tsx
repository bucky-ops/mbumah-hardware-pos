'use client';

// MBUMAH HARDWARE POS - goals client view (v2.28.0; reviews read half v2.87.0)
//
// Goals and reviews are server-rendered and arrive as props; the
// interactive half is the self-acknowledge action for SUBMITTED reviews,
// which POSTs through the API route and then router.refresh() so the SSR
// render picks up the acknowledged state.
//
// v2.87.0: acknowledgement used to be blind - the SSR list carries only
// cycle name, status and dates (the sensitive-data rule: lists never show
// ratings). Each review row now expands to READ the review on demand
// (GET /api/self-service/me/reviews/[id], subject-scoped) - stars,
// strengths, improvements - before the acknowledge button is used.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { BadgeCheck, CalendarRange, ChevronDown, ChevronUp, Star, Target, TrendingUp } from 'lucide-react';
import { apiGet, apiSend, EmptyState, ErrorNote, ProgressMeter, StatusBadge, formatDate } from '@/components/hr/self-service-ui';

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
  cycleName?: string | null;
  // v2.92.0: CUSTOM goals say what their metric counts (from metricConfig).
  metricLabel?: string | null;
  // v2.91.0: the details panel shows the honest recency of the goal —
  // when the manager last touched it (listMyGoals folds updatedAt through).
  updatedAt?: string;
}

// v2.90.0: the portal reads the same shape — status chips wear the same
// badge families the console's goal chips do, light and dark.
const GOAL_CHIP_ACTIVE: Record<string, string> = {
  OPEN: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900',
  ACHIEVED: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900',
  MISSED: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900',
  CLOSED: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600',
  ALL: 'bg-primary text-primary-foreground border-primary',
};
const GOAL_CHIP_ORDER = ['ALL', 'OPEN', 'ACHIEVED', 'MISSED', 'CLOSED'] as const;
export interface ReviewDto {
  id: string;
  cycleName: string;
  status: string;
  acknowledgedAt: string | null;
  createdAt: string;
}

/** The subject's own review detail (v2.87.0) - fetched on expand, cached. */
interface ReviewDetail {
  overallRating: number | null;
  strengths: string | null;
  improvements: string | null;
}

export function GoalsView({ initialGoals, initialReviews }: { initialGoals: GoalDto[]; initialReviews: ReviewDto[] }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // v2.87.0 read half: which review is expanded, the cached detail bodies
  // (rating + narratives, fetched once per review) and the fetch error.
  const [openReviewId, setOpenReviewId] = useState<string | null>(null);
  const [reviewDetails, setReviewDetails] = useState<Record<string, ReviewDetail>>({});
  const [detailError, setDetailError] = useState('');

  // v2.90.0: the goals half of the page speaks the same shape — status
  // chips with live counts from the FULL list, an honest "Showing X of Y"
  // line, and a filtered-empty state that offers the way back.
  const [goalStatus, setGoalStatus] = useState('ALL');
  // v2.91.0: the details drill-down — one goal expanded at a time, the
  // mirror of the reviews read-half below (expand, never a page jump).
  const [openGoalId, setOpenGoalId] = useState<string | null>(null);
  const goalStatusCounts = initialGoals.reduce<Record<string, number>>((acc, g) => {
    if (g.status === 'OPEN' || g.status === 'ACHIEVED' || g.status === 'MISSED' || g.status === 'CLOSED') {
      acc[g.status] = (acc[g.status] ?? 0) + 1;
    }
    return acc;
  }, {});
  const visibleGoals = goalStatus === 'ALL' ? initialGoals : initialGoals.filter((g) => g.status === goalStatus);

  const toggleReview = async (id: string) => {
    setDetailError('');
    if (openReviewId === id) {
      setOpenReviewId(null);
      return;
    }
    setOpenReviewId(id);
    if (!reviewDetails[id]) {
      try {
        const d = await apiGet<ReviewDetail>(`/api/self-service/me/reviews/${id}`);
        setReviewDetails((prev) => ({ ...prev, [id]: d }));
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : 'Could not load the review.');
      }
    }
  };

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
        <section aria-label="My goals" className="space-y-2">
          <h2 className="px-1 text-sm font-semibold">My goals</h2>
          <EmptyState icon={<Target className="h-8 w-8" aria-hidden />} title="No goals yet" hint="Goals your manager assigns will show progress here." />
        </section>
      ) : (
        <section aria-label="My goals" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 px-1">
            <h2 className="text-sm font-semibold">My goals</h2>
            {GOAL_CHIP_ORDER.map((s) => {
              const active = goalStatus === s;
              const count = s === 'ALL' ? initialGoals.length : goalStatusCounts[s] ?? 0;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  data-testid={`my-goal-filter-${s}`}
                  onClick={() => setGoalStatus(s)}
                  className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    active
                      ? GOAL_CHIP_ACTIVE[s]
                      : 'border-border bg-transparent text-muted-foreground hover:bg-muted/60'
                  }`}
                >
                  {s === 'ALL' ? 'All' : s.replace(/_/g, ' ').toLowerCase()}
                  <span className="tabular-nums opacity-70">{count}</span>
                </button>
              );
            })}
            <span className="ml-auto text-xs text-muted-foreground tabular-nums" data-testid="my-goal-count">
              Showing {visibleGoals.length} of {initialGoals.length} goals
            </span>
          </div>
          {visibleGoals.length === 0 ? (
            <div className="rounded-xl border bg-card px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">No goals match the current filter.</p>
              <Button size="sm" variant="outline" className="mt-2" data-testid="my-goal-filter-clear" onClick={() => setGoalStatus('ALL')}>
                Show all goals
              </Button>
            </div>
          ) : (
            visibleGoals.map((g) => {
            const isOpen = openGoalId === g.id;
            return (
            <div key={g.id} className="rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md" data-testid={`my-goal-card-${g.id}`}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{g.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-muted-foreground">
                    {g.isPosSourced ? (
                      <>
                        <TrendingUp className="h-3 w-3 text-emerald-500" aria-hidden /> Computed from POS sales — not editable
                      </>
                    ) : g.metricSource === 'CUSTOM' && g.metricLabel ? (
                      <span className="text-amber-700 dark:text-amber-300">Custom metric · {g.metricLabel}</span>
                    ) : (
                      'Manual goal'
                    )}
                    {g.dueDate ? ` · due ${formatDate(g.dueDate)}` : ''}
                    {g.cycleName ? (
                      <span className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-300">
                        · <CalendarRange className="h-3 w-3" aria-hidden /> {g.cycleName}
                      </span>
                    ) : null}
                  </p>
                </div>
                <StatusBadge status={g.status} />
              </div>
              <ProgressMeter pct={g.progressPct} label={`Progress on ${g.title}`} tone={g.status === 'ACHIEVED' ? 'good' : g.status === 'MISSED' ? 'bad' : 'info'} />
              <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  <strong className="text-foreground tabular-nums">{Number(g.currentValue).toLocaleString()}</strong> of{' '}
                  <span className="tabular-nums">{Number(g.targetValue).toLocaleString()}</span> ({g.progressPct}%)
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-xs"
                  aria-expanded={isOpen}
                  data-testid={`my-goal-details-${g.id}`}
                  onClick={() => setOpenGoalId(isOpen ? null : g.id)}
                >
                  {isOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
                  Details
                </Button>
              </div>
              {isOpen ? (
                <div className="mt-3 space-y-2.5 rounded-xl border bg-background p-3" data-testid={`my-goal-panel-${g.id}`}>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border p-2.5">
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Metric source</p>
                      <p className="text-sm">
                        {g.isPosSourced
                          ? 'POS sales (computed)'
                          : g.metricSource === 'CUSTOM' && g.metricLabel
                            ? `Custom · ${g.metricLabel}`
                            : 'Manual'}
                      </p>
                    </div>
                    <div className="rounded-lg border p-2.5">
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Review cycle</p>
                      <p className="text-sm">{g.cycleName || 'No cycle'}</p>
                    </div>
                    <div className="rounded-lg border p-2.5">
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Due</p>
                      <p className="text-sm">{g.dueDate ? formatDate(g.dueDate) : 'No due date'}</p>
                    </div>
                    <div className="rounded-lg border p-2.5">
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Last updated</p>
                      <p className="text-sm">{g.updatedAt ? formatDate(g.updatedAt) : '—'}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {g.isPosSourced
                      ? 'This goal reads POS sales directly — the number moves when sales move, never by hand.'
                      : g.metricSource === 'CUSTOM'
                        ? 'A custom goal: progress is kept current by hand, counting what the metric names.'
                        : 'A manual goal: your manager keeps the progress value current.'}
                  </p>
                </div>
              ) : null}
            </div>
            );
            })
          )}
        </section>
      )}

      {/* Reviews */}
      <section aria-label="My reviews" className="space-y-2">
        <h2 className="px-1 text-sm font-semibold">My reviews</h2>
        {initialReviews.length === 0 ? (
          <EmptyState icon={<BadgeCheck className="h-8 w-8" aria-hidden />} title="No reviews yet" hint="When a manager submits your review it appears here to acknowledge." />
        ) : (
          <ul className="space-y-2">
            {initialReviews.map((r) => {
              // A const (not a raw element access) — narrowing survives the
              // nested .map closures below; a `reviewDetails[r.id]` lookup
              // would go possibly-undefined again inside them.
              const reviewDetail = openReviewId === r.id ? reviewDetails[r.id] : undefined;
              return (
              <li key={r.id} className="rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.cycleName}</p>
                    <p className="text-xs text-muted-foreground">
                      Submitted {formatDate(r.createdAt)}
                      {r.acknowledgedAt ? ` · acknowledged ${formatDate(r.acknowledgedAt)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={openReviewId === r.id}
                      data-testid={`my-review-read-${r.id}`}
                      disabled={busy}
                      onClick={() => void toggleReview(r.id)}
                    >
                      {openReviewId === r.id ? (
                        <ChevronUp className="h-4 w-4" aria-hidden />
                      ) : (
                        <ChevronDown className="h-4 w-4" aria-hidden />
                      )}
                      Read review
                    </Button>
                    {r.status === 'SUBMITTED' ? (
                      <Button size="sm" disabled={busy} onClick={() => void acknowledge(r.id)}>
                        <BadgeCheck className="h-4 w-4" aria-hidden /> Acknowledge
                      </Button>
                    ) : (
                      <StatusBadge status={r.status} />
                    )}
                  </div>
                </div>
                {/* v2.87.0: the read half - the review body on demand, so
                    acknowledgement is an informed act, never a blind one. */}
                {openReviewId === r.id ? (
                  <div className="space-y-3 border-t px-3.5 py-3" data-testid="my-review-panel">
                    {detailError ? <ErrorNote message={detailError} /> : null}
                    {reviewDetail ? (
                      <>
                        <div className="flex items-center gap-1.5" aria-label={`Overall rating ${reviewDetail.overallRating ?? 'not set'} of 5`}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <Star
                              key={n}
                              className={`h-4 w-4 ${reviewDetail.overallRating !== null && n <= reviewDetail.overallRating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`}
                              aria-hidden
                            />
                          ))}
                          <span className="ml-1 text-sm text-muted-foreground tabular-nums">
                            {reviewDetail.overallRating ?? 'Not set'} / 5
                          </span>
                        </div>
                        <div className="grid gap-2.5 sm:grid-cols-2">
                          <div className="rounded-lg border bg-background p-3">
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Strengths</p>
                            <p className="whitespace-pre-wrap text-sm">{reviewDetail.strengths || '—'}</p>
                          </div>
                          <div className="rounded-lg border bg-background p-3">
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Improvements</p>
                            <p className="whitespace-pre-wrap text-sm">{reviewDetail.improvements || '—'}</p>
                          </div>
                        </div>
                        {r.status === 'SUBMITTED' ? (
                          <p className="text-xs text-muted-foreground">Read it through, then acknowledge below — the acknowledgement says you have seen it.</p>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">Reading your review…</p>
                    )}
                  </div>
                ) : null}
              </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
