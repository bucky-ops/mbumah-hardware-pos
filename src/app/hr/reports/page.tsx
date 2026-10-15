'use client';

// MBUMAH HARDWARE POS - /hr/reports (v2.20.0, spec Phase 4.8)
//
// Dense report tables: sticky headers, column visibility toggles, CSV export,
// print-to-PDF, no horizontal scroll on supported viewports, no raw ids.
// Reports are aggregates; per-employee rows carry employeeCode + job title
// only. The Privacy tab governs erasure requests (decision + legal basis).

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  BarChart3,
  Coins,
  CalendarX2,
  DoorOpen,
  Hourglass,
  Landmark,
  FileSpreadsheet,
  Printer,
  ShieldCheck,
  Columns3,
} from 'lucide-react';
import { apiGet, apiSend, ErrorNote, StatusBadge, formatDate, formatKes } from '@/components/hr/self-service-ui';

type Money = number;

interface Period {
  from: string;
  to: string;
}
interface HeadcountDto extends Period {
  scope: string;
  active: number;
  onLeave: number;
  suspended: number;
  hiresInPeriod: number;
  exitsInPeriod: number;
  avgTenureYears: number;
  byEmploymentType: Array<{ employmentType: string; count: number }>;
  byStore: Array<{ storeName: string; count: number }>;
}
interface EmploymentCostDto extends Period {
  totalGross: Money;
  totalEmployerStatutory: Money;
  totalCost: Money;
  totalNet: Money;
  payslipCount: number;
  monthly: Array<{ month: string; label: string; grossPay: Money; employerStatutory: Money; totalCost: Money; netPay: Money }>;
}
interface AbsenceDto extends Period {
  activeEmployees: number;
  byStatus: Array<{ status: string; days: number }>;
  absentDays: number;
  leaveDays: number;
  approvedLeaveRequestsDays: number;
  absenceRatePct: number;
  leaveRatePct: number;
  availableWorkingDays: number;
}
interface TurnoverDto extends Period {
  exits: number;
  hires: number;
  activeNow: number;
  annualisedTurnoverPct: number;
  avgTenureAtExitYears: number;
  perStoreExitCounts: Array<{ storeName: string; exits: number }>;
  exitRows: Array<{ employeeCode: string; jobTitle: string; employmentType: string; hireDate: string; terminationDate: string; tenureYears: number }>;
}
interface TimeToHireDto extends Period {
  convertedCount: number;
  medianDaysToHire: number;
  averageDaysToHire: number;
  rows: Array<{ jobTitle: string; appliedOn: string; acceptedOn: string | null; daysToHire: number | null }>;
}
interface StatutoryDto extends Period {
  totals: { paye: Money; nssf: Money; shif: Money; housingLevy: Money; payeArrears: Money; total: Money };
  monthly: Array<{ month: string; label: string; paye: Money; nssf: Money; shif: Money; housingLevy: Money; payeArrears: Money }>;
}
interface P10Dto {
  year: number;
  scope: string;
  rows: Array<{ employeeCode: string; employmentType: string; months: number; grossPay: Money; nssf: Money; shif: Money; housingLevy: Money; paye: Money; payeArrears: Money; netPay: Money }>;
  totals: { grossPay: Money; nssf: Money; shif: Money; housingLevy: Money; paye: Money; payeArrears: Money; netPay: Money };
  sourceRuns: number;
}
interface ErasureDto {
  canDecide: boolean;
  requests: Array<{
    id: string;
    employeeCode: string;
    employeeName: string;
    status: string;
    decision: string | null;
    legalBasis: string | null;
    retentionApplies: boolean;
    requestedAt: string;
    executedAt: string | null;
  }>;
}

const YEARS = [new Date().getUTCFullYear(), new Date().getUTCFullYear() - 1, new Date().getUTCFullYear() - 2];

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCSV(filename: string, header: string[], rows: unknown[][]): void {
  const csv = [header.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function HrReportsPage() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(() => new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [p10Year, setP10Year] = useState(String(new Date().getUTCFullYear()));

  const [headcount, setHeadcount] = useState<HeadcountDto | null>(null);
  const [cost, setCost] = useState<EmploymentCostDto | null>(null);
  const [absence, setAbsence] = useState<AbsenceDto | null>(null);
  const [turnover, setTurnover] = useState<TurnoverDto | null>(null);
  const [tth, setTth] = useState<TimeToHireDto | null>(null);
  const [statutory, setStatutory] = useState<StatutoryDto | null>(null);
  const [p10, setP10] = useState<P10Dto | null>(null);
  const [erasure, setErasure] = useState<ErasureDto | null>(null);

  const [hiddenCols, setHiddenCols] = useState<Record<string, boolean>>({});
  const [rejectTarget, setRejectTarget] = useState<ErasureDto['requests'][number] | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [rejectBasis, setRejectBasis] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const qs = `from=${new Date(from).toISOString()}&to=${new Date(`${to}T23:59:59.999Z`).toISOString()}`;
      const [h, c, a, t, g, s] = await Promise.all([
        apiGet<HeadcountDto>(`/api/hr/reports/headcount?${qs}`),
        apiGet<EmploymentCostDto>(`/api/hr/reports/employment-cost?${qs}`),
        apiGet<AbsenceDto>(`/api/hr/reports/absence?${qs}`),
        apiGet<TurnoverDto>(`/api/hr/reports/turnover?${qs}`),
        apiGet<TimeToHireDto>(`/api/hr/reports/time-to-hire?${qs}`),
        apiGet<StatutoryDto>(`/api/hr/reports/statutory-liability?${qs}`),
      ]);
      setHeadcount(h);
      setCost(c);
      setAbsence(a);
      setTurnover(t);
      setTth(g);
      setStatutory(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports.');
    } finally {
      setBusy(false);
    }
  }, [from, to]);

  const loadP10 = useCallback(async (year: string) => {
    setError('');
    try {
      setP10(await apiGet<P10Dto>(`/api/hr/reports/p10?year=${year}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load P10.');
      setP10(null);
    }
  }, []);

  const loadErasure = useCallback(async () => {
    try {
      setErasure(await apiGet<ErasureDto>('/api/hr/privacy/erasure-requests'));
    } catch {
      setErasure(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadP10(p10Year);
  }, [loadP10, p10Year]);
  useEffect(() => {
    void loadErasure();
  }, [loadErasure]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await loadErasure();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const toggleCol = (key: string) => setHiddenCols((prev) => ({ ...prev, [key]: !prev[key] }));

  const Stat = ({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warn' | 'good' }) => (
    <div className="rounded-xl border bg-card p-3.5 shadow-sm print:shadow-none">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-xl font-bold tabular-nums ${
          tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : ''
        }`}
      >
        {value}
      </p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );

  const TableToolbar = ({ columns, exportCsv }: { columns: Array<{ key: string; label: string }>; exportCsv: () => void }) => (
    <div className="mb-2 flex flex-wrap items-center justify-end gap-2 print:hidden">
      <Select
        value={columns.filter((c) => !hiddenCols[c.key]).length === columns.length ? 'all' : 'custom'}
        onValueChange={(v) => {
          if (v === 'all') setHiddenCols((prev) => ({ ...prev, ...Object.fromEntries(columns.map((c) => [c.key, false])) }));
        }}
      >
        <SelectTrigger className="h-8 w-44" aria-label="Column visibility">
          <Columns3 className="mr-1 h-3.5 w-3.5" aria-hidden /> Columns
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Show all columns</SelectItem>
          {columns.map((c) => (
            <div key={c.key} className="flex items-center gap-2 px-2 py-1.5">
              <Checkbox id={`col-${c.key}`} checked={!hiddenCols[c.key]} onCheckedChange={() => toggleCol(c.key)} />
              <Label htmlFor={`col-${c.key}`} className="cursor-pointer text-xs font-normal">
                {c.label}
              </Label>
            </div>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" onClick={exportCsv}>
        <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden /> CSV
      </Button>
      <Button size="sm" variant="outline" onClick={() => window.print()}>
        <Printer className="h-3.5 w-3.5" aria-hidden /> Print PDF
      </Button>
    </div>
  );

  const col = (key: string) => (hiddenCols[key] ? 'hidden' : '');

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <BarChart3 className="h-6 w-6 text-sky-500" aria-hidden /> HR reports
          </h1>
          <p className="text-sm text-muted-foreground">
            Aggregates only — no names or raw ids. P10 reproduces from stored posted payroll lines, never recomputed.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="rep-from" className="text-xs">From</Label>
            <Input id="rep-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rep-to" className="text-xs">To</Label>
            <Input id="rep-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40" />
          </div>
          <Button size="sm" onClick={() => void load()} disabled={busy}>
            Apply period
          </Button>
        </div>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      <Tabs defaultValue="headcount" className="space-y-4">
        <TabsList className="flex-wrap print:hidden">
          <TabsTrigger value="headcount">Headcount</TabsTrigger>
          <TabsTrigger value="cost">Employment cost</TabsTrigger>
          <TabsTrigger value="absence">Absence</TabsTrigger>
          <TabsTrigger value="turnover">Turnover</TabsTrigger>
          <TabsTrigger value="tth">Time to hire</TabsTrigger>
          <TabsTrigger value="statutory">Statutory</TabsTrigger>
          <TabsTrigger value="p10">P10</TabsTrigger>
          <TabsTrigger value="privacy">Privacy</TabsTrigger>
        </TabsList>

        {/* ── Headcount ── */}
        <TabsContent value="headcount" className="space-y-4">
          {!headcount ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <Stat label="Active" value={String(headcount.active)} tone="good" />
                <Stat label="On leave" value={String(headcount.onLeave)} />
                <Stat label="Suspended" value={String(headcount.suspended)} tone={headcount.suspended ? 'warn' : undefined} />
                <Stat label="Hires in period" value={String(headcount.hiresInPeriod)} />
                <Stat label="Exits in period" value={String(headcount.exitsInPeriod)} />
                <Stat label="Avg tenure" value={`${headcount.avgTenureYears}y`} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">By employment type</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader><TableRow><TableHead className="sticky top-0 bg-card">Type</TableHead><TableHead className="sticky top-0 bg-card text-right">Count</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {headcount.byEmploymentType.map((t) => (
                          <TableRow key={t.employmentType}><TableCell>{t.employmentType.toLowerCase()}</TableCell><TableCell className="text-right tabular-nums">{t.count}</TableCell></TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">By branch</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader><TableRow><TableHead className="sticky top-0 bg-card">Branch</TableHead><TableHead className="sticky top-0 bg-card text-right">Count</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {headcount.byStore.map((s) => (
                          <TableRow key={s.storeName}><TableCell>{s.storeName}</TableCell><TableCell className="text-right tabular-nums">{s.count}</TableCell></TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── Employment cost ── */}
        <TabsContent value="cost" className="space-y-4">
          {!cost ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Total gross" value={formatKes(cost.totalGross)} />
                <Stat label="Employer statutory" value={formatKes(cost.totalEmployerStatutory)} hint="NSSF + AHL employer match" />
                <Stat label="Total employment cost" value={formatKes(cost.totalCost)} tone="good" />
                <Stat label="Net paid" value={formatKes(cost.totalNet)} hint={`${cost.payslipCount} payslips`} />
              </div>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm"><Coins className="h-4 w-4 text-amber-500" aria-hidden /> Monthly cost</CardTitle>
                  <CardDescription>From posted payroll lines; employer match mirrors the engine.</CardDescription>
                </CardHeader>
                <CardContent>
                  <TableToolbar
                    columns={[
                      { key: 'label', label: 'Period' },
                      { key: 'gross', label: 'Gross' },
                      { key: 'er', label: 'Employer' },
                      { key: 'total', label: 'Total' },
                      { key: 'net', label: 'Net' },
                    ]}
                    exportCsv={() =>
                      downloadCSV(
                        `employment-cost-${from}-${to}.csv`,
                        ['Period', 'Gross (KES)', 'Employer statutory (KES)', 'Total cost (KES)', 'Net (KES)'],
                        cost.monthly.map((m) => [m.label, m.grossPay.toFixed(2), m.employerStatutory.toFixed(2), m.totalCost.toFixed(2), m.netPay.toFixed(2)]),
                      )
                    }
                  />
                  <div className="max-h-96 overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-card">
                        <TableRow>
                          <TableHead className={col('label')}>Period</TableHead>
                          <TableHead className={`text-right ${col('gross')}`}>Gross</TableHead>
                          <TableHead className={`text-right ${col('er')}`}>Employer statutory</TableHead>
                          <TableHead className={`text-right ${col('total')}`}>Total cost</TableHead>
                          <TableHead className={`text-right ${col('net')}`}>Net paid</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cost.monthly.map((m) => (
                          <TableRow key={m.month}>
                            <TableCell className={col('label')}>{m.label}</TableCell>
                            <TableCell className={`text-right tabular-nums ${col('gross')}`}>{formatKes(m.grossPay)}</TableCell>
                            <TableCell className={`text-right tabular-nums ${col('er')}`}>{formatKes(m.employerStatutory)}</TableCell>
                            <TableCell className={`text-right font-medium tabular-nums ${col('total')}`}>{formatKes(m.totalCost)}</TableCell>
                            <TableCell className={`text-right tabular-nums ${col('net')}`}>{formatKes(m.netPay)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── Absence ── */}
        <TabsContent value="absence" className="space-y-4">
          {!absence ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <Stat label="Absence rate" value={`${absence.absenceRatePct}%`} tone={absence.absenceRatePct >= 10 ? 'warn' : 'good'} hint="unscheduled, all recorded days" />
                <Stat label="Leave rate" value={`${absence.leaveRatePct}%`} />
                <Stat label="Absent days" value={String(absence.absentDays)} />
                <Stat label="Leave days recorded" value={String(absence.leaveDays)} />
                <Stat label="Approved leave (range)" value={`${absence.approvedLeaveRequestsDays}d`} hint={`${absence.activeEmployees} active employees`} />
              </div>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm"><CalendarX2 className="h-4 w-4 text-rose-500" aria-hidden /> Recorded days by status</CardTitle>
                </CardHeader>
                <CardContent>
                  <TableToolbar
                    columns={[{ key: 'status', label: 'Status' }, { key: 'days', label: 'Days' }, { key: 'share', label: 'Share' }]}
                    exportCsv={() =>
                      downloadCSV(
                        `absence-${from}-${to}.csv`,
                        ['Status', 'Days', 'Share %'],
                        absence.byStatus.map((s) => [s.status, s.days, shareOf(s.days, absence.byStatus)]),
                      )
                    }
                  />
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead className={`sticky top-0 bg-card ${col('status')}`}>Status</TableHead>
                      <TableHead className={`sticky top-0 bg-card text-right ${col('days')}`}>Days</TableHead>
                      <TableHead className={`sticky top-0 bg-card text-right ${col('share')}`}>Share</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {absence.byStatus.map((s) => (
                        <TableRow key={s.status}>
                          <TableCell className={col('status')}><StatusBadge status={s.status} /></TableCell>
                          <TableCell className={`text-right tabular-nums ${col('days')}`}>{s.days}</TableCell>
                          <TableCell className={`text-right tabular-nums ${col('share')}`}>{shareOf(s.days, absence.byStatus)}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── Turnover ── */}
        <TabsContent value="turnover" className="space-y-4">
          {!turnover ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Exits in period" value={String(turnover.exits)} tone={turnover.exits ? 'warn' : 'good'} />
                <Stat label="Hires in period" value={String(turnover.hires)} />
                <Stat label="Annualised turnover" value={`${turnover.annualisedTurnoverPct}%`} />
                <Stat label="Avg tenure at exit" value={`${turnover.avgTenureAtExitYears}y`} />
              </div>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm"><DoorOpen className="h-4 w-4 text-rose-500" aria-hidden /> Exit register</CardTitle>
                  <CardDescription>employeeCode + job title only — no names, no raw ids.</CardDescription>
                </CardHeader>
                <CardContent>
                  <TableToolbar
                    columns={[
                      { key: 'code', label: 'Code' }, { key: 'title', label: 'Title' }, { key: 'type', label: 'Type' },
                      { key: 'hired', label: 'Hired' }, { key: 'left', label: 'Left' }, { key: 'tenure', label: 'Tenure' },
                    ]}
                    exportCsv={() =>
                      downloadCSV(
                        `turnover-${from}-${to}.csv`,
                        ['Employee code', 'Job title', 'Type', 'Hired', 'Left', 'Tenure (y)'],
                        turnover.exitRows.map((r) => [r.employeeCode, r.jobTitle, r.employmentType, formatDate(r.hireDate), formatDate(r.terminationDate), r.tenureYears]),
                      )
                    }
                  />
                  <div className="max-h-96 overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
                        <TableHead className={col('code')}>Code</TableHead>
                        <TableHead className={col('title')}>Title</TableHead>
                        <TableHead className={col('type')}>Type</TableHead>
                        <TableHead className={col('hired')}>Hired</TableHead>
                        <TableHead className={col('left')}>Left</TableHead>
                        <TableHead className={`text-right ${col('tenure')}`}>Tenure</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {turnover.exitRows.length === 0 ? (
                          <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">No exits in this period.</TableCell></TableRow>
                        ) : (
                          turnover.exitRows.map((r) => (
                            <TableRow key={`${r.employeeCode}-${r.terminationDate}`}>
                              <TableCell className={`font-mono text-xs ${col('code')}`}>{r.employeeCode}</TableCell>
                              <TableCell className={col('title')}>{r.jobTitle}</TableCell>
                              <TableCell className={col('type')}>{r.employmentType.toLowerCase()}</TableCell>
                              <TableCell className={col('hired')}>{formatDate(r.hireDate)}</TableCell>
                              <TableCell className={col('left')}>{formatDate(r.terminationDate)}</TableCell>
                              <TableCell className={`text-right tabular-nums ${col('tenure')}`}>{r.tenureYears}y</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── Time to hire ── */}
        <TabsContent value="tth" className="space-y-4">
          {!tth ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Stat label="Converted hires" value={String(tth.convertedCount)} tone="good" />
                <Stat label="Median days to hire" value={`${tth.medianDaysToHire}d`} />
                <Stat label="Average days to hire" value={`${tth.averageDaysToHire}d`} />
              </div>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm"><Hourglass className="h-4 w-4 text-sky-500" aria-hidden /> Pipeline (applied → offer accepted)</CardTitle>
                </CardHeader>
                <CardContent>
                  <TableToolbar
                    columns={[{ key: 'job', label: 'Position' }, { key: 'applied', label: 'Applied' }, { key: 'accepted', label: 'Accepted' }, { key: 'days', label: 'Days' }]}
                    exportCsv={() =>
                      downloadCSV(
                        `time-to-hire-${from}-${to}.csv`,
                        ['Position', 'Applied', 'Accepted', 'Days'],
                        tth.rows.map((r) => [r.jobTitle, formatDate(r.appliedOn), r.acceptedOn ? formatDate(r.acceptedOn) : '—', r.daysToHire ?? '']),
                      )
                    }
                  />
                  <div className="max-h-96 overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
                        <TableHead className={col('job')}>Position</TableHead>
                        <TableHead className={col('applied')}>Applied</TableHead>
                        <TableHead className={col('accepted')}>Accepted</TableHead>
                        <TableHead className={`text-right ${col('days')}`}>Days</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {tth.rows.length === 0 ? (
                          <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">No converted applicants in this period.</TableCell></TableRow>
                        ) : (
                          tth.rows.map((r, i) => (
                            <TableRow key={`${r.jobTitle}-${i}`}>
                              <TableCell className={col('job')}>{r.jobTitle}</TableCell>
                              <TableCell className={col('applied')}>{formatDate(r.appliedOn)}</TableCell>
                              <TableCell className={col('accepted')}>{r.acceptedOn ? formatDate(r.acceptedOn) : '—'}</TableCell>
                              <TableCell className={`text-right tabular-nums ${col('days')}`}>{r.daysToHire ?? '—'}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── Statutory liability ── */}
        <TabsContent value="statutory" className="space-y-4">
          {!statutory ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <Stat label="PAYE" value={formatKes(statutory.totals.paye)} />
                <Stat label="NSSF" value={formatKes(statutory.totals.nssf)} />
                <Stat label="SHIF" value={formatKes(statutory.totals.shif)} />
                <Stat label="Housing levy" value={formatKes(statutory.totals.housingLevy)} />
                <Stat label="PAYE arrears" value={formatKes(statutory.totals.payeArrears)} />
                <Stat label="Total" value={formatKes(statutory.totals.total)} tone="good" />
              </div>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm"><Landmark className="h-4 w-4 text-emerald-600" aria-hidden /> Monthly statutory figures</CardTitle>
                  <CardDescription>From posted payroll lines — the journal entries already carry these.</CardDescription>
                </CardHeader>
                <CardContent>
                  <TableToolbar
                    columns={[
                      { key: 'label', label: 'Period' }, { key: 'paye', label: 'PAYE' }, { key: 'nssf', label: 'NSSF' },
                      { key: 'shif', label: 'SHIF' }, { key: 'ahl', label: 'Housing levy' }, { key: 'arr', label: 'Arrears' },
                    ]}
                    exportCsv={() =>
                      downloadCSV(
                        `statutory-liability-${from}-${to}.csv`,
                        ['Period', 'PAYE (KES)', 'NSSF (KES)', 'SHIF (KES)', 'Housing levy (KES)', 'PAYE arrears (KES)'],
                        statutory.monthly.map((m) => [m.label, m.paye.toFixed(2), m.nssf.toFixed(2), m.shif.toFixed(2), m.housingLevy.toFixed(2), m.payeArrears.toFixed(2)]),
                      )
                    }
                  />
                  <div className="max-h-96 overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
                        <TableHead className={col('label')}>Period</TableHead>
                        <TableHead className={`text-right ${col('paye')}`}>PAYE</TableHead>
                        <TableHead className={`text-right ${col('nssf')}`}>NSSF</TableHead>
                        <TableHead className={`text-right ${col('shif')}`}>SHIF</TableHead>
                        <TableHead className={`text-right ${col('ahl')}`}>Housing levy</TableHead>
                        <TableHead className={`text-right ${col('arr')}`}>Arrears</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {statutory.monthly.map((m) => (
                          <TableRow key={m.month}>
                            <TableCell className={col('label')}>{m.label}</TableCell>
                            <TableCell className={`text-right tabular-nums ${col('paye')}`}>{formatKes(m.paye)}</TableCell>
                            <TableCell className={`text-right tabular-nums ${col('nssf')}`}>{formatKes(m.nssf)}</TableCell>
                            <TableCell className={`text-right tabular-nums ${col('shif')}`}>{formatKes(m.shif)}</TableCell>
                            <TableCell className={`text-right tabular-nums ${col('ahl')}`}>{formatKes(m.housingLevy)}</TableCell>
                            <TableCell className={`text-right tabular-nums ${col('arr')}`}>{formatKes(m.payeArrears)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── P10 ── */}
        <TabsContent value="p10" className="space-y-4">
          <div className="flex flex-wrap items-end gap-2 print:hidden">
            <div className="space-y-1">
              <Label htmlFor="p10-year" className="text-xs">Tax year</Label>
              <Select value={p10Year} onValueChange={setP10Year}>
                <SelectTrigger id="p10-year" className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" onClick={() => window.open(`/api/hr/reports/p10?year=${p10Year}&format=csv`, '_blank')}>
              <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden /> Download CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" aria-hidden /> Print PDF
            </Button>
          </div>
          {!p10 ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">P10 register {p10.year}</CardTitle>
                <CardDescription>
                  {p10.rows.length} employees from {p10.sourceRuns} posted runs. Every figure is a stored payroll line — the register reproduces exactly.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
                      <TableHead>Code</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Months</TableHead>
                      <TableHead className="text-right">Gross</TableHead><TableHead className="text-right">NSSF</TableHead>
                      <TableHead className="text-right">SHIF</TableHead><TableHead className="text-right">Housing levy</TableHead>
                      <TableHead className="text-right">PAYE</TableHead><TableHead className="text-right">Net</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {p10.rows.map((r) => (
                        <TableRow key={r.employeeCode}>
                          <TableCell className="font-mono text-xs">{r.employeeCode}</TableCell>
                          <TableCell>{r.employmentType.toLowerCase()}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.months}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatKes(r.grossPay)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatKes(r.nssf)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatKes(r.shif)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatKes(r.housingLevy)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatKes(r.paye)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatKes(r.netPay)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-semibold">
                        <TableCell colSpan={3}>TOTAL</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKes(p10.totals.grossPay)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKes(p10.totals.nssf)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKes(p10.totals.shif)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKes(p10.totals.housingLevy)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKes(p10.totals.paye)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatKes(p10.totals.netPay)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Privacy / erasure ── */}
        <TabsContent value="privacy" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden /> Erasure requests (Data Protection Act posture)
              </CardTitle>
              <CardDescription>
                Non-statutory personal data is erased; payroll and audit records stay under statutory retention with the decision and legal basis recorded.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!erasure ? (
                <Skeleton className="h-28 w-full" />
              ) : erasure.requests.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No erasure requests.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Employee</TableHead><TableHead>Status</TableHead><TableHead>Requested</TableHead>
                    <TableHead>Decision</TableHead><TableHead className="text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {erasure.requests.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium">{r.employeeCode}</div>
                          <div className="text-xs text-muted-foreground">{r.employeeName}</div>
                        </TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(r.requestedAt)}</TableCell>
                        <TableCell className="max-w-72">
                          <p className="truncate text-xs" title={r.decision ?? ''}>{r.decision ?? '—'}</p>
                          {r.legalBasis ? <p className="truncate text-[11px] text-muted-foreground" title={r.legalBasis}>{r.legalBasis}</p> : null}
                        </TableCell>
                        <TableCell className="text-right">
                          {r.status === 'PENDING' && erasure.canDecide ? (
                            <div className="flex justify-end gap-1.5">
                              <Button size="sm" disabled={busy} onClick={() => void run(() => apiSend(`/api/hr/privacy/erasure-requests/${r.id}/execute`, 'POST', { notes: 'Erased non-statutory personal data.' }))}>
                                Execute
                              </Button>
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => { setRejectTarget(r); setRejectNotes(''); setRejectBasis(''); }}>
                                Reject…
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">{r.retentionApplies ? 'statutory retention' : '—'}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Reject dialog */}
      <Dialog open={rejectTarget !== null} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject erasure request — {rejectTarget?.employeeCode}</DialogTitle>
            <DialogDescription>Both the decision reason and the legal basis are mandatory and recorded.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rej-notes">Decision reason (min 10 chars)</Label>
              <Textarea id="rej-notes" rows={3} value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rej-basis">Legal basis</Label>
              <Input id="rej-basis" value={rejectBasis} onChange={(e) => setRejectBasis(e.target.value)} placeholder="e.g. Employment Act s.74 payroll retention" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={busy || rejectNotes.trim().length < 10 || rejectBasis.trim().length < 5}
              onClick={() =>
                void run(async () => {
                  await apiSend(`/api/hr/privacy/erasure-requests/${rejectTarget!.id}/reject`, 'POST', { notes: rejectNotes, legalBasis: rejectBasis });
                  setRejectTarget(null);
                })
              }
            >
              Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function shareOf(days: number, byStatus: Array<{ status: string; days: number }>): string {
  const total = byStatus.reduce((a, x) => a + x.days, 0);
  return total ? ((days / total) * 100).toFixed(1) : '0.0';
}
