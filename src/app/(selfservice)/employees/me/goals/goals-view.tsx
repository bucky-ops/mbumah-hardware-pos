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
import { BadgeCheck, ChevronDown, ChevronUp, Star, Target, TrendingUp } from 'lucide-react';
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
}
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
