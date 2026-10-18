'use client';

// MBUMAH HARDWARE POS - /hr/employees (v2.113.0, EMS workspace)
//
// WHY THIS PAGE EXISTS: the HR workspace nav has pointed "Employees" at
// /hr/employees since v2.18.x, but the route itself never shipped — every
// click landed on a 404 (found in QA this round). This is the list: search,
// status, and an expiring-documents filter, deep-linkable so the People &
// Payroll panel's expiry-alerts door can land here pre-filtered
// (/hr/employees?expiring=90&storeId=<id>).
//
// SCOPE (fail-closed): the server resolves the store — session store for
// branch-scoped roles; an explicit storeId only for ORG-scope roles whose
// organization owns it (the same scope model the org summary serves). The
// page renders what the answer says: if rows come back from a different
// store than the link asked for, an honest notice says so — never a silent
// wrong-branch table.
//
// PII: the list payload is the summaries contract (no statutory identifiers,
// no document contents — expiring counts + a nearest-expiry date only).

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  CalendarClock,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { ErrorNote, StatusBadge, formatDate } from '@/components/hr/self-service-ui';
import { describeOnboardConsent, ONBOARD_CONSENT_TONE_CLASSES } from '@/lib/hr/onboard-consent';

interface EmployeeRow {
  id: string;
  employeeCode: string | null;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  employmentType: string;
  status: string;
  hireDate: string;
  storeId: string;
  storeName?: string;
  expiringDocuments?: number;
  nearestExpiry?: string | null;
}

const STATUS_OPTIONS = ['ALL', 'ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED'] as const;

// v2.120.0: the onboarding form's employment types — the schema vocabulary
// (prisma Employee.employmentType), exactly as the API stores it. No client
// invention: an invented type would silently render "undefined" badges.
const EMPLOYMENT_TYPES = ['PERMANENT', 'CONTRACT', 'CASUAL', 'PROBATION', 'INTERN'] as const;

function readParam(name: string): string {
  try {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get(name)?.trim() ?? '';
  } catch {
    return '';
  }
}

function mirrorFiltersToUrl(q: string, status: string, expiringOnly: boolean, expiringDays: string) {
  try {
    const sp = new URLSearchParams(window.location.search);
    if (q) sp.set('q', q);
    else sp.delete('q');
    if (status && status !== 'ALL') sp.set('status', status);
    else sp.delete('status');
    if (expiringOnly && expiringDays) sp.set('expiring', expiringDays);
    else sp.delete('expiring');
    const qs = sp.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  } catch {
    // no URL surface — the filters still work, they just cannot be shared
  }
}

export default function EmployeesPage() {
  // v2.113.0: deep-link seeds (lazy initializers — no setState-in-effect).
  // storeId is scope the SERVER decides (this page passes it through
  // verbatim; the API honors it only for org-scope roles whose organization
  // owns the store — everyone else silently keeps their own store and the
  // notice below says so).
  const [linkStoreId] = useState(() => readParam('storeId'));
  const [linkExpiring] = useState(() => readParam('expiring'));
  const [linkQuery] = useState(() => readParam('q'));
  const [linkStatus] = useState(() => readParam('status'));

  const [search, setSearch] = useState(linkQuery);
  const [debouncedQ, setDebouncedQ] = useState(linkQuery);
  const [status, setStatus] = useState(
    STATUS_OPTIONS.includes(linkStatus as (typeof STATUS_OPTIONS)[number]) ? linkStatus : 'ALL',
  );
  const [expiringOnly, setExpiringOnly] = useState(linkExpiring !== '');
  const [rows, setRows] = useState<EmployeeRow[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  // The "(from link)" hint retires on the user's first filter touch — the
  // same honesty the People & Payroll panel's branch filter rides on.
  const [userTouched, setUserTouched] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (linkStoreId) params.set('storeId', linkStoreId);
      if (expiringOnly) params.set('expiring', linkExpiring || '90');
      if (status !== 'ALL') params.set('status', status);
      if (debouncedQ) params.set('q', debouncedQ);
      const qs = params.toString();
      // v2.120.0: raw fetch (apiGet unwraps `data` only) — the list response
      // also carries canCreate, the server's answer to "may this role
      // onboard?" (the same hr.employee.create key the POST guard pins).
      const res = await fetch(`/api/hr/employees${qs ? `?${qs}` : ''}`, { credentials: 'include' });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: EmployeeRow[];
        canCreate?: boolean;
        error?: string;
      };
      if (!res.ok || !json.success) throw new Error(json.error || `Request failed (${res.status})`);
      setRows(json.data ?? []);
      setCanCreate(json.canCreate === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The employees list is unreachable. Try refreshing.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [linkStoreId, linkExpiring, expiringOnly, status, debouncedQ]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  useEffect(() => {
    mirrorFiltersToUrl(debouncedQ, status, expiringOnly, linkExpiring || '90');
  }, [debouncedQ, status, expiringOnly, linkExpiring]);

  const storeMismatch =
    !loading && !error && !!linkStoreId && rows != null && rows.length > 0 && rows[0].storeId !== linkStoreId;

  const clearFilters = () => {
    setUserTouched(true);
    setSearch('');
    setDebouncedQ('');
    setStatus('ALL');
    setExpiringOnly(false);
  };

  const activeFilters = (debouncedQ ? 1 : 0) + (status !== 'ALL' ? 1 : 0) + (expiringOnly ? 1 : 0);

  // ── Onboarding (v2.120.0) ────────────────────────────────────────────────
  // The server decides who sees this door (GET canCreate); the dialog files
  // the hire and — when ticked — the payroll consent the new hire signed,
  // through the same audited grant the Privacy tab uses.
  const [canCreate, setCanCreate] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [obFirst, setObFirst] = useState('');
  const [obLast, setObLast] = useState('');
  const [obTitle, setObTitle] = useState('');
  const [obType, setObType] = useState<string>('PERMANENT');
  const [obHireDate, setObHireDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [obPhone, setObPhone] = useState('');
  const [obSalary, setObSalary] = useState('');
  const [obConsent, setObConsent] = useState(false);
  const [obBusy, setObBusy] = useState(false);
  const [obError, setObError] = useState('');
  const [obResult, setObResult] = useState<{
    id: string;
    name: string;
    code: string | null;
    consent: unknown;
  } | null>(null);

  const resetOnboardForm = () => {
    setObFirst('');
    setObLast('');
    setObTitle('');
    setObType('PERMANENT');
    setObHireDate(new Date().toISOString().slice(0, 10));
    setObPhone('');
    setObSalary('');
    setObConsent(false);
    setObError('');
    setObResult(null);
  };

  const submitOnboard = async () => {
    if (!obFirst.trim() || !obLast.trim()) {
      setObError('First name and last name are required.');
      return;
    }
    setObBusy(true);
    setObError('');
    try {
      // Raw fetch: the POST response's consent + id live OUTSIDE data, and
      // apiSend unwraps data only. Content-Type is declared explicitly (the
      // proxy rejects a body-less content type, v2.24.0 contract).
      const res = await fetch('/api/hr/employees', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: obFirst.trim(),
          lastName: obLast.trim(),
          jobTitle: obTitle.trim() || undefined,
          employmentType: obType,
          hireDate: obHireDate || undefined,
          phone: obPhone.trim() || undefined,
          basicSalary: obSalary.trim() === '' ? undefined : Number(obSalary),
          consentPayrollProcessing: obConsent,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        data?: { firstName?: string; lastName?: string; employeeCode?: string | null };
        id?: string;
        consent?: unknown;
        error?: string;
      };
      if (!res.ok || !json.success || !json.id) {
        throw new Error(json.error || `Request failed (${res.status})`);
      }
      setObResult({
        id: json.id,
        name: `${json.data?.firstName ?? obFirst.trim()} ${json.data?.lastName ?? obLast.trim()}`.trim(),
        code: json.data?.employeeCode ?? null,
        consent: json.consent,
      });
      setReloadKey((k) => k + 1);
    } catch (e) {
      setObError(e instanceof Error ? e.message : 'Unable to onboard this employee. Try again.');
    } finally {
      setObBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="hr-employees-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
            <Users className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Employees</h1>
            <p className="text-xs text-muted-foreground">
              The branch roster — search, filter, and follow the expiring-document trail. Summaries only; open a
              record for detail.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Button
              size="sm"
              onClick={() => {
                resetOnboardForm();
                setOnboardOpen(true);
              }}
              data-testid="hr-employees-onboard-open"
            >
              <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Onboard employee
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
            aria-label="Refresh employees list"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div
        className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60"
        data-testid="hr-employees-filter-row"
      >
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => {
              setUserTouched(true);
              setSearch(e.target.value);
            }}
            placeholder="Search name, code, or job title"
            aria-label="Search employees"
            className="h-8 pl-8 text-sm"
            data-testid="hr-employees-search"
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => {
            setUserTouched(true);
            setStatus(v);
          }}
        >
          <SelectTrigger className="h-8 w-[150px] text-sm" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'ALL' ? 'All statuses' : s.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => {
            setUserTouched(true);
            setExpiringOnly((v) => !v);
          }}
          aria-pressed={expiringOnly}
          data-testid="hr-employees-expiring-toggle"
          className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
            expiringOnly
              ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
          }`}
          title="Show only employees with documents expiring within the window"
        >
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          Expiring docs
          {expiringOnly && linkExpiring && !userTouched && (
            <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
              from link
            </span>
          )}
        </button>
        {activeFilters > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            data-testid="hr-employees-clear"
            className="rounded-md px-2 py-1 text-xs font-medium text-orange-600 underline-offset-2 transition-colors hover:bg-orange-50 hover:underline dark:text-orange-400 dark:hover:bg-orange-950/40"
          >
            Clear filters ({activeFilters})
          </button>
        )}
        {!loading && rows && (
          <span className="ml-auto text-xs text-slate-400 dark:text-slate-500" data-testid="hr-employees-count">
            {rows.length} {rows.length === 1 ? 'employee' : 'employees'}
          </span>
        )}
      </div>

      {storeMismatch && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300" role="status">
          You asked for a specific branch&rsquo;s roster; this session&rsquo;s scope resolved to{' '}
          <strong>{rows?.[0]?.storeName ?? 'your store'}</strong> instead. Switch your active branch to see the
          requested one — the server never widens scope on request alone.
        </div>
      )}

      {error ? (
        <ErrorNote message={error} />
      ) : loading ? (
        <div className="space-y-2" role="status" aria-label="Loading employees">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rows && rows.length > 0 ? (
        <>
          {/* Desktop table */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/60 dark:bg-slate-900/60">
                    <TableHead>Employee</TableHead>
                    <TableHead>Job title</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Hired</TableHead>
                    <TableHead className="text-right">Expiring docs</TableHead>
                    <TableHead className="w-10" aria-label="Open record" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} data-testid="hr-employees-row" className="transition-colors">
                      <TableCell>
                        <a
                          href={`/hr/employees/${r.id}`}
                          className="font-medium text-foreground underline-offset-2 hover:text-amber-700 hover:underline dark:hover:text-amber-400"
                        >
                          {r.firstName} {r.lastName}
                        </a>
                        {r.employeeCode && (
                          <span className="ml-2 font-mono text-[10px] text-slate-400 dark:text-slate-500">{r.employeeCode}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.jobTitle || '—'}</TableCell>
                      <TableCell>
                        <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">
                          {r.employmentType.toLowerCase()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(r.hireDate)}</TableCell>
                      <TableCell className="text-right">
                        {r.expiringDocuments != null && r.expiringDocuments > 0 ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400"
                            title={r.nearestExpiry ? `Nearest expiry ${formatDate(r.nearestExpiry)}` : undefined}
                          >
                            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                            {r.expiringDocuments}
                            {r.nearestExpiry && (
                              <span className="font-normal text-muted-foreground">· {formatDate(r.nearestExpiry)}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <a
                          href={`/hr/employees/${r.id}`}
                          aria-label={`Open ${r.firstName} ${r.lastName}'s record`}
                          className="inline-flex rounded-md p-1 text-slate-400 transition-colors hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 dark:hover:text-amber-400"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden" data-testid="hr-employees-cards">
            {rows.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-slate-200 p-3 transition-shadow hover:shadow-sm dark:border-slate-800"
                data-testid="hr-employees-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={`/hr/employees/${r.id}`}
                    className="min-w-0 truncate text-sm font-semibold text-foreground underline-offset-2 hover:text-amber-700 hover:underline dark:hover:text-amber-400"
                  >
                    {r.firstName} {r.lastName}
                  </a>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {r.jobTitle || 'No job title'} · {r.employmentType.toLowerCase()}
                  {r.employeeCode ? ` · ${r.employeeCode}` : ''}
                </p>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">hired {formatDate(r.hireDate)}</span>
                  {r.expiringDocuments != null && r.expiringDocuments > 0 ? (
                    <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                      {r.expiringDocuments} expiring
                      {r.nearestExpiry ? ` · ${formatDate(r.nearestExpiry)}` : ''}
                    </span>
                  ) : (
                    <span className="text-slate-400 dark:text-slate-500">no expiring docs</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Users className="h-6 w-6 text-slate-300 dark:text-slate-600" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">
              {expiringOnly
                ? `No employees have documents expiring within ${linkExpiring || '90'} days here.`
                : debouncedQ || status !== 'ALL'
                  ? 'No employees match these filters.'
                  : 'No employees yet for this store context.'}
            </p>
            <p className="max-w-md text-xs text-muted-foreground">
              {expiringOnly
                ? 'The window counts documents whose expiry date falls between today and the horizon — the same definition the People & Payroll panel rides on.'
                : 'Try widening the filters, or add employee records from this workspace.'}
            </p>
            {activeFilters > 0 && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Onboarding dialog (v2.120.0): the hire AND the consent they signed. */}
      <Dialog
        open={onboardOpen}
        onOpenChange={(o) => {
          setOnboardOpen(o);
          if (!o) setObResult(null);
        }}
      >
        <DialogContent className="sm:max-w-lg" data-testid="hr-employees-onboard-dialog">
          {obResult ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                    <UserCheck className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <DialogTitle className="text-base">New hire on file</DialogTitle>
                </div>
                <DialogDescription>
                  {obResult.name}
                  {obResult.code && (
                    <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {obResult.code}
                    </span>
                  )}{' '}
                  now sits in the branch roster.
                </DialogDescription>
              </DialogHeader>
              {(() => {
                const outcome = describeOnboardConsent(obResult.consent);
                return (
                  <div
                    className={`rounded-xl border p-3 ${ONBOARD_CONSENT_TONE_CLASSES[outcome.tone]}`}
                    data-testid="hr-employees-onboard-consent-outcome"
                    role="status"
                  >
                    <p className="text-sm font-semibold">{outcome.headline}</p>
                    <p className="mt-0.5 text-xs leading-relaxed opacity-80">{outcome.detail}</p>
                  </div>
                );
              })()}
              <DialogFooter className="gap-2">
                <a
                  href={`/hr/employees/${obResult.id}`}
                  className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-sm font-medium transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  Open record
                </a>
                <Button variant="outline" size="sm" onClick={() => resetOnboardForm()}>
                  Onboard another
                </Button>
                <Button size="sm" onClick={() => setOnboardOpen(false)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Onboard an employee</DialogTitle>
                <DialogDescription>
                  A new hire joins this branch&rsquo;s roster. Only the name is required — everything else can
                  mature on the record.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="ob-first" className="text-xs font-medium text-muted-foreground">
                    First name *
                  </label>
                  <Input
                    id="ob-first"
                    value={obFirst}
                    onChange={(e) => setObFirst(e.target.value)}
                    className="h-8 text-sm"
                    autoFocus
                    data-testid="hr-employees-onboard-first"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="ob-last" className="text-xs font-medium text-muted-foreground">
                    Last name *
                  </label>
                  <Input
                    id="ob-last"
                    value={obLast}
                    onChange={(e) => setObLast(e.target.value)}
                    className="h-8 text-sm"
                    data-testid="hr-employees-onboard-last"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="ob-title" className="text-xs font-medium text-muted-foreground">
                    Job title
                  </label>
                  <Input
                    id="ob-title"
                    value={obTitle}
                    onChange={(e) => setObTitle(e.target.value)}
                    className="h-8 text-sm"
                    data-testid="hr-employees-onboard-title"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="ob-phone" className="text-xs font-medium text-muted-foreground">
                    Phone
                  </label>
                  <Input
                    id="ob-phone"
                    value={obPhone}
                    onChange={(e) => setObPhone(e.target.value)}
                    className="h-8 text-sm"
                    data-testid="hr-employees-onboard-phone"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="ob-hire" className="text-xs font-medium text-muted-foreground">
                    Hire date
                  </label>
                  <Input
                    id="ob-hire"
                    type="date"
                    value={obHireDate}
                    onChange={(e) => setObHireDate(e.target.value)}
                    className="h-8 text-sm"
                    data-testid="hr-employees-onboard-hire-date"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="ob-salary" className="text-xs font-medium text-muted-foreground">
                    Basic salary (KES)
                  </label>
                  <Input
                    id="ob-salary"
                    type="number"
                    min={0}
                    value={obSalary}
                    onChange={(e) => setObSalary(e.target.value)}
                    className="h-8 text-sm"
                    data-testid="hr-employees-onboard-salary"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Employment type</label>
                  <Select value={obType} onValueChange={(v) => setObType(v)}>
                    <SelectTrigger
                      className="h-8 text-sm"
                      aria-label="Employment type"
                      data-testid="hr-employees-onboard-type"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EMPLOYMENT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t.replace(/_/g, ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {/* The consent capture panel — this round's reason to exist. */}
              <div
                className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/40"
                data-testid="hr-employees-onboard-consent-panel"
              >
                <div className="flex items-start gap-2.5">
                  <ShieldCheck
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                      Payroll-processing consent
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-emerald-800/80 dark:text-emerald-300/80">
                      Purpose <span className="font-mono text-[10px]">PAYROLL_PROCESSING</span> · lawful basis
                      CONSENT · policy{' '}
                      <span className="rounded bg-emerald-100 px-1 font-mono text-[10px] font-semibold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                        hr-policy-2026-01
                      </span>
                    </p>
                    <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-emerald-900 dark:text-emerald-200">
                      <input
                        type="checkbox"
                        checked={obConsent}
                        onChange={(e) => setObConsent(e.target.checked)}
                        data-testid="hr-employees-onboard-consent-checkbox"
                        aria-label="File the employee's signed payroll-processing consent"
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-emerald-600"
                      />
                      <span>
                        The employee signed the payroll consent form during hiring — file it now so their first
                        run never blocks on MISSING_CONSENT.
                      </span>
                    </label>
                  </div>
                </div>
              </div>
              {obError && (
                <p
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                  role="alert"
                  data-testid="hr-employees-onboard-error"
                >
                  {obError}
                </p>
              )}
              <DialogFooter className="gap-2">
                <Button variant="outline" size="sm" onClick={() => setOnboardOpen(false)} disabled={obBusy}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => void submitOnboard()}
                  disabled={obBusy}
                  data-testid="hr-employees-onboard-submit"
                >
                  {obBusy ? 'Onboarding…' : 'Onboard employee'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
