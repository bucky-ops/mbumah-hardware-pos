'use client';

// MBUMAH HARDWARE POS - Organization console (v2.16.0 subdomain workspaces)
//
// Root-domain, organization-wide view for SUPER_ADMIN / STORE_OWNER (full)
// and ACCOUNTANT (read-only financial aggregates). Data: GET /api/org/summary.
// Every "Open workspace" action opens the branch in a NEW TAB (subdomain URL
// when subdomain mode is safe on the current host, /stores/{slug}/... path
// URL otherwise). Links are built by the safe v2.18.0.0 builder; when no
// safe URL exists (missing slug) a calm inline message replaces the button
// instead of opening a broken placeholder (/stores/<undefined>) tab.

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Building2,
  CalendarClock,
  ChevronDown,
  CircleDollarSign,
  Clock,
  Download,
  LayoutDashboard,
  MessagesSquare,
  PackageOpen,
  ReceiptText,
  RefreshCw,
  ShieldAlert,
  Timer,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoginScreen } from '@/components/login-screen';
import { ErrorBoundary } from '@/components/error-boundary';
import { UnifiedConsoleShell } from '@/components/console/unified-console';
import { useAuthStore } from '@/lib/stores';
import { authorizedFetchJson } from '@/lib/api';
// v2.165.0: the Automation pulse's "Last tick" line gains the exact EAT
// stamp as its tooltip - the same stamp format the payroll surfaces speak
// (payslip-bundle is client-safe: it imports only csvCell from digest-csv).
import { formatEatStamp } from '@/lib/hr/payroll/payslip-bundle';
import { ORG_SUMMARY_ROLES } from '@/lib/app-config';
import { buildPeoplePayrollDeepLink } from '@/lib/workspace/links';
import { buildBranchesCsv, type BranchDeskCsvBlock } from '@/lib/org/branches-csv';
// Type-only import: erased at compile time, so the server-only diagnostics
// data layer never enters the client bundle.
import type { BranchDiagnostic } from '@/lib/org/diagnostics';
import {
  getWorkspaceUnavailableReason,
  isLocalWorkspaceHost,
  resolveBranchWorkspace,
  type WorkspaceUnavailableReason,
} from '@/lib/branch-workspace';
import { useWorkspaceAuthBoot } from '@/lib/workspace/workspace-store';
import { useWorkspaceStore, type WorkspaceStoreRef } from '@/lib/workspace/workspace-store';

interface OrgSummaryStore extends WorkspaceStoreRef {
  code: string | null;
  location: string | null;
  phone: string | null;
  status: string;
  todayRevenue: number;
  todayTransactions: number;
  lowStockCount: number;
  overdueRentals: number;
  debtOutstanding: number;
  debtCount: number;
  pendingMpesa: number;
}

interface OrgSummary {
  generatedAt: string;
  totals: {
    revenue: number;
    transactions: number;
    lowStock: number;
    overdueRentals: number;
    debtOutstanding: number;
    pendingMpesa: number;
  };
  stores: OrgSummaryStore[];
  hr: {
    scope: string;
    headcountActive: number;
    monthEmploymentCost: number;
    monthAbsenceRatePct: number;
    latestPayroll: { periodName: string; status: string; createdAt: string } | null;
    expiryAlerts: { documentsExpiring90Days: number; assetsOverdue: number };
  } | null;
  /** v2.23.0: per-branch drill-down rows (ORG scope only; null otherwise). */
  hrPerStore:
    | Array<{
        storeId: string;
        storeName: string;
        headcountActive: number;
        monthEmploymentCost: number;
        monthAbsenceRatePct: number;
        latestPayroll: { periodName: string; status: string; createdAt: string } | null;
        expiryAlerts: { documentsExpiring90Days: number; assetsOverdue: number };
      }>
    | null;
  recentAudit: Array<{
    id: string;
    storeId: string | null;
    entityType: string;
    entityId: string;
    action: string;
    userId: string | null;
    timestamp: string;
  }>;
}

/**
 * Precise, calm badge for a branch whose workspace link cannot be built
 * (v2.18.3.0). Replaces the generic "Branch workspace unavailable" message
 * with the exact reason and a remediation hint in the tooltip. Text always
 * carries the meaning; color never does (accessibility).
 */
const WORKSPACE_REASON_LABELS: Record<WorkspaceUnavailableReason, string> = {
  'missing-slug': 'Missing branch slug',
  'store-inactive': 'Branch inactive',
  'workspace-disabled': 'Workspace disabled',
};

const WORKSPACE_REASON_HINTS: Record<WorkspaceUnavailableReason, string> = {
  'missing-slug':
    'This branch has no URL slug configured yet. Run the slug backfill (npm run db:backfill-slugs) or set the slug on the store record, then refresh diagnostics.',
  'store-inactive':
    'This branch is currently inactive, so its workspace cannot be opened. Reactivate the store record to restore access.',
  'workspace-disabled':
    'Branch workspace routing is disabled by configuration (NEXT_PUBLIC_STORE_WORKSPACE_MODE=off). Enable path or subdomain mode to restore workspaces.',
};

// v2.166.0: what each dispatcher sub-job OWNS, one line per name - the card
// copy mirror of docs/cron-operations.md's sub-job register (the doc holds
// the canonical table; this map is its card-sized echo, kept deliberately
// static: sub-job names are code-level contracts, not API data). An unknown
// name gets NO hint - the card never invents ownership for a sub-job it has
// not met (the same never-a-guess rule the chips already obey).
const AUTOMATION_SUBJOB_HINTS: Record<string, string> = {
  outbox: 'Pumps the outbound message queue (receipts and status pushes).',
  'payments-sweeper': 'Polls M-Pesa for payments that missed their callback.',
  'etims-retry': 'Drains the KRA eTIMS submission retry queue (backoff + DEAD ceiling).',
  'debt-reminders': 'Sends overdue debt statements (7-day per-ledger throttle).',
  'b2c-recovery': 'Re-sends gate-allowed FAILED payroll transfers and re-queries stuck ones.',
  'session-reaper': 'Deletes sign-in sessions whose expiry has passed (expiresAt only).',
  reconciliation: 'Rebuilds the nightly financial summaries.',
  retention: 'Purges expired records past their retention grace period.',
  'hr-report-digests': 'Emails the scheduled HR report digests.',
};

function WorkspaceUnavailableBadge({
  reason,
  inactive,
}: {
  reason: WorkspaceUnavailableReason | null;
  inactive: boolean;
}) {
  const code: WorkspaceUnavailableReason = reason ?? (inactive ? 'store-inactive' : 'missing-slug');
  return (
    <Badge
      variant="outline"
      className="max-w-[10rem] text-[11px] font-normal text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800"
      title={WORKSPACE_REASON_HINTS[code]}
      aria-label={`Branch workspace unavailable: ${WORKSPACE_REASON_LABELS[code]}`}
    >
      {WORKSPACE_REASON_LABELS[code]}
    </Badge>
  );
}

/**
 * Expert diagnostics dialog state machine (v2.18.4). The diagnostics list is
 * lazily fetched from GET /api/org/branch-diagnostics on the first Expert
 * open, cached in component state for the session, and re-fetched (bypassing
 * the cache) by the Refresh action. Loading, error-with-retry and copy
 * confirmation are always plain text; status is never conveyed by color.
 */
function formatKES(amount: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(amount);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatCard({
  icon,
  label,
  value,
  tone,
  href,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'warn';
  // v2.21.0: optional deep-link. When set the tile becomes a Link with a
  // focus ring + hover affordance; otherwise it stays a static card.
  href?: string;
  title?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {/* v2.149.0: amber-700 — amber-600 measured 3.19:1 on the white card,
            under the 4.5:1 the small label cells need (the text-xl value only
            cleared large-text 3:1 on a thin margin). amber-700 is 4.52:1. */}
        <span className={tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}>{icon}</span>
        {label}
      </div>
      <p className={`mt-2 text-xl font-semibold tabular-nums ${tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : ''}`}>{value}</p>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        title={title ?? label}
        className="group block rounded-lg border bg-card p-4 outline-none transition-all hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {body}
        <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          Open <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </span>
      </Link>
    );
  }
  return <div className="rounded-lg border bg-card p-4">{body}</div>;
}

export function OrgConsole() {
  const hasMounted = useWorkspaceAuthBoot();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const setOrganizationMode = useWorkspaceStore((s) => s.setWorkspace);
  // v2.112.0: the People & Payroll hand-over rides the same rule everywhere —
  // render the affordance only for the roles the people-payroll tab honors
  // (ORG_SUMMARY_ROLES), never as a dead door. The org console is already
  // org-roles-only, but the gate keeps the two homes honest by construction.
  const canSeePeoplePayroll = ORG_SUMMARY_ROLES.includes(user?.role || '');
  const [summary, setSummary] = useState<OrgSummary | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  // v2.18.4 expert diagnostics (per-row Expert affordance in the Branches table).
  const [expertStore, setExpertStore] = useState<OrgSummaryStore | null>(null);
  const [expertDiagnostic, setExpertDiagnostic] = useState<BranchDiagnostic | null>(null);
  const [expertPhase, setExpertPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [expertError, setExpertError] = useState('');
  const [expertList, setExpertList] = useState<BranchDiagnostic[] | null>(null);
  const [copyConfirmation, setCopyConfirmation] = useState('');
  // v2.149.0: the branches table's CSV export — same honest take-away the
  // Store Intelligence Matrix has; the note is the polite confirmation.
  const [exportNote, setExportNote] = useState('');
  // v2.154.0: the note grew a follow-up — an "Open" link pointing at the
  // just-built blob, so the owner can eyeball the file without digging it
  // out of the downloads folder. The previous blob URL is revoked on each
  // new export (one live URL at a time — no leak).
  const [exportUrl, setExportUrl] = useState('');
  const [exporting, setExporting] = useState(false);
  const exportUrlRef = useRef('');
  // v2.23.0: per-branch HR drill-down visibility (collapsed until asked for —
  // the console opens with the summary tiles; the table is one click away).
  const [hrPerStoreOpen, setHrPerStoreOpen] = useState(false);
  // v2.159.0: the Automation pulse card — the last cron dispatch tick from
  // the ledger (GET /api/org/automation, ORG_ROLES parity with the summary).
  // Additive by contract: a refused or failed read renders an honest error
  // state, it never breaks the console payload.
  interface AutomationSubJob {
    name: string;
    ok: boolean;
    status: number;
    /** v2.164.0: the session-reaper's deleted count, when the tick ledger
     *  carried it (optional for every other sub-job and for older ticks). */
    deleted?: number;
  }
  interface AutomationSummary {
    generatedAt: string;
    lastTick: {
      at: string;
      failedCount: number;
      subJobs: AutomationSubJob[];
      /** v2.165.0: which dispatcher fired ('hourly' | 'nightly') - present
       *  only on ledger rows written by v2.165.0 or newer; older ticks
       *  omit it and the card renders no source label (never a guess). */
      dispatcher?: string;
    } | null;
    failedTicks7d: number;
    /** v2.166.0: the exact timestamps (ISO, newest first) of up to 10 of
     *  the failed ticks behind failedTicks7d — the pill's tooltip lists
     *  them in EAT; absent from older responses, and the card renders no
     *  tooltip it cannot honestly fill. */
    failedTickStamps?: string[];
    secretConfigured: boolean;
    cadence: { vercelSchedule: string; pingerWorkflow: string };
  }
  const [automation, setAutomation] = useState<AutomationSummary | null>(null);
  const [automationPhase, setAutomationPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [automationError, setAutomationError] = useState('');
  const [automationReload, setAutomationReload] = useState(0);

  function findDiagnosticFor(
    list: BranchDiagnostic[],
    store: OrgSummaryStore,
  ): BranchDiagnostic | null {
    return list.find((b) => b.storeId === store.id) ?? null;
  }

  // v2.149.0: take the branches table away as CSV — client-side blob, the
  // same shape store-matrix's export uses; numbers export RAW (no thousands
  // separators) so a spreadsheet re-reads them as numbers, and the polite
  // note names the file that just landed.
  //
  // v2.154.0: the export grew a third section and a follow-up. The desk's
  // yesterday digest rides the same download (fetched from the org-wide
  // review-activity read; a refused or shapeless answer exports WITHOUT the
  // section and the note says so — the file is never blocked by it), and the
  // note ends with an Open link to the fresh blob (previous URL revoked).
  async function exportBranchesCsv(): Promise<void> {
    if (!summary || exporting) return;
    setExporting(true);
    let desk: BranchDeskCsvBlock | null = null;
    let deskNote = '';
    try {
      const res = await authorizedFetchJson('/api/org/review-activity');
      const data = res.json?.data as { yesterday?: unknown } | undefined;
      const y = data?.yesterday as
        | {
            label?: unknown;
            visits?: unknown;
            clears?: unknown;
            reviewers?: unknown;
            requests?: unknown;
            busiestBranch?: unknown;
            topReviewer?: unknown;
            branches?: unknown;
          }
        | undefined;
      if (
        res.ok &&
        res.json?.success &&
        y &&
        typeof y.label === 'string' &&
        typeof y.visits === 'number' &&
        typeof y.clears === 'number' &&
        typeof y.reviewers === 'number' &&
        typeof y.requests === 'number' &&
        Array.isArray(y.branches)
      ) {
        desk = {
          label: y.label,
          visits: y.visits,
          clears: y.clears,
          reviewers: y.reviewers,
          requests: y.requests,
          busiestBranch:
            y.busiestBranch &&
            typeof y.busiestBranch === 'object' &&
            typeof (y.busiestBranch as { storeName?: unknown }).storeName === 'string' &&
            typeof (y.busiestBranch as { visits?: unknown }).visits === 'number'
              ? (y.busiestBranch as { storeName: string; visits: number })
              : null,
          topReviewer:
            y.topReviewer &&
            typeof y.topReviewer === 'object' &&
            typeof (y.topReviewer as { name?: unknown }).name === 'string' &&
            typeof (y.topReviewer as { visits?: unknown }).visits === 'number'
              ? (y.topReviewer as { name: string; visits: number })
              : null,
          branches: (y.branches as Array<{ storeName?: unknown; visits?: unknown }>)
            .filter(
              (b): b is { storeName: string; visits: number } =>
                typeof b?.storeName === 'string' && typeof b?.visits === 'number',
            )
            .map((b) => ({ storeName: b.storeName, visits: b.visits })),
        };
      }
    } catch {
      /* the desk section is best-effort by contract — the branches export
         must never fail because the morning note did not answer */
    }
    if (!desk) deskNote = ' · desk activity unavailable';
    const csv = buildBranchesCsv(
      summary.stores.map((s) => ({
        name: s.name,
        code: s.code ?? '',
        location: s.location ?? '',
        status: s.status,
        todayRevenue: s.todayRevenue,
        todayTransactions: s.todayTransactions,
        lowStockCount: s.lowStockCount,
        overdueRentals: s.overdueRentals,
        debtOutstanding: s.debtOutstanding,
        pendingMpesa: s.pendingMpesa,
      })),
      new Date(),
      // v2.152.0: the drill-down's rows ride the same download (present even
      // while the section is collapsed — the data is the summary's).
      (summary.hrPerStore ?? []).map((r) => ({
        storeName: r.storeName,
        headcountActive: r.headcountActive,
        monthEmploymentCost: r.monthEmploymentCost,
        monthAbsenceRatePct: r.monthAbsenceRatePct,
        latestPayroll: r.latestPayroll
          ? { periodName: r.latestPayroll.periodName, status: r.latestPayroll.status }
          : null,
        expiryAlerts: r.expiryAlerts.documentsExpiring90Days + r.expiryAlerts.assetsOverdue,
      })),
      // v2.154.0: the desk's yesterday digest as the third section (null
      // when the read refused — the file ends at the v2.152.0 shape).
      desk,
    );
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `branches_${stamp}.csv`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // v2.154.0: the download URL stays alive — the note's Open link points
    // at the same blob so the owner can eyeball the file in a new tab. The
    // PREVIOUS export's URL is revoked here (one live blob at a time).
    if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
    exportUrlRef.current = url;
    setExportUrl(url);
    setExportNote(`Exported ${filename}${deskNote}`);
    setExporting(false);
  }

  async function fetchDiagnostics(force: boolean): Promise<BranchDiagnostic[] | null> {
    if (!force && expertList) return expertList;
    const res = await authorizedFetchJson('/api/org/branch-diagnostics');
    if (res.status === 401) {
      setExpertPhase('error');
      setExpertError('Your session has expired. Refresh the page to sign in again.');
      return null;
    }
    if (res.status === 403) {
      setExpertPhase('error');
      setExpertError('Your role cannot view branch diagnostics. This attempt has been logged.');
      return null;
    }
    const data = res.json?.data as { branches?: unknown } | undefined;
    if (!res.ok || !res.json?.success || !data || !Array.isArray(data.branches)) {
      setExpertPhase('error');
      setExpertError(res.json?.error || 'Branch diagnostics could not be loaded.');
      return null;
    }
    const branches = data.branches as BranchDiagnostic[];
    setExpertList(branches);
    return branches;
  }

  async function openExpertDiagnostics(store: OrgSummaryStore, force: boolean) {
    setExpertStore(store);
    setCopyConfirmation('');
    setExpertPhase('loading');
    setExpertError('');
    const cached = !force && expertList ? findDiagnosticFor(expertList, store) : null;
    if (cached) {
      setExpertDiagnostic(cached);
      setExpertPhase('ready');
      return;
    }
    const list = await fetchDiagnostics(force);
    if (!list) {
      setExpertDiagnostic(null);
      return;
    }
    const match = findDiagnosticFor(list, store);
    setExpertDiagnostic(match);
    if (match) {
      setExpertPhase('ready');
    } else {
      setExpertPhase('error');
      setExpertError('No diagnostic was returned for this branch. Refresh to retry.');
    }
  }

  async function copyExpertDiagnostics() {
    if (!expertDiagnostic) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(expertDiagnostic, null, 2));
      setCopyConfirmation('Diagnostics copied.');
    } catch {
      setCopyConfirmation('Copying was blocked by the browser. Select the text and copy it manually.');
    }
  }

  function closeExpertDiagnostics() {
    setExpertStore(null);
    setCopyConfirmation('');
  }

  useEffect(() => {
    setOrganizationMode({ store: null, hostMode: 'organization' });
    document.title = 'Organization Console | Mbumah Hardware POS';
    return () => {
      document.title = 'MBUMAH HARDWARE - POS & ERP System';
    };
  }, [setOrganizationMode]);

  // v2.159.0: the automation ledger read — parallel to the summary fetch,
  // same auth lifecycle, same honest error handling. Reload key re-runs the
  // read when the card's Retry is pressed.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      setAutomationPhase((p) => (p === 'ready' ? 'ready' : 'loading'));
      const res = await authorizedFetchJson('/api/org/automation');
      if (cancelled) return;
      if (!res.ok || !res.json?.success || !res.json?.data) {
        setAutomationPhase('error');
        setAutomationError(res.json?.error || 'The automation ledger could not be read.');
        return;
      }
      setAutomation(res.json.data as AutomationSummary);
      setAutomationPhase('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, automationReload]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      const res = await authorizedFetchJson('/api/org/summary');
      if (cancelled) return;
      if (res.status === 401) {
        setPhase('error');
        setErrorMessage('Your session has expired. Refresh the page to sign in again.');
        return;
      }
      if (res.status === 403) {
        setPhase('denied');
        return;
      }
      if (!res.ok || !res.json?.success || !res.json.data) {
        setPhase('error');
        setErrorMessage(res.json?.error || 'The organization summary could not be loaded.');
        return;
      }
      setSummary(res.json.data as OrgSummary);
      setPhase('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  if (!hasMounted) {
    return (
      <div className="min-h-screen bg-background p-6 space-y-4">
        <div className="h-24 rounded-lg bg-muted animate-pulse" />
        <div className="h-64 rounded-lg bg-muted animate-pulse" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <ErrorBoundary>
        <LoginScreen />
      </ErrorBoundary>
    );
  }

  if (phase === 'denied') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-4 border rounded-xl p-8 bg-card">
          <ShieldAlert className="h-10 w-10 mx-auto text-muted-foreground" aria-hidden="true" />
          <h1 className="text-lg font-semibold">Organization console is restricted</h1>
          <p className="text-sm text-muted-foreground">
            Only store owners, administrators, and accountants can view organization-wide data.
            This attempt has been logged.
          </p>
          <Button asChild variant="outline">
            <Link href="/">Back to your workspace</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-4 border rounded-xl p-8 bg-card">
          <ShieldAlert className="h-10 w-10 mx-auto text-muted-foreground" aria-hidden="true" />
          <h1 className="text-lg font-semibold">Summary unavailable</h1>
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  if (phase === 'loading' || !summary) {
    return (
      <div className="min-h-screen bg-background p-6 space-y-4">
        <Skeleton className="h-8 w-72" />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const role = user?.role || '';
  const financialOnly = role === 'ACCOUNTANT';

  return (
    <UnifiedConsoleShell
      mode="organization"
      bodyClassName="bg-muted/30"
      mainClassName="max-w-7xl mx-auto px-4 py-6 space-y-6"
      header={
        <header className="border-b bg-background">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <LayoutDashboard className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">Organization Console</h1>
              <p className="text-xs text-muted-foreground">
                All branches, one shared database
                {financialOnly ? ' (financial read-only view)' : ''}
                {' - '}
                updated {timeAgo(summary.generatedAt)}
              </p>
            </div>
          </div>
          {/* v2.149.0 follow-up: the right group was a no-wrap flex row —
              Badge + Global Chat measured 419px min-content and pushed the
              whole page to 435 at 390 even after the shell fix. The group
              wraps now and the long role Badge wraps inside itself. */}
          <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
            <Badge variant="outline" className="max-w-full whitespace-normal text-xs">
              {user?.name || 'Signed in'} - {role}
            </Badge>
            <Button asChild size="sm" variant="outline">
              <Link href="/chat">
                <MessagesSquare className="h-4 w-4 mr-1.5" aria-hidden="true" />
                Global Chat
              </Link>
            </Button>
          </div>
        </div>
      </header>
      }
    >
        {/* Combined organization metrics */}
        <section aria-label="Combined organization metrics">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatCard icon={<CircleDollarSign className="h-4 w-4" aria-hidden="true" />} label="Revenue today" value={formatKES(summary.totals.revenue)} />
            <StatCard icon={<ReceiptText className="h-4 w-4" aria-hidden="true" />} label="Transactions today" value={String(summary.totals.transactions)} />
            <StatCard icon={<PackageOpen className="h-4 w-4" aria-hidden="true" />} label="Low stock items" value={String(summary.totals.lowStock)} tone={summary.totals.lowStock > 0 ? 'warn' : undefined} />
            <StatCard icon={<Clock className="h-4 w-4" aria-hidden="true" />} label="Overdue rentals" value={String(summary.totals.overdueRentals)} tone={summary.totals.overdueRentals > 0 ? 'warn' : undefined} />
            <StatCard icon={<CircleDollarSign className="h-4 w-4" aria-hidden="true" />} label="Debt outstanding" value={formatKES(summary.totals.debtOutstanding)} />
            <StatCard icon={<Clock className="h-4 w-4" aria-hidden="true" />} label="Pending M-Pesa" value={String(summary.totals.pendingMpesa)} />
          </div>
        </section>

        {/* EMS v2.20.0: HR tiles (spec Phase 4.8) — rendered only when the
            API included the hr block (HR module on + report permission). */}
        {summary.hr ? (
          <section aria-label="HR summary tiles">
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">People &amp; payroll</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              <StatCard icon={<Users className="h-4 w-4" aria-hidden="true" />} label="Active headcount" value={String(summary.hr.headcountActive)} href="/hr/reports?tab=headcount" title="Open headcount report" />
              <StatCard icon={<Wallet className="h-4 w-4" aria-hidden="true" />} label="Employment cost (month)" value={formatKES(summary.hr.monthEmploymentCost)} href="/hr/reports?tab=cost" title="Open employment cost report" />
              <StatCard
                icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
                label="Absence rate (month)"
                value={`${summary.hr.monthAbsenceRatePct}%`}
                tone={summary.hr.monthAbsenceRatePct >= 10 ? 'warn' : undefined}
                href="/hr/reports?tab=absence"
                title="Open absence report"
              />
              <StatCard
                icon={<ReceiptText className="h-4 w-4" aria-hidden="true" />}
                label={summary.hr.latestPayroll ? `Payroll — ${summary.hr.latestPayroll.periodName}` : 'Payroll'}
                value={summary.hr.latestPayroll ? summary.hr.latestPayroll.status.toLowerCase() : 'no runs yet'}
                tone={summary.hr.latestPayroll && ['APPROVED', 'PENDING_APPROVAL'].includes(summary.hr.latestPayroll.status) ? 'warn' : undefined}
                href="/hr/payroll"
                title="Open the payroll workspace"
              />
              <StatCard
                icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
                label="Expiry alerts (90d + overdue assets)"
                value={String(summary.hr.expiryAlerts.documentsExpiring90Days + summary.hr.expiryAlerts.assetsOverdue)}
                tone={summary.hr.expiryAlerts.documentsExpiring90Days + summary.hr.expiryAlerts.assetsOverdue > 0 ? 'warn' : undefined}
                href="/hr/assets"
                title="Resolve in HR assets (documents live on the employee record)"
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              HR details live in the{' '}
              <Link href="/hr/reports" className="underline underline-offset-2 hover:text-foreground">
                HR reports
              </Link>{' '}
              workspace.
            </p>
            {summary.hrPerStore && summary.hrPerStore.length > 0 ? (
              <div className="mt-3 overflow-hidden rounded-lg border">
                <button
                  type="button"
                  onClick={() => setHrPerStoreOpen((v) => !v)}
                  aria-expanded={hrPerStoreOpen}
                  className="flex w-full items-center justify-between gap-2 bg-muted/40 px-3.5 py-2.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    People &amp; payroll by branch ({summary.hrPerStore.length})
                    {/* v2.148.0: slate-600 — the /80 alpha measured 3.61:1 and
                        even full muted-foreground computes ~4.4:1 on the
                        muted toggle's own bg; slate-600 passes at ~7:1.
                        v2.159.0: the dark half — the axe re-audit caught
                        slate-600 on the dark card at 2.38:1, so the span
                        wears the standing dark:text-slate-400 pair (~9:1
                        on the near-black card). */}
                    <span className="font-normal text-slate-600 dark:text-slate-400">
                      — headcount, cost, absence, latest run, expiry alerts per branch
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition-transform duration-200 ${hrPerStoreOpen ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </button>
                {hrPerStoreOpen ? (
                  // v2.149.0: min-w-0 + overflow-x — the six-column table's
                  // intrinsic min-content used to propagate straight through
                  // this wrapper (block scroll containers do NOT zero their
                  // min-content contribution) and push the whole console wide;
                  // overflow-x alone fixed the size, tabIndex makes the
                  // scrolling region keyboard-reachable (the v2.148 rule).
                  <div
                    className="max-h-96 min-w-0 overflow-x-auto overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    role="region"
                    tabIndex={0}
                    aria-label="People and payroll by branch, scrollable table"
                  >
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-card">
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="px-3.5 py-2 font-medium">Branch</th>
                          <th className="px-3 py-2 text-right font-medium">Headcount</th>
                          <th className="px-3 py-2 text-right font-medium">Cost (month)</th>
                          <th className="px-3 py-2 text-right font-medium">Absence</th>
                          <th className="px-3 py-2 font-medium">Latest payroll</th>
                          <th className="px-3 py-2 text-right font-medium">Expiry alerts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.hrPerStore.map((row) => {
                          const alerts = row.expiryAlerts.documentsExpiring90Days + row.expiryAlerts.assetsOverdue;
                          return (
                            <tr key={row.storeId} className="border-b transition-colors last:border-0 hover:bg-muted/30">
                              <td className="px-3.5 py-2">
                                <Link
                                  href={`/hr/reports?tab=headcount&storeId=${row.storeId}`}
                                  title={`Open the headcount report narrowed to ${row.storeName}`}
                                  className="font-medium underline-offset-2 hover:underline"
                                >
                                  {row.storeName}
                                </Link>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">{row.headcountActive}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{formatKES(row.monthEmploymentCost)}</td>
                              <td className={`px-3 py-2 text-right tabular-nums ${row.monthAbsenceRatePct >= 10 ? 'font-medium text-amber-700 dark:text-amber-400' : ''}`}>
                                {row.monthAbsenceRatePct}%
                              </td>
                              <td className="px-3 py-2">
                                {row.latestPayroll ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className="text-xs text-muted-foreground">{row.latestPayroll.periodName}</span>
                                    <span
                                      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                                        row.latestPayroll.status === 'LOCKED' || row.latestPayroll.status === 'POSTED'
                                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
                                          : row.latestPayroll.status === 'VOIDED'
                                            ? 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300'
                                            : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
                                      }`}
                                    >
                                      {row.latestPayroll.status.toLowerCase()}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">no runs yet</span>
                                )}
                              </td>
                              <td className={`px-3 py-2 text-right tabular-nums ${alerts > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : ''}`}>
                                {alerts}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Store performance table */}
        <section aria-label="Store performance" className="border rounded-lg bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Branches ({summary.stores.length})</h2>
            <div className="flex items-center gap-2">
              <p aria-live="polite" data-testid="org-console-export-note" className="text-xs text-muted-foreground">
                {exportNote}
                {/* v2.154.0: the follow-up — the fresh blob opens in a new tab,
                    so the owner can eyeball the export without hunting the
                    downloads folder. Same blob the download used. */}
                {exportUrl ? (
                  <>
                    {' · '}
                    <a
                      href={exportUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="org-console-export-open"
                      aria-label="Open the exported CSV in a new tab"
                      className="underline underline-offset-2 text-amber-700 dark:text-amber-400 hover:text-orange-800 dark:hover:text-amber-300"
                    >
                      Open
                    </a>
                  </>
                ) : null}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                data-testid="org-console-export-csv"
                onClick={exportBranchesCsv}
                disabled={exporting}
              >
                <Download className="mr-1 h-3 w-3" aria-hidden="true" />
                Export CSV
              </Button>
              <p className="hidden text-xs text-muted-foreground sm:block">Opening a branch workspace keeps this console tab available</p>
            </div>
          </div>
          {/* v2.149.0: min-w-0 — same intrinsic-min-content propagation as the
              drill-down above (measured: the table's 978px min-content pushed
              the console to 1012px at 390 viewport); tabIndex names + focuses
              the scrolling region once it actually scrolls on a phone. */}
          <div
            className="min-w-0 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            role="region"
            tabIndex={0}
            aria-label="Branches, scrollable table"
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Branch</th>
                  <th className="px-4 py-2 font-medium text-right">Revenue today</th>
                  <th className="px-4 py-2 font-medium text-right">Txns</th>
                  <th className="px-4 py-2 font-medium text-right">Low stock</th>
                  <th className="px-4 py-2 font-medium text-right">Overdue rentals</th>
                  <th className="px-4 py-2 font-medium text-right">Debt</th>
                  <th className="px-4 py-2 font-medium text-right">M-Pesa pending</th>
                  <th className="px-4 py-2 font-medium text-right">Workspace</th>
                </tr>
              </thead>
              <tbody>
                {summary.stores.map((store) => {
                  const inactive = store.status !== 'ACTIVE';
                  // Safe v2.18.0.0 builder with v2.18.3.0 precise reasons:
                  // path URL on localhost / raw IPs, subdomain URL only when
                  // every safety check passes, null for inactive stores or a
                  // missing slug (never a broken placeholder path).
                  const currentHost = typeof window !== 'undefined' ? window.location.host : '';
                  const protocol = typeof window !== 'undefined' ? window.location.protocol : undefined;
                  const resolution = resolveBranchWorkspace({
                    store: { slug: store.slug, subdomain: store.subdomain, isActive: !inactive },
                    currentHost,
                    protocol,
                  });
                  const href = resolution.href;
                  // On local hosts path mode IS the designed mode, so only
                  // surface a path chip when subdomains were expected but a
                  // fallback occurred (public host, subdomains enabled).
                  const showPathChip =
                    href !== null &&
                    resolution.usedMode === 'path' &&
                    !isLocalWorkspaceHost(currentHost);
                  const unavailableReason = getWorkspaceUnavailableReason({
                    store: { slug: store.slug, subdomain: store.subdomain, isActive: !inactive },
                    currentHost,
                    protocol,
                  });
                  return (
                    <tr key={store.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: store.brandingColor || '#B45309' }}
                            aria-hidden="true"
                          />
                          <div>
                            <p className="font-medium leading-tight">{store.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {[store.code, store.location].filter(Boolean).join(' - ')}
                              {inactive ? ' (inactive)' : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatKES(store.todayRevenue)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{store.todayTransactions}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${store.lowStockCount > 0 ? 'text-amber-700 font-medium dark:text-amber-400' : ''}`}>{store.lowStockCount}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${store.overdueRentals > 0 ? 'text-red-600 font-medium' : ''}`}>{store.overdueRentals}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatKES(store.debtOutstanding)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{store.pendingMpesa}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {href ? (
                            <div className="inline-flex flex-col items-end gap-1">
                              <Button asChild size="sm" variant="outline" disabled={inactive}>
                                <a href={href} target="_blank" rel="noopener noreferrer">
                                  <Building2 className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                                  Open branch workspace
                                  <ArrowUpRight className="h-3 w-3 ml-1" aria-hidden="true" />
                                </a>
                              </Button>
                              {/* v2.112.0: the hand-over — same deep link the
                                  Branch Selector wears, same honest gate. */}
                              {canSeePeoplePayroll && (
                                <Button
                                  asChild
                                  size="sm"
                                  variant="outline"
                                  disabled={inactive}
                                  className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-200"
                                  title={`Open the People & Payroll tab pre-filtered to ${store.name}`}
                                >
                                  <a
                                    href={buildPeoplePayrollDeepLink(store.id)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`People and payroll for ${store.name}`}
                                  >
                                    <UserCog className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                                    People &amp; payroll
                                  </a>
                                </Button>
                              )}
                              {showPathChip ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] font-normal text-muted-foreground"
                                  title="Branch subdomains are not available for this host. The path workspace /stores/{slug}/dashboard is ready."
                                >
                                  Path fallback ready
                                </Badge>
                              ) : null}
                            </div>
                          ) : (
                            <WorkspaceUnavailableBadge reason={unavailableReason} inactive={inactive} />
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Expert diagnostics for ${store.name}`}
                            onClick={() => openExpertDiagnostics(store, false)}
                          >
                            Expert
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* v2.159.0: Automation pulse — the cron dispatcher's heartbeat,
            read from the CRON_DISPATCH_TICK ledger. Sits next to the audit
            feed because it IS operational telemetry: the tick is the app's
            heartbeat, and the card says honestly whether it beats. */}
        <section
          aria-label="Automation pulse"
          role="region"
          data-testid="automation-card"
          className="border rounded-lg bg-card"
        >
          <div className="px-4 py-3 border-b flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Automation pulse</h2>
            {automationPhase === 'ready' && automation && (
              <span
                data-testid="automation-secret-posture"
                className={
                  automation.secretConfigured
                    ? 'inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-emerald-700'
                    : 'inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700'
                }
              >
                {automation.secretConfigured ? 'tick gate armed' : 'CRON_SECRET unset'}
              </span>
            )}
            {/* v2.164.0: the reaper's own headline. When the last tick's
                ledger carried a deleted count > 0, the card says it up here
                where the eye lands first — session hygiene is operational
                telemetry, not a chip detail to hunt for. Honest absence:
                zero reaps or an older tick render NOTHING (clean is the
                expected state, silence does not lie about it). */}
            {automationPhase === 'ready' &&
              automation?.lastTick &&
              (automation.lastTick.subJobs.find((j) => j.name === 'session-reaper')?.deleted ??
                0) > 0 && (
                <span
                  data-testid="automation-reaped-pill"
                  title="Expired sign-in sessions the reaper deleted during the last automation tick"
                  className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-sky-700 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-300"
                >
                  {automation.lastTick.subJobs.find((j) => j.name === 'session-reaper')?.deleted}{' '}
                  reaped
                </span>
              )}
            {automationPhase === 'error' && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7 text-xs"
                data-testid="automation-retry"
                onClick={() => {
                  setAutomationError('');
                  setAutomationPhase('loading');
                  setAutomationReload((n) => n + 1);
                }}
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" /> Retry
              </Button>
            )}
          </div>
          {automationPhase === 'error' ? (
            <p
              role="note"
              data-testid="automation-error"
              className="px-4 py-4 text-sm text-red-700"
            >
              {automationError || 'The automation ledger could not be read.'} The heartbeat
              itself keeps running — this is a read failure, not a dispatch failure.
            </p>
          ) : automationPhase !== 'ready' || !automation ? (
            <div className="px-4 py-4 space-y-2" aria-label="Loading automation pulse">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-72" />
            </div>
          ) : !automation.lastTick ? (
            <p role="note" data-testid="automation-empty" className="px-4 py-4 text-sm text-muted-foreground">
              No dispatch has been recorded yet — the first tick (Vercel at 03:00 UTC, or the
              cron-hourly workflow) writes the ledger and this card wakes up.
            </p>
          ) : (
            <div className="px-4 py-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Timer className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                {/* v2.165.0: the relative age is the glance read; the tooltip
                    carries the EXACT EAT stamp ("Mon 20 Oct 2026 · 13:09
                    EAT") so an operator diffing two ticks never has to
                    arithmetic their way back from "3h ago". */}
                <span
                  data-testid="automation-last-tick"
                  className="font-medium"
                  title={`Tick recorded ${formatEatStamp(new Date(automation.lastTick.at))}`}
                >
                  Last tick {timeAgo(automation.lastTick.at)}
                </span>
                {/* v2.165.0: WHICH heartbeat. From v2.165.0 both dispatchers
                    write the ledger, so the row's own name is the honest
                    source label; rows older than v2.165.0 lack it and render
                    nothing (never a guess). Full-opacity muted-foreground —
                    the card's contrast discipline holds (no alpha families). */}
                {automation.lastTick.dispatcher && (
                  <span
                    data-testid="automation-tick-source"
                    className="text-xs text-muted-foreground"
                  >
                    · {automation.lastTick.dispatcher} dispatcher
                  </span>
                )}
                {automation.lastTick.failedCount > 0 && (
                  <span
                    data-testid="automation-failed-count"
                    className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-red-700"
                    title={
                      automation.failedTickStamps && automation.failedTickStamps.length > 0
                        ? `Failed ticks: ${automation.failedTickStamps
                            .map((s) => formatEatStamp(new Date(s)))
                            .join(' · ')}${
                            automation.lastTick.failedCount > automation.failedTickStamps.length
                              ? ` · and ${automation.lastTick.failedCount - automation.failedTickStamps.length} more`
                              : ''
                          }`
                        : undefined
                    }
                  >
                    {automation.lastTick.failedCount} failed tick
                    {automation.lastTick.failedCount === 1 ? '' : 's'} in 7d
                  </span>
                )}
              </div>
              {automation.lastTick.subJobs.length > 0 ? (
                <ul
                  data-testid="automation-subjob-list"
                  className="flex flex-wrap gap-1.5"
                  aria-label="Sub-jobs from the last tick"
                >
                  {automation.lastTick.subJobs.map((job) => (
                    <li
                      key={job.name}
                      data-testid="automation-subjob-chip"
                      data-job-name={job.name}
                      data-job-ok={job.ok ? 'true' : 'false'}
                      /* v2.166.0: the chip says what it OWNS (the register's
                          card-sized echo) and wears cursor-help while doing
                          it; an unknown name renders bare - never a guess. */
                      title={AUTOMATION_SUBJOB_HINTS[job.name]}
                      className={
                        job.ok
                          ? `inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700${
                              AUTOMATION_SUBJOB_HINTS[job.name] ? ' cursor-help' : ''
                            }`
                          : `inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700${
                              AUTOMATION_SUBJOB_HINTS[job.name] ? ' cursor-help' : ''
                            }`
                      }
                    >
                      <span
                        aria-hidden="true"
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          job.ok ? 'bg-emerald-700' : 'bg-red-700'
                        }`}
                      />
                      {job.name}
                      {/* v2.164.0: the reaper chip speaks its own sweep -
                          `· reaped N` when the ledger carried a positive
                          count, `· clean` when it carried zero; anything
                          else (absent, older tick, garbage) renders nothing
                          — the same never-a-guess rule as the HTTP suffix. */}
                      {job.name === 'session-reaper' && job.ok && job.deleted !== undefined && (
                        <span className="tabular-nums">
                          · {job.deleted > 0 ? `reaped ${job.deleted}` : 'clean'}
                        </span>
                      )}
                      {!job.ok && <span className="tabular-nums">· HTTP {job.status}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p role="note" className="text-xs text-muted-foreground">
                  The tick is on the ledger but its sub-job detail cannot be read — never a
                  guess, the chips stay empty until a parseable tick lands.
                </p>
              )}
              <p
                role="note"
                data-testid="automation-cadence-line"
                className="text-xs text-muted-foreground"
              >
                Vercel fires the dispatcher daily ({automation.cadence.vercelSchedule} UTC);
                the {automation.cadence.pingerWorkflow} GitHub Actions workflow keeps the
                designed hourly cadence when armed with CRON_SECRET.
              </p>
            </div>
          )}
        </section>

        {/* Recent audit events */}
        <section aria-label="Recent audit events" className="border rounded-lg bg-card">
          <div className="px-4 py-3 border-b">
            <h2 className="text-sm font-semibold">Recent audit events</h2>
          </div>
          {summary.recentAudit.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No audit events recorded yet.</p>
          ) : (
            <ul className="divide-y">
              {summary.recentAudit.map((event) => (
                <li key={event.id} className="px-4 py-2.5 flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary" className="text-[10px] font-mono">{event.action}</Badge>
                  <span className="text-muted-foreground">{event.entityType}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{timeAgo(event.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

      {/* v2.18.4 per-branch Expert diagnostics dialog. Radix provides the
          Escape-to-close and focus management; no manual focus trap. */}
      <Dialog
        open={expertStore !== null}
        onOpenChange={(open) => {
          if (!open) closeExpertDiagnostics();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Expert diagnostics{expertStore ? ` - ${expertStore.name}` : ''}
            </DialogTitle>
            <DialogDescription>
              Server-verified workspace, schema and operational state for this branch.
            </DialogDescription>
          </DialogHeader>
          {expertPhase === 'loading' ? (
            <p className="text-sm text-muted-foreground">Loading diagnostics...</p>
          ) : null}
          {expertPhase === 'error' ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{expertError}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (expertStore) openExpertDiagnostics(expertStore, true);
                }}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {expertPhase === 'ready' && expertDiagnostic ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Slug</dt>
                <dd className="break-all font-mono text-xs">
                  {expertDiagnostic.slug || 'Not set'}
                </dd>
                <dt className="text-muted-foreground">Subdomain</dt>
                <dd className="break-all font-mono text-xs">
                  {expertDiagnostic.subdomain || 'Not set'}
                </dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{expertDiagnostic.status}</dd>
                <dt className="text-muted-foreground">Reason code</dt>
                <dd>
                  <Badge variant="outline" className="font-mono text-[11px] font-normal">
                    {expertDiagnostic.reasonCode}
                  </Badge>
                </dd>
                <dt className="text-muted-foreground">Remediation</dt>
                <dd className="text-muted-foreground">{expertDiagnostic.remediation}</dd>
                <dt className="text-muted-foreground">Schema</dt>
                <dd>
                  {expertDiagnostic.schemaStatus}
                  {expertDiagnostic.missingColumns.length > 0 ? (
                    <span className="block font-mono text-xs text-amber-700 dark:text-amber-400">
                      Missing: {expertDiagnostic.missingColumns.join(', ')}
                    </span>
                  ) : null}
                </dd>
                <dt className="text-muted-foreground">Checked</dt>
                <dd className="text-xs">
                  {new Date(expertDiagnostic.lastCheckedAt).toLocaleString()}
                </dd>
              </dl>
              <p aria-live="polite" className="text-xs text-muted-foreground">
                {copyConfirmation}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={copyExpertDiagnostics}>
                  Copy diagnostics
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (expertStore) openExpertDiagnostics(expertStore, true);
                  }}
                >
                  Refresh
                </Button>
                {expertDiagnostic.slug ? (
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={`/stores/${expertDiagnostic.slug}/dashboard`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open path workspace
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </UnifiedConsoleShell>
  );
}
