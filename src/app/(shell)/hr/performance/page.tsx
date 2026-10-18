'use client';

// MBUMAH HARDWARE POS - /hr/performance (v2.19.0, spec Phase 4.7)
// Review cycles, performance reviews, and goals console.
// List payloads never render ratings (sensitive-data rule); ratings and
// narratives appear only in the permission-gated review detail dialog.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowRight, Award, CalendarRange, CheckCircle2, Filter, Flag, LockKeyhole, LogIn, Pencil, Plus, RefreshCw, Star, Target, Trash2, X } from 'lucide-react';
import { hasHrPermission } from '@/lib/hr/permissions';
import {
  apiGet,
  apiSend,
  ErrorNote,
  ProgressMeter,
  StatusBadge,
  formatDate,
} from '@/components/hr/self-service-ui';

interface CycleStatusCounts {
  DRAFT: number;
  SUBMITTED: number;
  ACKNOWLEDGED: number;
  CALIBRATED: number;
}
interface CycleDto {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  reviewCount: number;
  // v2.88.0: the cycle shows its shape — per-status counts feed the
  // calibration meter (counts only; ratings stay out of lists).
  statusCounts: CycleStatusCounts;
}
interface ReviewListItemDto {
  id: string;
  cycleId: string;
  cycleName: string;
  employeeName: string;
  jobTitle: string | null;
  status: string;
  acknowledgedAt: string | null;
}
interface ReviewDetailDto extends ReviewListItemDto {
  overallRating: number | null;
  strengths: string | null;
  improvements: string | null;
  cycleStatus: string;
  canSubmit: boolean;
  canEdit: boolean;
  canAcknowledge: boolean;
  canCalibrate: boolean;
}

const RATING_MAX = 5;
const NARRATIVE_MAX = 4000;
interface GoalDto {
  id: string;
  employeeId: string;
  employeeName: string | null;
  cycleId: string | null;
  cycleName: string | null;
  title: string;
  metricSource: string;
  // v2.92.0: CUSTOM goals name their metric — shown under the source chip.
  metricLabel: string | null;
  targetValue: string;
  currentValue: string;
  progressPct: number;
  status: string;
  dueDate: string | null;
  updatedAt: string;
}
interface PersonDto {
  id: string;
  name: string;
  jobTitle: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: 'Manual',
  SALES_TOTAL: 'Sales value (POS)',
  SALES_COUNT: 'Sales count (POS)',
  CUSTOM: 'Custom',
};

// v2.89.0: goal-status filter chips — the same language the review chips
// speak (v2.88.0), each status wearing its own badge family when active:
// sky for open, emerald for achieved, rose for missed, slate for closed.
const GOAL_STATUSES = ['OPEN', 'ACHIEVED', 'MISSED', 'CLOSED'] as const;
const GOAL_CHIP_ACTIVE: Record<string, string> = {
  OPEN: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900',
  ACHIEVED: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900',
  MISSED: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900',
  CLOSED: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600',
  ALL: 'bg-primary text-primary-foreground border-primary',
};
// v2.89.0: a goal card's source badge is tinted by family — sky for the
// POS-computed sources, amber for custom, quiet slate for manual.
const SOURCE_CHIP: Record<string, string> = {
  MANUAL: 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300',
  SALES_TOTAL: 'border-sky-300 text-sky-700 dark:border-sky-900 dark:text-sky-300',
  SALES_COUNT: 'border-sky-300 text-sky-700 dark:border-sky-900 dark:text-sky-300',
  CUSTOM: 'border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-300',
};

// v2.88.0: review-status filter chips. Each status wears its own badge
// family when active (same tones StatusBadge renders), so the filter row
// and the table speak the same color language, light and dark.
const REVIEW_STATUSES = ['DRAFT', 'SUBMITTED', 'ACKNOWLEDGED', 'CALIBRATED'] as const;
const STATUS_CHIP_ACTIVE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600',
  SUBMITTED: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900',
  ACKNOWLEDGED: 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-900',
  CALIBRATED: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900',
  ALL: 'bg-primary text-primary-foreground border-primary',
};

export default function PerformancePage() {
  const [cycles, setCycles] = useState<CycleDto[] | null>(null);
  const [reviews, setReviews] = useState<ReviewListItemDto[] | null>(null);
  // v2.91.0: the door is honest — the page mirrors the server's role gate
  // client-side (hasHrPermission over the /api/auth/me role) so a visitor
  // without hr.performance.review sees a lock panel, never interactive
  // tabs whose every action would 403. Null = still resolving.
  const [viewerRole, setViewerRole] = useState<string | null>(null);
  // v2.92.0: signed-out visitors get the same honesty — the /me 401 means
  // "nobody is home", so the tabs (whose every list would 401 into fake
  // empty states) yield to a sign-in panel instead.
  const [authRequired, setAuthRequired] = useState(false);
  const [goals, setGoals] = useState<GoalDto[] | null>(null);
  const [people, setPeople] = useState<PersonDto[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // v2.88.0: the tabs are controlled so a cycle row can walk you into its
  // reviews (the meter's "View reviews" cross-link), and the reviews tab
  // gains cycle + status filters — the API already spoke ?cycleId=&status=,
  // the console just never offered the handles.
  const [tab, setTab] = useState('cycles');
  const [filterCycleId, setFilterCycleId] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');

  // v2.89.0: the Goals tab speaks the same shape — employee + source picks,
  // status chips with live counts, an honest "Showing X of Y" line.
  const [filterGoalEmployee, setFilterGoalEmployee] = useState('ALL');
  const [filterGoalSource, setFilterGoalSource] = useState('ALL');
  const [filterGoalStatus, setFilterGoalStatus] = useState('ALL');

  // dialogs
  const [cycleOpen, setCycleOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [detail, setDetail] = useState<ReviewDetailDto | null>(null);
  // v2.87.0: the write half of the review dialog — the narratives are
  // editable while the review is DRAFT or SUBMITTED and the viewer is the
  // assigned reviewer (or HR); without this form a fresh draft dead-ends
  // (canSubmit requires a rating nobody could write).
  const [editing, setEditing] = useState(false);
  const [editRating, setEditRating] = useState<number | null>(null);
  const [editStrengths, setEditStrengths] = useState('');
  const [editImprovements, setEditImprovements] = useState('');

  // form state
  const [cycleName, setCycleName] = useState('');
  const [cycleStart, setCycleStart] = useState('');
  const [cycleEnd, setCycleEnd] = useState('');
  const [reviewCycleId, setReviewCycleId] = useState('');
  const [reviewEmployeeId, setReviewEmployeeId] = useState('');
  const [goalEmployeeId, setGoalEmployeeId] = useState('');
  const [goalTitle, setGoalTitle] = useState('');
  const [goalSource, setGoalSource] = useState('MANUAL');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDue, setGoalDue] = useState('');
  // v2.90.0: the goals meet their cycles — the New goal dialog offers the
  // review cycles the calibration story lives in; '' reads "No cycle".
  const [goalCycleId, setGoalCycleId] = useState('none');
  // v2.92.0: CUSTOM goes end-to-end — the dialog offers the Custom source
  // and asks what the metric counts (a custom goal without a name for its
  // metric is just a MANUAL goal wearing a costume).
  const [goalCustomLabel, setGoalCustomLabel] = useState('');

  // v2.91.0: the goals take edits — a dedicated edit dialog backed by
  // PATCH /api/hr/goals/[id] (service updateGoal: title / target / due /
  // status OPEN-CLOSED / currentValue for MANUAL-CUSTOM only). Employee and
  // metric source are load-bearing facts the service never rewrites, so the
  // dialog shows them as read-only meta instead of pretending they move.
  const [editGoal, setEditGoal] = useState<GoalDto | null>(null);
  const [editGoalTitle, setEditGoalTitle] = useState('');
  const [editGoalTarget, setEditGoalTarget] = useState('');
  const [editGoalCurrent, setEditGoalCurrent] = useState('');
  const [editGoalStatus, setEditGoalStatus] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const [editGoalDue, setEditGoalDue] = useState('');

  const openGoalEdit = (g: GoalDto) => {
    setEditGoal(g);
    setEditGoalTitle(g.title);
    setEditGoalTarget(g.targetValue);
    setEditGoalCurrent(g.currentValue);
    setEditGoalStatus(g.status === 'CLOSED' ? 'CLOSED' : 'OPEN');
    setEditGoalDue(g.dueDate ? g.dueDate.slice(0, 10) : '');
  };

  // v2.92.0: the goals can leave — a destructive action gets a confirm
  // dialog that says what a soft delete means (lists lose it, history
  // keeps it), never a bare one-click vanish.
  const [deleteTarget, setDeleteTarget] = useState<GoalDto | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet<{ role?: string }>('/api/auth/me')
      .then((me) => {
        if (alive) setViewerRole(me.role ?? null);
      })
      .catch((e) => {
        // v2.92.0: a 401 means nobody is signed in — the honest door says
        // so. Anything else (network blip) keeps the existing error path.
        if (alive && (e as { status?: number })?.status === 401) setAuthRequired(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Server truth: hrGuard('hr.performance.review') allows BRANCH_MANAGER /
  // HR_MANAGER / STORE_OWNER (SUPER_ADMIN bypasses); .manage allows
  // HR_MANAGER / STORE_OWNER. Same map, same bypass — one file, no drift.
  const canReview = viewerRole !== null && hasHrPermission(viewerRole, 'hr.performance.review');
  const canManage = viewerRole !== null && hasHrPermission(viewerRole, 'hr.performance.manage');

  const load = useCallback(async () => {
    setError('');
    try {
      const [c, r, g, p] = await Promise.all([
        apiGet<CycleDto[]>('/api/hr/performance/cycles'),
        apiGet<ReviewListItemDto[]>('/api/hr/performance/reviews'),
        apiGet<GoalDto[]>('/api/hr/goals'),
        apiGet<PersonDto[]>('/api/hr/performance/people').catch(() => [] as PersonDto[]),
      ]);
      setCycles(c);
      setReviews(r);
      setGoals(g);
      setPeople(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load performance data.');
      setCycles((prev) => prev ?? []);
      setReviews((prev) => prev ?? []);
      setGoals((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // v2.88.0: status counts stay honest to the FULL loaded list (never the
  // filtered subset), so chips keep saying how many reviews exist overall.
  const reviewStatusCounts = useMemo(() => {
    const counts: CycleStatusCounts = { DRAFT: 0, SUBMITTED: 0, ACKNOWLEDGED: 0, CALIBRATED: 0 };
    for (const r of reviews ?? []) {
      if (r.status === 'DRAFT' || r.status === 'SUBMITTED' || r.status === 'ACKNOWLEDGED' || r.status === 'CALIBRATED') {
        counts[r.status] += 1;
      }
    }
    return counts;
  }, [reviews]);

  const filteredReviews = useMemo(
    () =>
      (reviews ?? []).filter(
        (r) =>
          (filterCycleId === 'ALL' || r.cycleId === filterCycleId) &&
          (filterStatus === 'ALL' || r.status === filterStatus),
      ),
    [reviews, filterCycleId, filterStatus],
  );
  const filtersActive = filterCycleId !== 'ALL' || filterStatus !== 'ALL';
  const clearFilters = () => {
    setFilterCycleId('ALL');
    setFilterStatus('ALL');
  };

  // v2.89.0: goal counts stay honest to the FULL loaded list (never the
  // filtered subset) — chips say how many goals exist overall.
  const goalStatusCounts = useMemo(() => {
    const counts: Record<string, number> = { OPEN: 0, ACHIEVED: 0, MISSED: 0, CLOSED: 0 };
    for (const g of goals ?? []) {
      if (g.status === 'OPEN' || g.status === 'ACHIEVED' || g.status === 'MISSED' || g.status === 'CLOSED') {
        counts[g.status] += 1;
      }
    }
    return counts;
  }, [goals]);

  const filteredGoals = useMemo(
    () =>
      (goals ?? []).filter(
        (g) =>
          (filterGoalEmployee === 'ALL' || g.employeeId === filterGoalEmployee) &&
          (filterGoalSource === 'ALL' || g.metricSource === filterGoalSource) &&
          (filterGoalStatus === 'ALL' || g.status === filterGoalStatus),
      ),
    [goals, filterGoalEmployee, filterGoalSource, filterGoalStatus],
  );
  const goalFiltersActive =
    filterGoalEmployee !== 'ALL' || filterGoalSource !== 'ALL' || filterGoalStatus !== 'ALL';
  const clearGoalFilters = () => {
    setFilterGoalEmployee('ALL');
    setFilterGoalSource('ALL');
    setFilterGoalStatus('ALL');
  };
  // v2.89.0: the one-call refresh appears only when something can use it —
  // at least one POS-sourced goal exists in the loaded list.
  const posGoalCount = useMemo(
    () => (goals ?? []).filter((g) => g.metricSource === 'SALES_TOTAL' || g.metricSource === 'SALES_COUNT').length,
    [goals],
  );
  const recomputeAll = () => apiSend<{ recomputed: number }>('/api/hr/goals/recompute-all', 'POST');

  const viewCycleReviews = (cycleId: string) => {
    setFilterCycleId(cycleId);
    setFilterStatus('ALL');
    setTab('reviews');
  };

  const calibrationTone = (pct: number): 'good' | 'info' | 'warn' =>
    pct >= 100 ? 'good' : pct > 0 ? 'info' : 'warn';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Award className="h-6 w-6 text-amber-500" aria-hidden /> Performance
          </h1>
          <p className="text-sm text-muted-foreground">
            Review cycles, calibration, and goals. Ratings stay private: lists never show them, detail views are permission-gated.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} aria-label="Refresh performance data">
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden /> Refresh
        </Button>
      </div>

      {/* v2.91.0: when the door is locked the lock panel IS the honest
          explanation — the raw 403 note would only repeat it louder, so
          it stays quiet behind the lock. */}
      {error && viewerRole === null ? <ErrorNote message={error} /> : null}
      {error && viewerRole !== null && canReview ? <ErrorNote message={error} /> : null}

      {/* ── v2.92.0 the honest sign-in door ──
          Nobody signed in: the tabs would render fake empty states over
          lists that never loaded — a sign-in panel says what is true. */}
      {authRequired ? (
        <Card className="border-sky-300/70 dark:border-sky-900" data-testid="perf-auth">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-950/50">
              <LogIn className="h-6 w-6 text-sky-600 dark:text-sky-400" aria-hidden />
            </span>
            <div className="space-y-1">
              <p className="text-base font-semibold">Sign in to view this workspace</p>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                Review cycles, calibration, and team goals live behind a signed-in session with HR
                performance access. Nothing here was loaded — the empty states you would have seen
                would have been lies.
              </p>
              <Button asChild size="sm" className="mt-2">
                <Link href="/" data-testid="perf-auth-signin">
                  <LogIn className="h-4 w-4" aria-hidden /> Go to sign in
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : viewerRole !== null && !canReview ? (
        <Card className="border-amber-300/70 dark:border-amber-900" data-testid="perf-lock">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/50">
              <LockKeyhole className="h-6 w-6 text-amber-600 dark:text-amber-400" aria-hidden />
            </span>
            <div className="space-y-1">
              <p className="text-base font-semibold">HR performance is locked for your role</p>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                Your role{' '}
                <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-300" data-testid="perf-lock-role">
                  {viewerRole.replace(/_/g, ' ')}
                </Badge>{' '}
                does not hold the <code className="rounded bg-muted px-1 py-0.5 text-[11px]">hr.performance.review</code> permission,
                so this workspace stays closed — cycles, reviews, and goals alike.
              </p>
              <p className="mx-auto max-w-md text-xs text-muted-foreground">
                Ask an HR manager or the store owner for access. Your own goals and reviews live in the{' '}
                <Link href="/employees/me" className="font-medium text-sky-700 underline underline-offset-2 hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200">
                  self-service portal
                </Link>
                .
              </p>
            </div>
          </CardContent>
        </Card>
      ) : viewerRole === null && !authRequired && !cycles && !reviews && !goals ? (
        <Skeleton className="h-40 w-full" />
      ) : (
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="cycles">Cycles</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
        </TabsList>

        {/* ── Cycles ── */}
        <TabsContent value="cycles" className="space-y-4">
          {canManage ? (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setCycleOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden /> New cycle
            </Button>
          </div>
          ) : null}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Review cycles</CardTitle>
              <CardDescription>
                DRAFT → ACTIVE → CLOSED. Calibration happens while a cycle is active — the meter tracks how far each cycle has walked.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!cycles ? (
                <Skeleton className="h-32 w-full" />
              ) : cycles.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No cycles yet. Create the first one.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cycle</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-center">Reviews</TableHead>
                      <TableHead className="min-w-52">Calibration</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cycles.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(c.periodStart)} → {formatDate(c.periodEnd)}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">{c.reviewCount}</TableCell>
                        <TableCell>
                          {c.reviewCount === 0 ? (
                            <span className="text-xs text-muted-foreground">No reviews yet</span>
                          ) : (
                            <div className="space-y-1.5" data-testid={`cycle-meter-${c.id}`}>
                              <ProgressMeter
                                pct={Math.round((c.statusCounts.CALIBRATED / c.reviewCount) * 100)}
                                tone={calibrationTone(Math.round((c.statusCounts.CALIBRATED / c.reviewCount) * 100))}
                                label={`Calibration progress for ${c.name}: ${c.statusCounts.CALIBRATED} of ${c.reviewCount} reviews calibrated`}
                              />
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                <span className="font-medium tabular-nums" data-testid={`cycle-meter-text-${c.id}`}>
                                  {c.statusCounts.CALIBRATED} of {c.reviewCount} calibrated
                                </span>
                                {c.statusCounts.DRAFT + c.statusCounts.SUBMITTED + c.statusCounts.ACKNOWLEDGED > 0 ? (
                                  <span className="text-muted-foreground tabular-nums">
                                    {[
                                      c.statusCounts.DRAFT > 0 ? `${c.statusCounts.DRAFT} draft` : null,
                                      c.statusCounts.SUBMITTED > 0 ? `${c.statusCounts.SUBMITTED} submitted` : null,
                                      c.statusCounts.ACKNOWLEDGED > 0 ? `${c.statusCounts.ACKNOWLEDGED} acknowledged` : null,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  data-testid={`cycle-view-reviews-${c.id}`}
                                  className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
                                  onClick={() => viewCycleReviews(c.id)}
                                >
                                  View reviews <ArrowRight className="h-3 w-3" aria-hidden />
                                </button>
                              </div>
                            </div>
                          )}
                        </TableCell>
                        <TableCell><StatusBadge status={c.status} /></TableCell>
                        <TableCell className="space-x-2 text-right">
                          {c.status === 'DRAFT' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || c.reviewCount === 0}
                              title={c.reviewCount === 0 ? 'Add at least one review first' : undefined}
                              onClick={() => void run(() => apiSend(`/api/hr/performance/cycles/${c.id}`, 'PATCH', { action: 'ACTIVATE' }))}
                            >
                              Activate
                            </Button>
                          ) : null}
                          {c.status === 'ACTIVE' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void run(() => apiSend(`/api/hr/performance/cycles/${c.id}`, 'PATCH', { action: 'CLOSE' }))}
                            >
                              Close
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Reviews ── */}
        <TabsContent value="reviews" className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setReviewOpen(true)} disabled={cycles?.length === 0}>
              <Plus className="h-4 w-4" aria-hidden /> New review
            </Button>
          </div>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Performance reviews</CardTitle>
              <CardDescription>
                DRAFT → SUBMITTED → ACKNOWLEDGED → CALIBRATED. The employee acknowledges their own review from the self-service portal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!reviews ? (
                <Skeleton className="h-32 w-full" />
              ) : reviews.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No reviews yet.</p>
              ) : (
                <div className="space-y-3">
                  {/* ── v2.88.0 filters: cycle select + status chips ── */}
                  <div className="flex flex-wrap items-center gap-2" data-testid="review-filters">
                    <Filter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    <Select value={filterCycleId} onValueChange={setFilterCycleId}>
                      <SelectTrigger className="h-8 w-52" aria-label="Filter by cycle" data-testid="review-filter-cycle">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All cycles</SelectItem>
                        {(cycles ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {['ALL', ...REVIEW_STATUSES].map((s) => {
                      const active = filterStatus === s;
                      const count = s === 'ALL' ? (reviews ?? []).length : reviewStatusCounts[s as keyof CycleStatusCounts];
                      return (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={active}
                          data-testid={`review-filter-status-${s}`}
                          onClick={() => setFilterStatus(s)}
                          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                            active
                              ? STATUS_CHIP_ACTIVE[s]
                              : 'border-border bg-transparent text-muted-foreground hover:bg-muted/60'
                          }`}
                        >
                          {s === 'ALL' ? 'All' : s.replace(/_/g, ' ').toLowerCase()}
                          <span className="tabular-nums opacity-70">{count}</span>
                        </button>
                      );
                    })}
                    {filtersActive ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        data-testid="review-filter-clear"
                        onClick={clearFilters}
                      >
                        <X className="h-3 w-3" aria-hidden /> Clear filters
                      </Button>
                    ) : null}
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums" data-testid="review-filter-count">
                      Showing {filteredReviews.length} of {(reviews ?? []).length} reviews
                    </span>
                  </div>
                  {filteredReviews.length === 0 ? (
                    <div className="py-6 text-center">
                      <p className="text-sm text-muted-foreground">No reviews match the current filters.</p>
                      <Button size="sm" variant="outline" className="mt-2" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    </div>
                  ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Cycle</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Acknowledged</TableHead>
                      <TableHead className="text-right">Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReviews.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium">{r.employeeName}</div>
                          <div className="text-xs text-muted-foreground">{r.jobTitle ?? '—'}</div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.cycleName}</TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(r.acknowledgedAt)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              void run(async () => {
                                const d = await apiGet<ReviewDetailDto>(`/api/hr/performance/reviews/${r.id}`);
                                setDetail(d);
                                setEditing(false);
                              })
                            }
                          >
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Goals ── */}
        <TabsContent value="goals" className="space-y-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canManage && posGoalCount > 0 ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                data-testid="goal-recompute-all"
                title={`Recompute ${posGoalCount} POS-sourced ${posGoalCount === 1 ? 'goal' : 'goals'} from sales`}
                onClick={() => void run(recomputeAll)}
                className="border-sky-300 text-sky-700 hover:bg-sky-50 hover:text-sky-800 dark:border-sky-900 dark:text-sky-300 dark:hover:bg-sky-950/40 dark:hover:text-sky-200"
              >
                <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden /> Recompute all POS goals
              </Button>
            ) : null}
            {canManage ? (
              <Button size="sm" onClick={() => setGoalOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden /> New goal
              </Button>
            ) : null}
          </div>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Team goals</CardTitle>
              <CardDescription>
                OPEN → ACHIEVED or MISSED. Sales goals recompute from POS — the value is never typed by hand.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!goals ? (
                <Skeleton className="h-40 w-full" />
              ) : goals.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No goals yet. Create the first one.</p>
              ) : (
                <div className="space-y-3">
                  {/* ── v2.89.0 filters: employee + source picks, status chips ── */}
                  <div className="flex flex-wrap items-center gap-2" data-testid="goal-filters">
                    <Filter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    <Select value={filterGoalEmployee} onValueChange={setFilterGoalEmployee}>
                      <SelectTrigger className="h-8 w-44" aria-label="Filter goals by employee" data-testid="goal-filter-employee">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All employees</SelectItem>
                        {people.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={filterGoalSource} onValueChange={setFilterGoalSource}>
                      <SelectTrigger className="h-8 w-44" aria-label="Filter goals by metric source" data-testid="goal-filter-source">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All sources</SelectItem>
                        {Object.keys(SOURCE_LABELS).map((s) => (
                          <SelectItem key={s} value={s}>{SOURCE_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {['ALL', ...GOAL_STATUSES].map((s) => {
                      const active = filterGoalStatus === s;
                      const count = s === 'ALL' ? (goals ?? []).length : goalStatusCounts[s] ?? 0;
                      return (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={active}
                          data-testid={`goal-filter-status-${s}`}
                          onClick={() => setFilterGoalStatus(s)}
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
                    {goalFiltersActive ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        data-testid="goal-filter-clear"
                        onClick={clearGoalFilters}
                      >
                        <X className="h-3 w-3" aria-hidden /> Clear filters
                      </Button>
                    ) : null}
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums" data-testid="goal-filter-count">
                      Showing {filteredGoals.length} of {(goals ?? []).length} goals
                    </span>
                  </div>
                  {filteredGoals.length === 0 ? (
                    <div className="py-6 text-center">
                      <p className="text-sm text-muted-foreground">No goals match the current filters.</p>
                      <Button size="sm" variant="outline" className="mt-2" onClick={clearGoalFilters}>
                        Clear filters
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {filteredGoals.map((g) => (
                        <Card key={g.id} className="flex flex-col" data-testid={`goal-card-${g.id}`}>
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between gap-2">
                              <CardTitle className="text-sm font-medium leading-snug">{g.title}</CardTitle>
                              <StatusBadge status={g.status} />
                            </div>
                            <CardDescription className="flex items-center gap-1.5">
                              <Target className="h-3.5 w-3.5" aria-hidden />
                              {g.employeeName ?? 'Employee'} · due {formatDate(g.dueDate)}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="mt-auto space-y-3">
                            <ProgressMeter
                              pct={g.progressPct}
                              tone={g.status === 'ACHIEVED' ? 'good' : g.status === 'MISSED' ? 'bad' : 'info'}
                            />
                            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <span className="tabular-nums">
                                {Number(g.currentValue).toLocaleString()} / {Number(g.targetValue).toLocaleString()}
                              </span>
                              <div className="flex items-center gap-1">
                                {g.cycleName ? (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-300"
                                    title="Linked review cycle"
                                  >
                                    <CalendarRange className="h-3 w-3" aria-hidden /> {g.cycleName}
                                  </Badge>
                                ) : null}
                                <Badge variant="outline" className={`text-[10px] ${SOURCE_CHIP[g.metricSource] ?? ''}`} title={g.metricLabel ?? undefined}>
                                  {SOURCE_LABELS[g.metricSource] ?? g.metricSource}
                                  {g.metricSource === 'CUSTOM' && g.metricLabel ? <span className="ml-1 opacity-80">· {g.metricLabel}</span> : null}
                                </Badge>
                              </div>
                            </div>
                            {g.metricSource === 'SALES_TOTAL' || g.metricSource === 'SALES_COUNT' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full border-sky-300 text-sky-700 hover:bg-sky-50 hover:text-sky-800 dark:border-sky-900 dark:text-sky-300 dark:hover:bg-sky-950/40 dark:hover:text-sky-200"
                                disabled={busy}
                                onClick={() => void run(() => apiSend(`/api/hr/goals/${g.id}/recompute`, 'POST'))}
                              >
                                <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden /> Recompute from POS sales
                              </Button>
                            ) : null}
                            {canManage ? (
                              <div className="flex w-full gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="flex-1"
                                  data-testid={`goal-edit-${g.id}`}
                                  aria-label={`Edit goal ${g.title}`}
                                  disabled={busy}
                                  onClick={() => openGoalEdit(g)}
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit goal
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="flex-1 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                                  data-testid={`goal-delete-${g.id}`}
                                  aria-label={`Delete goal ${g.title}`}
                                  disabled={busy}
                                  onClick={() => setDeleteTarget(g)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
                                </Button>
                              </div>
                            ) : null}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      )}

      {/* ── New cycle dialog ── */}
      <Dialog open={cycleOpen} onOpenChange={setCycleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarRange className="h-5 w-5 text-amber-500" aria-hidden /> New review cycle
            </DialogTitle>
            <DialogDescription>Name the cycle and set its period. It starts in DRAFT.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cycle-name">Cycle name</Label>
              <Input id="cycle-name" value={cycleName} onChange={(e) => setCycleName(e.target.value)} placeholder="e.g. H2 2026 Reviews" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cycle-start">Start</Label>
                <Input id="cycle-start" type="date" value={cycleStart} onChange={(e) => setCycleStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cycle-end">End</Label>
                <Input id="cycle-end" type="date" value={cycleEnd} onChange={(e) => setCycleEnd(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCycleOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || !cycleName || !cycleStart || !cycleEnd}
              onClick={() =>
                void run(async () => {
                  await apiSend('/api/hr/performance/cycles', 'POST', {
                    name: cycleName,
                    periodStart: new Date(cycleStart).toISOString(),
                    periodEnd: new Date(cycleEnd).toISOString(),
                  });
                  setCycleOpen(false);
                  setCycleName('');
                })
              }
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Create cycle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New review dialog ── */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New performance review</DialogTitle>
            <DialogDescription>Pick a cycle and employee. You become the reviewer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Cycle</Label>
              <Select value={reviewCycleId} onValueChange={setReviewCycleId}>
                <SelectTrigger aria-label="Review cycle"><SelectValue placeholder="Choose cycle" /></SelectTrigger>
                <SelectContent>
                  {(cycles ?? []).filter((c) => c.status !== 'CLOSED').map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={reviewEmployeeId} onValueChange={setReviewEmployeeId}>
                <SelectTrigger aria-label="Employee"><SelectValue placeholder="Choose employee" /></SelectTrigger>
                <SelectContent>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}{p.jobTitle ? ` — ${p.jobTitle}` : ''}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || !reviewCycleId || !reviewEmployeeId}
              onClick={() =>
                void run(async () => {
                  await apiSend('/api/hr/performance/reviews', 'POST', {
                    cycleId: reviewCycleId,
                    employeeId: reviewEmployeeId,
                  });
                  setReviewOpen(false);
                  setReviewEmployeeId('');
                })
              }
            >
              Create review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New goal dialog ── */}
      <Dialog open={goalOpen} onOpenChange={setGoalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="h-5 w-5 text-sky-500" aria-hidden /> New goal
            </DialogTitle>
            <DialogDescription>
              Sales goals compute their progress from POS transactions — the value is never typed by hand.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="goal-title">Title</Label>
              <Input id="goal-title" value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} placeholder="e.g. Monthly sales target" />
            </div>
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={goalEmployeeId} onValueChange={setGoalEmployeeId}>
                <SelectTrigger aria-label="Goal employee"><SelectValue placeholder="Choose employee" /></SelectTrigger>
                <SelectContent>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Metric source</Label>
                <Select value={goalSource} onValueChange={setGoalSource}>
                  <SelectTrigger aria-label="Metric source"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANUAL">Manual</SelectItem>
                    <SelectItem value="SALES_TOTAL">Sales value (POS)</SelectItem>
                    <SelectItem value="SALES_COUNT">Sales count (POS)</SelectItem>
                    <SelectItem value="CUSTOM">Custom metric</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="goal-target">Target</Label>
                <Input id="goal-target" inputMode="decimal" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} placeholder="e.g. 500000" />
              </div>
            </div>
            {goalSource === 'CUSTOM' ? (
              <div className="space-y-1.5">
                <Label htmlFor="goal-custom-label">What does the metric count?</Label>
                <Input
                  id="goal-custom-label"
                  data-testid="goal-custom-label"
                  value={goalCustomLabel}
                  maxLength={120}
                  onChange={(e) => setGoalCustomLabel(e.target.value)}
                  placeholder="e.g. Load deliveries completed per week"
                />
                <p className="text-xs text-muted-foreground">
                  A custom goal tracks progress by hand — name the metric so the team knows what counts.
                </p>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>Review cycle (optional)</Label>
              <Select value={goalCycleId} onValueChange={setGoalCycleId}>
                <SelectTrigger aria-label="Goal review cycle" data-testid="goal-cycle-picker"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No cycle</SelectItem>
                  {(cycles ?? []).filter((c) => c.status !== 'CLOSED').map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-due">Due date (optional)</Label>
              <Input id="goal-due" type="date" value={goalDue} onChange={(e) => setGoalDue(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGoalOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || !goalTitle || !goalEmployeeId || !goalTarget || (goalSource === 'CUSTOM' && goalCustomLabel.trim().length < 2)}
              onClick={() =>
                void run(async () => {
                  await apiSend('/api/hr/goals', 'POST', {
                    employeeId: goalEmployeeId,
                    title: goalTitle,
                    metricSource: goalSource,
                    targetValue: goalTarget,
                    ...(goalSource === 'CUSTOM' ? { metricConfig: { label: goalCustomLabel } } : {}),
                    ...(goalDue ? { dueDate: new Date(goalDue).toISOString() } : {}),
                    ...(goalCycleId !== 'none' ? { cycleId: goalCycleId } : {}),
                  });
                  setGoalOpen(false);
                  setGoalTitle('');
                  setGoalTarget('');
                  setGoalCustomLabel('');
                  setGoalCycleId('none');
                })
              }
            >
              <Star className="h-4 w-4" aria-hidden /> Create goal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── v2.91.0 Edit goal dialog ── */}
      <Dialog open={editGoal !== null} onOpenChange={(open) => !open && setEditGoal(null)}>
        <DialogContent className="sm:max-w-md" data-testid="goal-edit-dialog">
          {editGoal ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Pencil className="h-5 w-5 text-sky-500" aria-hidden /> Edit goal
                </DialogTitle>
                <DialogDescription>
                  Title, target, due date, and status move here. The metric source never changes — achieved and missed are computed, never typed.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                {/* load-bearing facts the service never rewrites — shown, not editable */}
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground" data-testid="goal-edit-meta">
                  <Target className="h-3.5 w-3.5" aria-hidden />
                  <span className="font-medium text-foreground">{editGoal.employeeName ?? 'Employee'}</span>
                  <span aria-hidden>·</span>
                  <Badge variant="outline" className={`text-[10px] ${SOURCE_CHIP[editGoal.metricSource] ?? ''}`}>
                    {SOURCE_LABELS[editGoal.metricSource] ?? editGoal.metricSource}
                  </Badge>
                  {editGoal.cycleName ? (
                    <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-300">
                      <CalendarRange className="h-3 w-3" aria-hidden /> {editGoal.cycleName}
                    </Badge>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="goal-edit-title">Title</Label>
                  <Input id="goal-edit-title" data-testid="goal-edit-title" value={editGoalTitle} onChange={(e) => setEditGoalTitle(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="goal-edit-target">Target</Label>
                    <Input id="goal-edit-target" data-testid="goal-edit-target" inputMode="decimal" value={editGoalTarget} onChange={(e) => setEditGoalTarget(e.target.value)} />
                  </div>
                  {editGoal.metricSource === 'MANUAL' || editGoal.metricSource === 'CUSTOM' ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="goal-edit-current">Current value</Label>
                      <Input id="goal-edit-current" data-testid="goal-edit-current" inputMode="decimal" value={editGoalCurrent} onChange={(e) => setEditGoalCurrent(e.target.value)} />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label>Current value</Label>
                      <p className="rounded-md border border-sky-300 bg-sky-50 px-2.5 py-2 text-xs text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300" data-testid="goal-edit-pos-note">
                        Computed from POS sales — use recompute, never a typed value.
                      </p>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <div className="flex gap-1.5" role="group" aria-label="Goal status">
                    {(['OPEN', 'CLOSED'] as const).map((s) => {
                      const active = editGoalStatus === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={active}
                          data-testid={`goal-edit-status-${s.toLowerCase()}`}
                          disabled={busy}
                          onClick={() => setEditGoalStatus(s)}
                          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                            active ? GOAL_CHIP_ACTIVE[s] : 'border-border bg-transparent text-muted-foreground hover:bg-muted/60'
                          }`}
                        >
                          {s === 'OPEN' ? 'Reopen (open)' : 'Park (closed)'}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ACHIEVED and MISSED are computed from progress — you can only park or reopen a goal.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="goal-edit-due">Due date</Label>
                  <Input id="goal-edit-due" data-testid="goal-edit-due" type="date" value={editGoalDue} onChange={(e) => setEditGoalDue(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" data-testid="goal-edit-cancel" disabled={busy} onClick={() => setEditGoal(null)}>Cancel</Button>
                <Button
                  data-testid="goal-edit-save"
                  disabled={busy || editGoalTitle.trim().length < 3 || !editGoalTarget}
                  onClick={() =>
                    void run(async () => {
                      await apiSend(`/api/hr/goals/${editGoal.id}`, 'PATCH', {
                        title: editGoalTitle,
                        targetValue: editGoalTarget,
                        dueDate: editGoalDue ? new Date(editGoalDue).toISOString() : '',
                        status: editGoalStatus,
                        ...(editGoal.metricSource === 'MANUAL' || editGoal.metricSource === 'CUSTOM' ? { currentValue: editGoalCurrent } : {}),
                      });
                      setEditGoal(null);
                    })
                  }
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> Save changes
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── v2.92.0 Delete goal confirm ── */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md" data-testid="goal-delete-dialog">
          {deleteTarget ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Trash2 className="h-5 w-5 text-rose-500" aria-hidden /> Delete this goal?
                </DialogTitle>
                <DialogDescription>
                  <span className="font-medium text-foreground">{deleteTarget.title}</span> will leave the
                  team board and the employee&apos;s portal at once. The record and its audit history stay —
                  this is a removal from the lists, never a hard delete.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" data-testid="goal-delete-summary">
                <p>
                  {deleteTarget.employeeName ?? 'Employee'} ·{' '}
                  {SOURCE_LABELS[deleteTarget.metricSource] ?? deleteTarget.metricSource} ·{' '}
                  {deleteTarget.status.replace(/_/g, ' ').toLowerCase()} ·{' '}
                  <span className="tabular-nums">
                    {Number(deleteTarget.currentValue).toLocaleString()} / {Number(deleteTarget.targetValue).toLocaleString()}
                  </span>{' '}
                  progress recorded
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" data-testid="goal-delete-cancel" disabled={busy} onClick={() => setDeleteTarget(null)}>
                  Keep goal
                </Button>
                <Button
                  variant="destructive"
                  data-testid="goal-delete-confirm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await apiSend(`/api/hr/goals/${deleteTarget.id}`, 'DELETE');
                      setDeleteTarget(null);
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" aria-hidden /> Delete goal
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Review detail dialog ── */}
      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-lg">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  Review — {detail.employeeName} <StatusBadge status={detail.status} />
                </DialogTitle>
                <DialogDescription>
                  Cycle: {detail.cycleName} ({detail.cycleStatus}) · the rating is only visible here, never in lists.
                  {detail.canEdit ? ' Narratives stay editable while the review is a draft or awaiting acknowledgement.' : ''}
                </DialogDescription>
              </DialogHeader>
              {editing ? (
                /* ── v2.87.0 EDIT MODE — the write half of the dialog ── */
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Overall rating</Label>
                    <div className="flex items-center gap-1" role="radiogroup" aria-label="Overall rating of 5">
                      {Array.from({ length: RATING_MAX }, (_, i) => i + 1).map((n) => (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={editRating === n}
                          aria-label={`Rate ${n} of ${RATING_MAX}`}
                          data-testid={`perf-rating-option-${n}`}
                          disabled={busy}
                          onClick={() => setEditRating(n)}
                          className="rounded transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-50"
                        >
                          <Star
                            className={`h-6 w-6 ${editRating !== null && n <= editRating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30 hover:text-amber-300'}`}
                            aria-hidden
                          />
                        </button>
                      ))}
                      <span className="ml-1.5 text-sm text-muted-foreground tabular-nums">
                        {editRating ?? 'Not set'} / {RATING_MAX}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="review-strengths">Strengths</Label>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {editStrengths.length}/{NARRATIVE_MAX}
                      </span>
                    </div>
                    <Textarea
                      id="review-strengths"
                      data-testid="perf-strengths-input"
                      value={editStrengths}
                      maxLength={NARRATIVE_MAX}
                      onChange={(e) => setEditStrengths(e.target.value)}
                      rows={4}
                      placeholder="What does this employee do well?"
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="review-improvements">Improvements</Label>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {editImprovements.length}/{NARRATIVE_MAX}
                      </span>
                    </div>
                    <Textarea
                      id="review-improvements"
                      data-testid="perf-improvements-input"
                      value={editImprovements}
                      maxLength={NARRATIVE_MAX}
                      onChange={(e) => setEditImprovements(e.target.value)}
                      rows={4}
                      placeholder="Where should they grow next?"
                      className="text-sm"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="perf-cancel-edit"
                      disabled={busy}
                      onClick={() => setEditing(false)}
                    >
                      <X className="h-4 w-4" aria-hidden /> Cancel
                    </Button>
                    <Button
                      size="sm"
                      data-testid="perf-save-draft"
                      disabled={busy || editRating === null}
                      onClick={() =>
                        void run(async () => {
                          const d = await apiSend<ReviewDetailDto>(`/api/hr/performance/reviews/${detail.id}`, 'PATCH', {
                            action: 'UPDATE',
                            overallRating: editRating,
                            strengths: editStrengths,
                            improvements: editImprovements,
                          });
                          setDetail(d);
                          setEditing(false);
                        })
                      }
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden /> Save draft
                    </Button>
                  </div>
                </div>
              ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-1.5" aria-label={`Overall rating ${detail.overallRating ?? 'not set'} of 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className={`h-5 w-5 ${detail.overallRating !== null && n <= detail.overallRating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`}
                      aria-hidden
                    />
                  ))}
                  <span className="ml-1 text-sm text-muted-foreground">
                    {detail.overallRating ?? 'Not set'} / 5
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border p-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Strengths</p>
                    <p className="whitespace-pre-wrap text-sm">{detail.strengths || '—'}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Improvements</p>
                    <p className="whitespace-pre-wrap text-sm">{detail.improvements || '—'}</p>
                  </div>
                </div>
                {detail.canEdit || detail.canSubmit || detail.canCalibrate ? (
                  <div className="flex flex-wrap gap-2">
                    {detail.canEdit ? (
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="perf-review-edit"
                        disabled={busy}
                        onClick={() => {
                          setEditRating(detail.overallRating);
                          setEditStrengths(detail.strengths ?? '');
                          setEditImprovements(detail.improvements ?? '');
                          setEditing(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" aria-hidden /> {detail.overallRating === null ? 'Write review' : 'Edit review'}
                      </Button>
                    ) : null}
                    {detail.canSubmit ? (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const d = await apiSend<ReviewDetailDto>(`/api/hr/performance/reviews/${detail.id}`, 'PATCH', { action: 'SUBMIT' });
                            setDetail(d);
                          })
                        }
                      >
                        Submit for acknowledgement
                      </Button>
                    ) : null}
                    {detail.canCalibrate ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const d = await apiSend<ReviewDetailDto>(`/api/hr/performance/reviews/${detail.id}`, 'PATCH', { action: 'CALIBRATE' });
                            setDetail(d);
                          })
                        }
                      >
                        Calibrate
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
