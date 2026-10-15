'use client';

// MBUMAH HARDWARE POS - /hr/performance (v2.19.0, spec Phase 4.7)
// Review cycles, performance reviews, and goals console.
// List payloads never render ratings (sensitive-data rule); ratings and
// narratives appear only in the permission-gated review detail dialog.

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Award, CalendarRange, CheckCircle2, Flag, Plus, RefreshCw, Star, Target } from 'lucide-react';
import {
  apiGet,
  apiSend,
  ErrorNote,
  ProgressMeter,
  StatusBadge,
  formatDate,
} from '@/components/hr/self-service-ui';

interface CycleDto {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  reviewCount: number;
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
  canAcknowledge: boolean;
  canCalibrate: boolean;
}
interface GoalDto {
  id: string;
  employeeName: string | null;
  title: string;
  metricSource: string;
  targetValue: string;
  currentValue: string;
  progressPct: number;
  status: string;
  dueDate: string | null;
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

export default function PerformancePage() {
  const [cycles, setCycles] = useState<CycleDto[] | null>(null);
  const [reviews, setReviews] = useState<ReviewListItemDto[] | null>(null);
  const [goals, setGoals] = useState<GoalDto[] | null>(null);
  const [people, setPeople] = useState<PersonDto[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // dialogs
  const [cycleOpen, setCycleOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [detail, setDetail] = useState<ReviewDetailDto | null>(null);

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

      {error ? <ErrorNote message={error} /> : null}

      <Tabs defaultValue="cycles" className="space-y-4">
        <TabsList>
          <TabsTrigger value="cycles">Cycles</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
        </TabsList>

        {/* ── Cycles ── */}
        <TabsContent value="cycles" className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setCycleOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden /> New cycle
            </Button>
          </div>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Review cycles</CardTitle>
              <CardDescription>DRAFT → ACTIVE → CLOSED. Calibration happens while a cycle is active.</CardDescription>
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
                        <TableCell className="text-center">{c.reviewCount}</TableCell>
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
                    {reviews.map((r) => (
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
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Goals ── */}
        <TabsContent value="goals" className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setGoalOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden /> New goal
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {!goals ? (
              <Skeleton className="h-40 w-full" />
            ) : goals.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">No goals yet.</p>
            ) : (
              goals.map((g) => (
                <Card key={g.id} className="flex flex-col">
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
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {Number(g.currentValue).toLocaleString()} / {Number(g.targetValue).toLocaleString()}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {SOURCE_LABELS[g.metricSource] ?? g.metricSource}
                      </Badge>
                    </div>
                    {g.metricSource === 'SALES_TOTAL' || g.metricSource === 'SALES_COUNT' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        disabled={busy}
                        onClick={() => void run(() => apiSend(`/api/hr/goals/${g.id}/recompute`, 'POST'))}
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Recompute from POS sales
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

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
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="goal-target">Target</Label>
                <Input id="goal-target" inputMode="decimal" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} placeholder="e.g. 500000" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-due">Due date (optional)</Label>
              <Input id="goal-due" type="date" value={goalDue} onChange={(e) => setGoalDue(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGoalOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || !goalTitle || !goalEmployeeId || !goalTarget}
              onClick={() =>
                void run(async () => {
                  await apiSend('/api/hr/goals', 'POST', {
                    employeeId: goalEmployeeId,
                    title: goalTitle,
                    metricSource: goalSource,
                    targetValue: goalTarget,
                    ...(goalDue ? { dueDate: new Date(goalDue).toISOString() } : {}),
                  });
                  setGoalOpen(false);
                  setGoalTitle('');
                  setGoalTarget('');
                })
              }
            >
              <Star className="h-4 w-4" aria-hidden /> Create goal
            </Button>
          </DialogFooter>
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
                </DialogDescription>
              </DialogHeader>
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
                {detail.canSubmit || detail.canCalibrate ? (
                  <div className="flex gap-2">
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
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
