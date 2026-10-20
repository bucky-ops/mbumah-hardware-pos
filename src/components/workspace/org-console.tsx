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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronsUpDown,
  CircleDollarSign,
  Clock,
  Download,
  LayoutDashboard,
  MessagesSquare,
  PackageOpen,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Rows3,
  ShieldAlert,
  SlidersHorizontal,
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
// v2.172.0: the heartbeat EXPECTATION — pure math (slots, grace, EAT
// clocks) that turns "Last tick 3h ago" into "when is the next tick due,
// and is the heartbeat on time". Anchored on the server's generatedAt,
// never the browser clock.
import {
  nextTickExpectation,
  expectationDotClass,
  expectationTextClass,
} from '@/lib/org/tick-expectation';
// v2.173.0: the first screen learns to trend — the Sparkline primitive the
// expert console's KPI row speaks, reused so both consoles draw the same
// shape language (aria-hidden svg, pulse dot on the last point).
import { Sparkline, WeekDeltaChip, weekDeltaWords } from '@/components/org/primitives';
// v2.182.0: the branches table's owner vocabulary — the matrix's Checkbox +
// DropdownMenu recipe for the Columns menu, the ONE comparator the matrix
// sorts by (reused verbatim — one sort vocabulary across BOTH dense
// tables), and the branches table's own prefs spine (the matrix spine's
// twin under its own key, so the two tables never share bytes).
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { nextSortState, sortMatrixRows, type MatrixSortState } from '@/lib/org/store-matrix-sort';
import {
  BRANCHES_TABLE_PREFS_VERSION,
  clearBranchesTablePrefs,
  loadBranchesTablePrefs,
  saveBranchesTablePrefs,
} from '@/lib/org/branches-table-prefs';
// v2.183.0: the drill-down's OWN comparator + spine — the third dense
// table speaks the same owner vocabulary through its SIBLING lib (the
// hrPerStore row shares no fields with MatrixSortRow, so a reused
// comparator would be a guessed one). nextSortState is aliased because the
// branches/matrix import above already claims the bare name.
import {
  nextSortState as nextHrSortState,
  sortHrDrillRows,
  type HrDrillSortState,
} from '@/lib/org/hr-drilldown-sort';
import {
  HR_DRILLDOWN_PREFS_VERSION,
  clearHrDrilldownPrefs,
  loadHrDrilldownPrefs,
  saveHrDrilldownPrefs,
} from '@/lib/org/hr-drilldown-prefs';
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

// v2.170.0: the visible-on-focus bubble recipe, shared by EVERY hinted
// surface on the Automation card (v2.168.0 wrote it twice — chip + pill;
// the denied chip makes three, so the string lives in ONE place). An
// absolute overlay (top-full + mt-1.5) so the line below never reflows,
// popover token pair for dark-mode safety, pointer-events-none so the
// overlay can never swallow a click, group-focus-visible to appear.
// The pill-family surfaces (9px uppercase display type) append
// `normal-case tracking-normal` — text-transform and letter-spacing
// inherit, prose bubbles must opt back out.
const HINT_BUBBLE =
  'pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-max max-w-[16rem] rounded-md border bg-popover px-2 py-1 text-[11px] font-normal leading-snug text-popover-foreground shadow-md group-focus-visible:block';

/**
 * v2.182.0: the branches table's header sort glyph — the SAME visible
 * vocabulary the Store Intelligence Matrix wears since v2.180.0 (one sort
 * language across BOTH dense tables). An active sort speaks in the
 * console's orange accent (up for asc, down for desc); a quiet column
 * shows NOTHING at rest and only reveals the muted chevron pair on hover
 * or keyboard focus — the affordance is a whisper, not a shout.
 * aria-hidden: the accessible state rides aria-sort on the th, never this
 * glyph.
 * v2.183.0: the drill-down's driven header reuses the SAME component —
 * one sort language across ALL THREE dense tables now, and the glyph is
 * the vocabulary's body.
 */
function BranchSortGlyph({ state }: { state: 'asc' | 'desc' | 'none' }) {
  if (state === 'asc') return <ArrowUp className="h-3 w-3 text-orange-500" aria-hidden="true" />;
  if (state === 'desc') return <ArrowDown className="h-3 w-3 text-orange-500" aria-hidden="true" />;
  return (
    <ChevronsUpDown
      className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      aria-hidden="true"
    />
  );
}

/**
 * v2.183.0: the HR drill-down's column spec — the ONE place that names the
 * third dense table's columns (the driven header reads it). All six are
 * sortable: numbers loudest-first (headcount, cost, absence, alerts), text
 * A→Z (branch), and `payroll` sorts through the SAME latestPayroll join
 * its cells speak — by STATUS RANK since v2.190.0 (the badge the cell
 * wears: locked/posted first, then approved, draft, voided; no runs last
 * in both directions). `pad` keeps the stock cell rhythm the driven header
 * had as literal markup (first column breathes wider than the rest).
 * v2.190.0: a column whose fresh-click semantics are not guessable from
 * its label carries an honest `hint` — spoken as the sort button's title,
 * so the rank language is on the screen where the click happens.
 */
interface HrDrillColDef {
  key: string;
  label: string;
  align?: 'right';
  pad: string;
  sortable: boolean;
  /** v2.190.0: the honest semantics line, rendered as the button's title. */
  hint?: string;
}
const HR_DRILLDOWN_COLS: HrDrillColDef[] = [
  { key: 'branch', label: 'Branch', pad: 'px-3.5', sortable: true },
  { key: 'headcount', label: 'Headcount', align: 'right', pad: 'px-3', sortable: true },
  { key: 'cost', label: 'Cost (month)', align: 'right', pad: 'px-3', sortable: true },
  { key: 'absence', label: 'Absence', align: 'right', pad: 'px-3', sortable: true },
  {
    key: 'payroll',
    label: 'Latest payroll',
    pad: 'px-3',
    sortable: true,
    hint:
      'Sorts by run finality: locked & posted first, then approved, draft, voided. Click again for the mirror (least final first). Branches with no runs sort last.',
  },
  { key: 'alerts', label: 'Expiry alerts', align: 'right', pad: 'px-3', sortable: true },
];

/**
 * v2.182.0: the branches table's column spec — the ONE place that names
 * the table's columns (the driven header reads it; the visibility menu
 * walks it; the resize handler resolves widths from it). Defaults are the
 * stock auto-layout's honest approximations; an owner's saved width wins
 * over the default through the prefs spine. `workspace` stays unsortable
 * (an action cell is not data); `week` sorts through the SAME by-storeId
 * join its cells speak.
 */
interface BranchColDef {
  key: string;
  label: string;
  width: number;
  min: number;
  align?: 'right';
  sortable: boolean;
}
const BRANCH_TABLE_COLS: BranchColDef[] = [
  { key: 'branch', label: 'Branch', width: 220, min: 150, sortable: true },
  { key: 'revenue', label: 'Revenue today', width: 124, min: 96, align: 'right', sortable: true },
  { key: 'week', label: '7d trend', width: 112, min: 92, sortable: true },
  { key: 'txns', label: 'Txns', width: 72, min: 56, align: 'right', sortable: true },
  { key: 'low', label: 'Low stock', width: 88, min: 64, align: 'right', sortable: true },
  { key: 'overdue', label: 'Overdue rentals', width: 118, min: 84, align: 'right', sortable: true },
  { key: 'debt', label: 'Debt', width: 108, min: 84, align: 'right', sortable: true },
  { key: 'mpesa', label: 'M-Pesa pending', width: 122, min: 88, align: 'right', sortable: true },
  { key: 'workspace', label: 'Workspace', width: 250, min: 210, sortable: false },
];

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

/**
 * v2.174.0: the store whose week moved the most, as the API ships it (the
 * pure lib's TrendMover plus the server-computed variancePct). The card
 * renders it verbatim — no math of its own, per the strip's contract.
 * v2.175.0: gains the winner's workspace identity (slug / subdomain /
 * isActive) so the name can deep-link through the SAME safe resolver the
 * branches table speaks; absent fields render plain text, never a URL.
 */
interface TrendMoverSummary {
  storeId: string;
  storeName: string;
  current: number;
  prior: number;
  delta: number;
  variancePct: number;
  slug?: string | null;
  subdomain?: string | null;
  isActive?: boolean;
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
  /**
   * v2.173.0: the 7-day trend (gross, matching the totals block above).
   * TOLERANT — optional and nullable, because an older cached response (or
   * a future route regression) must degrade to the plain cards, never
   * crash the first screen. The variance badge is hidden when
   * priorWeekTotal is 0: no prior data means NO comparison, never "+0%".
   */
  /**
   * v2.174.0: the store whose week moved the most, server-computed by the
   * pure lib's topMover (the card adds no math of its own). Optional +
   * nullable — an older cached response without the field degrades to the
   * strip exactly as it shipped in v2.173.0.
   */
  trend?: {
    revenue: { spark: number[]; weekTotal: number; priorWeekTotal: number; variancePct: number; topMover?: TrendMoverSummary | null };
    transactions: { spark: number[]; weekTotal: number; priorWeekTotal: number; variancePct: number; topMover?: TrendMoverSummary | null };
  } | null;
  /**
   * v2.175.0: one revenue spark PER branch (keyed by storeId; the card
   * joins it against `stores` by id, never by row order). TOLERANT —
   * optional + nullable: an older cached response degrades to a muted
   * "—" in the table's 7d column, never a crash or a fabricated shape.
   */
  perStoreTrend?: Array<{ storeId: string; spark: number[]; weekTotal: number; priorWeekTotal?: number }> | null;
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

/**
 * v2.173.0: the trend strip the Revenue and Transactions cards share — the
 * 7-day sparkline (aria-hidden decoration; the numbers below it are the
 * real content), the week-vs-prior variance badge, and the two-week
 * microcopy. Every number arrives server-computed — the card adds no math
 * of its own. The badge renders ONLY when the prior week has data
 * (priorWeekTotal > 0): no prior data means NO comparison, never a
 * fabricated "+0%". Colors carry the v2.159 contrast lesson — emerald-700
 * / red-700 real text (red-600 was the knife-edge 4.53:1), dark-mode lifts
 * to the -400 steps.
 *
 * v2.174.0: the optional `mover` names WHICH branch moved the week — a
 * `Top mover <name> <signed delta>` sub-line under the microcopy, with the
 * ±% clause shown only when the mover's own prior > 0 (a zero week has no
 * percentage, never an invented ∞). Same contrast family as the badge;
 * `mover` null or absent renders nothing — silence, never a guess.
 *
 * v2.175.0: the mover's name becomes a DOOR — when the SAME safe resolver
 * the branches table speaks (resolveBranchWorkspace) builds a real URL
 * from the winner's slug/subdomain/isActive, the name renders as an
 * anchor (new tab, noopener, underline + hover + focus-visible ring, a
 * tiny external-tab arrow, and an sr-only "opens in a new tab" clause);
 * when no safe URL exists (missing slug / inactive / workspace mode off)
 * the name stays plain text — the safe-builder contract, verbatim: no
 * safe URL, no link, calm fallback.
 */
function TrendFooter({
  spark,
  weekTotal,
  priorWeekTotal,
  variancePct: variance,
  mover,
  format,
  testId,
  stroke,
}: {
  spark: number[];
  weekTotal: number;
  priorWeekTotal: number;
  variancePct: number;
  mover?: TrendMoverSummary | null;
  format: (v: number) => string;
  testId: string;
  stroke?: string;
}) {
  const up = variance >= 0;
  // v2.175.0: resolve the deep-link with the table's own resolver — same
  // input shape (slug/subdomain/isActive + host/protocol), same honesty:
  // href === null for a missing slug, an inactive branch, or workspace
  // mode off, and the name then renders as the plain text it always was.
  const moverHref = mover
    ? resolveBranchWorkspace({
        store: { slug: mover.slug ?? null, subdomain: mover.subdomain ?? null, isActive: mover.isActive ?? false },
        currentHost: typeof window !== 'undefined' ? window.location.host : '',
        protocol: typeof window !== 'undefined' ? window.location.protocol : undefined,
      }).href
    : null;
  return (
    <div className="mt-2 border-t pt-2" data-testid={testId}>
      <div className="flex items-end justify-between gap-2">
        <Sparkline data={spark} stroke={stroke} />
        {priorWeekTotal > 0 && (
          <span
            className={`flex items-center gap-0.5 text-[11px] font-semibold ${
              up ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
            }`}
          >
            {up ? (
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
            )}
            {up ? '+' : ''}
            {variance}%
          </span>
        )}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
        7d {format(weekTotal)} · prior {format(priorWeekTotal)}
      </p>
      {mover && (
        <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums" data-testid={`${testId}-mover`}>
          Top mover{' '}
          {moverHref ? (
            <a
              href={moverHref}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`${testId}-mover-link`}
              title={`${mover.storeName} — open workspace in a new tab`}
              className="rounded-sm font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:decoration-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              {mover.storeName}
              <ArrowUpRight className="ml-0.5 inline h-2.5 w-2.5 align-baseline" aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span className="font-medium text-foreground/80">{mover.storeName}</span>
          )}{' '}
          <span className={mover.delta >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>
            {mover.delta >= 0 ? '+' : '-'}
            {format(Math.abs(mover.delta))}
          </span>
          {mover.prior > 0 && (
            <span>
              {' '}({mover.variancePct >= 0 ? '+' : ''}
              {mover.variancePct}%)
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
  href,
  title,
  footer,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'warn';
  // v2.21.0: optional deep-link. When set the tile becomes a Link with a
  // focus ring + hover affordance; otherwise it stays a static card.
  href?: string;
  title?: string;
  // v2.173.0: optional trend strip (TrendFooter) rendered under the value.
  // Only the Revenue and Transactions cards pass one; the rest stay plain.
  footer?: React.ReactNode;
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
      {footer}
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
        {/* v2.168.0: the tile's title sentence ("Open headcount report",
            "Resolve in HR assets…") stops being mouse-only — screen readers
            hear the same sentence the hover tooltip says. The visible
            "Open ↗" affordance already shows itself on keyboard focus; this
            copy closes the gap for AT, one truth on two surfaces. */}
        {title && <span className="sr-only"> — {title}</span>}
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
  // v2.182.0: the branches table remembers — the four owner-tunable
  // dimensions (widths since this release, visibility, sort, compact-rows
  // density) ride the SAME versioned, corrupt-tolerant localStorage spine
  // the matrix got in v2.181.0, under the table's OWN key
  // (the branches spine's own key) so the two tables never share bytes and
  // resetting one can never surprise the other. Restore happens AFTER
  // hydration (server-stock first paint, saved layout second); writes are
  // debounced so a column drag cannot thrash storage; a stock layout
  // clears the key outright; and the Columns menu grows a Reset layout
  // action plus a hint line that says the memory exists.
  const [branchWidths, setBranchWidths] = useState<Record<string, number>>({});
  const [branchVisible, setBranchVisible] = useState<Record<string, boolean>>({});
  const [branchSort, setBranchSort] = useState<MatrixSortState | null>(null);
  const [branchDense, setBranchDense] = useState(false);
  // v2.182.0: gates the write-back until the restore has run — the mount
  // effect's own setState calls must never be mistaken for owner choices.
  const branchRestored = useRef(false);
  const branchDragging = useRef<{ key: string; startX: number; startW: number } | null>(null);
  // v2.182.0: the visible, polite confirmation for the actions that have
  // no other surface (Reset layout) — the same one-line-note pattern the
  // export speaks, never an alert().
  const [branchLayoutNote, setBranchLayoutNote] = useState('');

  // v2.182.0: ONE restore after hydration. The server renders the stock
  // table (the lib is pure and storage-less under SSR); the client's first
  // paint matches it; THEN the saved layout takes over — the same
  // default-then-restore ordering the matrix spine speaks. The restore
  // defers to a macrotask so setState never runs synchronously inside the
  // effect body (the react-hooks/set-state-in-effect rule — the same shape
  // chrome.tsx's release pill speaks for its localStorage read): by the
  // time the macrotask runs, hydration has committed, so the ordering
  // contract holds.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const storage = typeof window === 'undefined' ? null : window.localStorage;
      const prefs = loadBranchesTablePrefs(storage);
      setBranchWidths(prefs.widths);
      setBranchVisible(prefs.visible);
      setBranchSort(prefs.sort);
      setBranchDense(prefs.dense);
      branchRestored.current = true;
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  // v2.182.0: the debounced write-back — every owner choice lands 250ms
  // after the last change settles (a column drag repaints dozens of
  // widths; storage takes ONE). A stock layout clears the key outright
  // (nothing saved is the honest shape of "no customizations"), anything
  // else saves the whole payload through the lib — the ONE writer of the
  // bytes. A refused save (quota, privacy mode) is silent: the table
  // forgets on the next reload exactly as it always did, and never nags.
  useEffect(() => {
    if (!branchRestored.current) return;
    const t = setTimeout(() => {
      const storage = typeof window === 'undefined' ? null : window.localStorage;
      const stock =
        Object.keys(branchWidths).length === 0 &&
        Object.keys(branchVisible).length === 0 &&
        branchSort === null &&
        branchDense === false;
      if (stock) clearBranchesTablePrefs(storage);
      else
        saveBranchesTablePrefs(storage, {
          v: BRANCHES_TABLE_PREFS_VERSION,
          widths: branchWidths,
          visible: branchVisible,
          sort: branchSort,
          dense: branchDense,
        });
    }, 250);
    return () => clearTimeout(t);
  }, [branchWidths, branchVisible, branchSort, branchDense]);
  // v2.23.0: per-branch HR drill-down visibility (collapsed until asked for —
  // the console opens with the summary tiles; the table is one click away).
  // v2.183.0: the drill-down remembers — the open state PLUS the two
  // in-table tunables (sort, compact-rows density) ride the SAME kind of
  // versioned, corrupt-tolerant localStorage spine the matrix (v2.181.0)
  // and the branches table (v2.182.0) got, under the drill-down's OWN key
  // (the drill-down spine's own key) so the three tables never share bytes and
  // resetting one can never surprise the others. Restore happens AFTER
  // hydration (server-stock first paint, saved layout second); writes are
  // debounced so toggling cannot thrash storage; a stock layout (door
  // closed, no sort, comfortable rows) clears the key outright.
  const [hrPerStoreOpen, setHrPerStoreOpen] = useState(false);
  const [hrSort, setHrSort] = useState<HrDrillSortState | null>(null);
  const [hrDense, setHrDense] = useState(false);
  // v2.183.0: gates the write-back until the restore has run — the mount
  // effect's own setState calls must never be mistaken for owner choices.
  const hrRestored = useRef(false);
  // v2.183.0: the visible, polite confirmation for the action that has no
  // other surface (Reset) — the same one-line-note pattern the branches
  // layout note speaks, never an alert().
  const [hrLayoutNote, setHrLayoutNote] = useState('');
  // v2.184.0: the write-back's post-restore pulse. The restore's setStates
  // only change the deps when the saved layout differs from stock — a
  // corrupt payload restores to the SAME stock shape (booleans and a null,
  // all reference-equal) and the write-back would never fire, leaving the
  // corrupt bytes sitting in storage until the next owner choice. The
  // siblings never hit this (their restore always hands back a FRESH widths
  // object); the drill-down has no widths by the documented restraint, so
  // the restore bumps ONE counter instead — the write-back runs once after
  // every restore, and the stock fork clears whatever junk it finds.
  const [hrRestoreTick, setHrRestoreTick] = useState(0);

  // v2.183.0: ONE restore after hydration — the branches spine's exact
  // shape (default-then-restore ordering; the macrotask deferral keeps
  // setState out of the effect body per the react-hooks/set-state-in-effect
  // rule, the house pattern since v2.182.0). v2.184.0: the restore bumps
  // the write-back's tick (inside the same macrotask) so a stock-shaped
  // restore — corrupt bytes included — still walks the stock fork and
  // clears the key, the siblings' self-heal carried over verbatim.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const storage = typeof window === 'undefined' ? null : window.localStorage;
      const prefs = loadHrDrilldownPrefs(storage);
      setHrPerStoreOpen(prefs.open);
      setHrSort(prefs.sort);
      setHrDense(prefs.dense);
      setHrRestoreTick((t) => t + 1);
      hrRestored.current = true;
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  // v2.183.0: the debounced write-back — every owner choice lands 250ms
  // after the last change settles. A stock layout CLEARS the key outright
  // (the door closed + no sort + comfortable rows is the honest shape of
  // "no customizations"); anything else saves the whole payload through
  // the lib — the ONE writer of the bytes. A refused save is silent.
  // v2.184.0: the deps carry the restore tick — the post-restore pulse
  // that guarantees the stock fork (and so the corrupt-byte self-heal)
  // runs even when the restore changed nothing by reference.
  useEffect(() => {
    if (!hrRestored.current) return;
    const t = setTimeout(() => {
      const storage = typeof window === 'undefined' ? null : window.localStorage;
      const stock = !hrPerStoreOpen && hrSort === null && hrDense === false;
      if (stock) clearHrDrilldownPrefs(storage);
      else
        saveHrDrilldownPrefs(storage, {
          v: HR_DRILLDOWN_PREFS_VERSION,
          open: hrPerStoreOpen,
          sort: hrSort,
          dense: hrDense,
        });
    }, 250);
    return () => clearTimeout(t);
  }, [hrRestoreTick, hrPerStoreOpen, hrSort, hrDense]);
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
    /** v2.169.0: parallel to failedTickStamps (same order/length); null
     *  where the ledger row predates v2.165.0 or carries no name. The
     *  tooltip says WHICH heartbeat failed only when a row named one. */
    failedTickDispatchers?: (string | null)[];
    /** v2.170.0: ticks the gate refused with 403 in the same 7-day window
     *  (only denials that at least SENT a secret reach the ledger, so the
     *  count is real attempted ticks, never scanner noise). Optional for
     *  older responses — the card renders no chip it cannot honestly
     *  fill (`?? 0` keeps absence and zero equally silent). */
    deniedTicks7d?: number;
    /** v2.171.0: the refusal feed parallel to deniedTicks7d — exact stamps
     *  (ISO, newest first, ≤10) and each row's gate name ('hourly' |
     *  'nightly'; null where the path is absent, garbage, or unknown).
     *  Optional for older responses; the sentence renders without the
     *  details clause when they are absent, never a guess. */
    deniedTickStamps?: string[];
    deniedTickGates?: (string | null)[];
    secretConfigured: boolean;
    /** v2.172.0: the UTC hour of Vercel's daily slot, as a number — the
     *  expectation math consumes it without parsing a cron string.
     *  Optional for older responses; the lib's documented default (3)
     *  keeps the sentence honest either way. */
    cadence: { vercelSchedule: string; pingerWorkflow: string; vercelHourUtc?: number };
  }
  const [automation, setAutomation] = useState<AutomationSummary | null>(null);
  const [automationPhase, setAutomationPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [automationError, setAutomationError] = useState('');
  const [automationReload, setAutomationReload] = useState(0);

  /* v2.167.0: the pill's exact-tick sentence is computed ONCE and rides
     BOTH the native title and the sr-only line — two surfaces, one truth,
     so the keyboard copy can never drift from the hover copy. Absent or
     empty stamps return undefined: no tooltip is invented (the v2.166.0
     honesty rule, now shared by both surfaces). */
  function failedTickTooltip(automation: AutomationSummary): string | undefined {
    if (!automation.failedTickStamps || automation.failedTickStamps.length === 0)
      return undefined;
    if (!automation.lastTick) return undefined;
    const stamps = automation.failedTickStamps.map((s) => formatEatStamp(new Date(s)));
    // v2.169.0: each named stamp says WHICH heartbeat failed — the parallel
    // failedTickDispatchers entry (same index, same order) rides along as a
    // parenthetical; a null, an out-of-range index, or an older response
    // without the array renders the bare stamp, never a guess.
    const parts = stamps.map((label, i) => {
      const d = automation.failedTickDispatchers?.[i];
      return typeof d === 'string' && d.length > 0 ? `${label} (${d})` : label;
    });
    return `Failed ticks: ${parts
      .join(' · ')}${
      automation.lastTick.failedCount > automation.failedTickStamps.length
        ? ` · and ${automation.lastTick.failedCount - automation.failedTickStamps.length} more`
        : ''
    }`;
  }

  /* v2.171.0: the denied pill's sentence is computed ONCE and rides the
     title, the sr-only line and the visible bubble — the same one-truth
     rule the failed-tick pill has followed since v2.167.0. When the
     ledger rows name their gates (metadata.path, v2.170.0), the sentence
     says WHICH gate refused and when the most recent refusal was; the
     "and N more" valve keeps the pill's count and the ≤10-row feed
     honest together. Rows without a readable path render the bare
     sentence — never a guess. */
  function deniedTickTooltip(automation: AutomationSummary): string {
    const base =
      'Ticks the tick gate refused while armed — a secret was sent but did not match.';
    const cause =
      'The usual cause is a stale CRON_SECRET on one side of the arming walkthrough; the refused tick ran nothing.';
    const stamps = automation.deniedTickStamps ?? [];
    const gates: string[] = [];
    const counts = new Map<string, number>();
    for (const g of automation.deniedTickGates ?? []) {
      if (typeof g !== 'string' || g.length === 0) continue;
      if (!counts.has(g)) gates.push(g);
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    let details = '';
    if (gates.length > 0) {
      details = ` Recent refusals: ${gates
        .map((g) => `${counts.get(g)} at the ${g} gate`)
        .join(', ')}`;
      if (stamps.length > 0) {
        details += `, most recent ${formatEatStamp(new Date(stamps[0]))}`;
      }
      const more = (automation.deniedTicks7d ?? 0) - stamps.length;
      if (more > 0) details += ` · and ${more} more`;
      details += '.';
    }
    return `${base}${details} ${cause}`;
  }

  /* v2.171.0: the pill's own gate suffix — only when EVERY listed refusal
     named the same gate AND the list is complete (the count does not
     outrun the ≤10 feed; unseen rows could belong to the other gate).
     Mixed gates, an unknown name, or a capped list render no suffix —
     never a guess. */
  function deniedGateLabel(automation: AutomationSummary): string | null {
    const gates = automation.deniedTickGates ?? [];
    if (gates.length === 0) return null;
    if ((automation.deniedTicks7d ?? 0) > (automation.deniedTickStamps?.length ?? 0)) return null;
    const first = gates[0];
    if (typeof first !== 'string' || first.length === 0) return null;
    return gates.every((g) => g === first) ? first : null;
  }

  function findDiagnosticFor(
    list: BranchDiagnostic[],
    store: OrgSummaryStore,
  ): BranchDiagnostic | null {
    return list.find((b) => b.storeId === store.id) ?? null;
  }

  // v2.182.0: the branches table's tuning helpers — ONE block, defined
  // once, feeding the driven header, the visibility menu, the resize
  // handles and the export. The week join is by storeId (never row order,
  // the same rule the cells speak); a branch with no week entry sorts LAST
  // in both directions (the comparator's honesty contract — honest
  // absence never wins a loudest-first sort, never hides in a
  // smallest-first one either).
  const branchTrendById = useMemo(
    () => new Map((summary?.perStoreTrend ?? []).map((t) => [t.storeId, t])),
    [summary],
  );
  // v2.182.0: the rows the table AND the CSV export speak — ONE
  // comparator, one order, never two (the matrix's v2.180.0 rule, carried
  // across the page). Null sort state → the API's arrival order, copied.
  const branchRows = useMemo(
    () =>
      summary
        ? sortMatrixRows(summary.stores, branchSort, (s) => branchTrendById.get(s.id)?.weekTotal)
        : [],
    [summary, branchSort, branchTrendById],
  );
  const onBranchSort = (key: string) => setBranchSort((prev) => nextSortState(prev, key));
  const branchAriaSortOf = (key: string): 'ascending' | 'descending' | 'none' =>
    branchSort?.key === key ? (branchSort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const branchShown = BRANCH_TABLE_COLS.filter((c) => branchVisible[c.key] !== false);
  const branchWidthOf = (c: BranchColDef) => branchWidths[c.key] ?? c.width;
  // v2.182.0: the drag-resize — the matrix's exact recipe (mousedown on
  // the header's separator, window-tracked move/up, per-column min floor,
  // the saved width wins over the default). The drag lands as ONE debounced
  // save through the persist effect above.
  const onBranchResizeDown = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    const col = BRANCH_TABLE_COLS.find((c) => c.key === key);
    if (!col) return;
    branchDragging.current = { key, startX: e.clientX, startW: branchWidthOf(col) };
    const move = (ev: MouseEvent) => {
      if (!branchDragging.current) return;
      const w = Math.max(
        col.min,
        branchDragging.current.startW + ev.clientX - branchDragging.current.startX,
      );
      setBranchWidths((prev) => ({ ...prev, [key]: w }));
    };
    const up = () => {
      branchDragging.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  // v2.182.0: Reset layout — every remembered choice back to stock, the
  // stored key cleared with it (the persist effect sees the stock shape
  // and keeps the storage honest). The note is the visible, polite
  // confirmation — the same pattern the export note speaks.
  const resetBranchLayout = () => {
    setBranchWidths({});
    setBranchVisible({});
    setBranchSort(null);
    setBranchDense(false);
    setBranchLayoutNote('Branch table layout reset to defaults');
  };

  // v2.183.0: the rows the drill-down table AND the CSV export speak — ONE
  // comparator, one order, never two (the matrix's v2.180.0 rule, now
  // across ALL THREE dense tables). Null sort state → the API's arrival
  // order, copied. A summary without the hrPerStore block (HR module off,
  // non-org scope) renders no rows at all — the same honest absence the
  // collapsed door has always spoken.
  const hrRows = useMemo(
    () => (summary?.hrPerStore ? sortHrDrillRows(summary.hrPerStore, hrSort) : []),
    [summary, hrSort],
  );
  const onHrSort = (key: string) => setHrSort((prev) => nextHrSortState(prev, key));
  const hrAriaSortOf = (key: string): 'ascending' | 'descending' | 'none' =>
    hrSort?.key === key ? (hrSort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  // v2.183.0: Reset — the drill-down's escape hatch from its remembered
  // sort and density (the door state is NOT reset here: the owner is
  // looking at the open panel, and the toggle itself is the door's
  // escape). The note is the visible, polite confirmation.
  const resetHrDrillLayout = () => {
    setHrSort(null);
    setHrDense(false);
    setHrLayoutNote('Drill-down layout reset to defaults');
  };

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
      const data = res.json?.data as { yesterday?: unknown; stats?: unknown } | undefined;
      // v2.189.0: the WEEK shape rides the same answer — `stats.weekVisits`
      // (the denominator) and `stats.weekReviewerRows` (the roster) are the
      // trailing-7-day twin of the yesterday digest. Parsed with the SAME
      // tolerance: only provably sound fields survive; an absent field
      // exports without the week sub-section.
      const st = data?.stats as
        | {
            weekVisits?: unknown;
            weekReviewerRows?: unknown; // v2.189.0: the week roster array
          }
        | undefined;
      const weekRows = Array.isArray(st?.weekReviewerRows)
        ? (st.weekReviewerRows as Array<{ name?: unknown; visits?: unknown }>)
            .filter(
              (r): r is { name: string; visits: number } =>
                typeof r?.name === 'string' && typeof r?.visits === 'number',
            )
            .map((r) => ({ name: r.name, visits: r.visits }))
        : undefined;
      const week =
        st && typeof st.weekVisits === 'number' && weekRows && weekRows.length > 0
          ? { visits: st.weekVisits, reviewerRows: weekRows }
          : undefined;
      const y = data?.yesterday as
        | {
            label?: unknown;
            visits?: unknown;
            clears?: unknown;
            reviewers?: unknown; // the distinct-reviewer COUNT
            requests?: unknown;
            busiestBranch?: unknown;
            topReviewer?: unknown;
            reviewerRows?: unknown; // v2.186.0: the roster array (the API's field)
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
          // v2.186.0: the reviewer roster rides the desk block when the
          // answer carried it (OPTIONAL by contract — an older answer
          // exports without the sub-section; the parse keeps only provably
          // sound rows: a string name and a number visits). Named
          // `reviewerRows` because the desk block's `reviewers` NUMBER (the
          // distinct count) predates it and keeps its meaning.
          reviewerRows: Array.isArray(y.reviewerRows)
            ? (y.reviewerRows as Array<{ name?: unknown; visits?: unknown }>)
                .filter(
                  (r): r is { name: string; visits: number } =>
                    typeof r?.name === 'string' && typeof r?.visits === 'number',
                )
                .map((r) => ({ name: r.name, visits: r.visits }))
            : undefined,
          // v2.189.0: the week shape rides when the answer carried it (the
          // same tolerant parse — provably sound rows only). Absent → the
          // file ends at the v2.188.0 shape, never a hole.
          week,
        };
      }
    } catch {
      /* the desk section is best-effort by contract — the branches export
         must never fail because the morning note did not answer */
    }
    if (!desk) deskNote = ' · desk activity unavailable';
    // v2.178.0: the week by branch rides the same download — the summary's
    // own perStoreTrend block joined to the branch names by storeId (the
    // drill-down's join, 'Branch' when a name cannot resolve). NO second
    // fetch: the block has ridden every summary response since v2.174.0, so
    // the file costs the poll nothing.
    const trendRows = (summary.perStoreTrend ?? []).map((t) => ({
      storeName: summary.stores.find((s) => s.id === t.storeId)?.name ?? 'Branch',
      weekTotal: t.weekTotal,
      priorWeekTotal: t.priorWeekTotal,
    }));
    const csv = buildBranchesCsv(
      // v2.182.0: the export reads the SORTED rows — the file mirrors what
      // the owner sees, arrival order when nothing is sorted (the matrix's
      // v2.180.0 rule, one vocabulary across both dense tables).
      branchRows.map((s) => ({
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
      // v2.183.0: the section reads the SORTED rows — the SAME hrRows memo
      // the table body speaks, so the file mirrors what the owner sees (the
      // matrix's v2.180.0 rule, now across all three dense tables).
      hrRows.map((r) => ({
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
      // v2.178.0: the week by branch as the fourth section (empty when the
      // payload lacked the block — the file ends at the v2.177.0 shape).
      trendRows,
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
    // v2.178.0: the note counts the sections it actually wrote — the owner
    // can tell at a glance whether the week (and the desk) made the file.
    const sections =
      1 +
      (summary.hrPerStore && summary.hrPerStore.length > 0 ? 1 : 0) +
      (desk ? 1 : 0) +
      (trendRows.length > 0 ? 1 : 0);
    setExportNote(
      `Exported ${filename} \u00b7 ${sections} section${sections === 1 ? '' : 's'}${deskNote}`,
    );
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
            <StatCard
              icon={<CircleDollarSign className="h-4 w-4" aria-hidden="true" />}
              label="Revenue today"
              value={formatKES(summary.totals.revenue)}
              footer={
                summary.trend ? (
                  <TrendFooter
                    spark={summary.trend.revenue.spark}
                    weekTotal={summary.trend.revenue.weekTotal}
                    priorWeekTotal={summary.trend.revenue.priorWeekTotal}
                    variancePct={summary.trend.revenue.variancePct}
                    mover={summary.trend.revenue.topMover}
                    format={(v) => formatKES(v)}
                    testId="metric-trend-revenue"
                  />
                ) : undefined
              }
            />
            <StatCard
              icon={<ReceiptText className="h-4 w-4" aria-hidden="true" />}
              label="Transactions today"
              value={String(summary.totals.transactions)}
              footer={
                summary.trend ? (
                  <TrendFooter
                    spark={summary.trend.transactions.spark}
                    weekTotal={summary.trend.transactions.weekTotal}
                    priorWeekTotal={summary.trend.transactions.priorWeekTotal}
                    variancePct={summary.trend.transactions.variancePct}
                    mover={summary.trend.transactions.topMover}
                    format={(v) => String(v)}
                    testId="metric-trend-transactions"
                    stroke="#2563eb"
                  />
                ) : undefined
              }
            />
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
                {/* v2.183.0: the header row is now a DIV hosting three
                    SIBLINGS — the open/close button, and the drill-down's own
                    owner controls (the polite note, the conditional Reset,
                    the Compact toggle). A button can never nest inside a
                    button (invalid HTML, a screen-reader trap), so the
                    v2.182.0 controls join as siblings instead of children —
                    the same vocabulary, a legal tree. */}
                <div className="flex items-stretch justify-between gap-2 bg-muted/40">
                  <button
                    type="button"
                    onClick={() => setHrPerStoreOpen((v) => !v)}
                    aria-expanded={hrPerStoreOpen}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
                          on the near-black card).
                          v2.183.0: the hint that says the memory exists —
                          sort, density and the open door all save to this
                          browser, riding the same muted pair. */}
                      <span className="font-normal text-slate-600 dark:text-slate-400">
                        — headcount, cost, absence, latest run, expiry alerts per branch · layout saves to this browser
                      </span>
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 transition-transform duration-200 ${hrPerStoreOpen ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5 pr-2.5">
                    <p aria-live="polite" data-testid="org-console-hr-note" className="text-xs text-muted-foreground">
                      {hrLayoutNote}
                    </p>
                    {/* v2.183.0: Reset — muted by design (an exit, not an
                        invite), and only PRESENT when there is something to
                        reset: a stock drill-down renders no Reset at all,
                        the honest mirror of the branches table's menu item.
                        The door state is deliberately out of its scope — the
                        toggle itself is the door's escape. */}
                    {hrSort !== null || hrDense ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                        title="Restore the stock drill-down (arrival order, comfortable rows) and clear the saved layout from this browser"
                        onClick={resetHrDrillLayout}
                      >
                        <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" /> Reset
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className={`h-6 text-[11px] ${hrDense ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100' : ''}`}
                      aria-pressed={hrDense}
                      title={hrDense ? 'Compact rows on — click for comfortable rows (saved with your layout)' : 'Compact rows — denser table, saved with your layout'}
                      onClick={() => setHrDense((d) => !d)}
                    >
                      <Rows3 className="mr-1 h-3 w-3" aria-hidden="true" /> Compact
                    </Button>
                  </div>
                </div>
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
                    {/* v2.183.0: the drill-down speaks the owner vocabulary —
                        a driven header (real sort buttons over the ONE
                        HR_DRILLDOWN_COLS spec, aria-sort carrying the state,
                        the shared BranchSortGlyph wearing the orange-active /
                        hover-chevrons vocabulary the other two tables speak)
                        and the Compact density override. Sort semantics live
                        in the drill-down's OWN pure lib (the sibling of the
                        matrix's — numbers loudest-first, text A→Z, and the
                        payroll column by STATUS RANK since v2.190.0 — the
                        badge's finality ladder, a branch with no payroll run
                        sorting LAST in both directions). */}
                    <table className={`w-full text-sm${hrDense ? ' [&_td]:px-2 [&_td]:py-1 [&_th]:py-1' : ''}`}>
                      <thead className="sticky top-0 bg-card">
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          {HR_DRILLDOWN_COLS.map((c) => (
                            <th
                              key={c.key}
                              className={`${c.pad} py-2 font-medium ${c.align === 'right' ? 'text-right' : ''}`}
                              aria-sort={hrAriaSortOf(c.key)}
                            >
                              <div className={`flex items-center gap-1 ${c.align === 'right' ? 'justify-end' : ''}`}>
                                <button
                                  type="button"
                                  onClick={() => onHrSort(c.key)}
                                  title={c.hint}
                                  className={`focus-ring group -ml-1 flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-muted ${
                                    hrSort?.key === c.key ? 'font-semibold text-foreground' : ''
                                  }`}
                                >
                                  <span className="whitespace-nowrap">{c.label}</span>
                                  <BranchSortGlyph state={hrSort?.key === c.key ? hrSort.dir : 'none'} />
                                </button>
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {hrRows.map((row) => {
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
              {/* v2.182.0: the branches table grows the matrix's owner
                  vocabulary — a Compact toggle (the fourth tunable
                  dimension, aria-pressed carrying the state, the orange
                  pressed family marking it active) and a Columns menu
                  (visibility checkboxes over the ONE column spec, a hint
                  line that says the memory exists, and a muted Reset
                  layout escape hatch). The layout note is the polite,
                  visible confirmation for the actions that have no other
                  surface — the same one-line pattern the export note
                  speaks. */}
              <p aria-live="polite" data-testid="org-console-layout-note" className="text-xs text-muted-foreground">
                {branchLayoutNote}
              </p>
              <Button
                size="sm"
                variant="outline"
                className={`h-7 text-[11px] ${branchDense ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100' : ''}`}
                aria-pressed={branchDense}
                title={branchDense ? 'Compact rows on — click for comfortable rows (saved with your layout)' : 'Compact rows — denser table, saved with your layout'}
                onClick={() => setBranchDense((d) => !d)}
              >
                <Rows3 className="mr-1 h-3 w-3" aria-hidden="true" /> Compact
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 text-[11px]">
                    <SlidersHorizontal className="mr-1 h-3 w-3" aria-hidden="true" /> Columns
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                  <DropdownMenuLabel>Column visibility</DropdownMenuLabel>
                  {/* v2.182.0: the hint that says the memory exists — sort,
                      hidden columns, widths and density all save to this
                      browser, muted-foreground family (the a11y pair). */}
                  <p className="px-2 pb-1.5 text-[10px] leading-4 text-muted-foreground">
                    Sort, hidden columns, widths and density save to this browser automatically.
                  </p>
                  {BRANCH_TABLE_COLS.map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted">
                      <Checkbox
                        checked={branchVisible[c.key] !== false}
                        onCheckedChange={(v) => setBranchVisible((p) => ({ ...p, [c.key]: Boolean(v) }))}
                      />
                      {c.label}
                    </label>
                  ))}
                  {/* v2.182.0: Reset layout — the owner's escape hatch from
                      every remembered choice, muted by design (an exit,
                      not an invite). */}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={resetBranchLayout}
                    title="Restore the stock table and clear the saved layout from this browser"
                    className="text-[11px] text-muted-foreground focus:text-foreground"
                  >
                    <RotateCcw className="mr-2 h-3 w-3" aria-hidden="true" /> Reset layout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
                aria-busy={exporting}
              >
                <Download
                  className={`mr-1 h-3 w-3${exporting ? ' animate-pulse' : ''}`}
                  aria-hidden="true"
                />
                {exporting ? 'Exporting\u2026' : 'Export CSV'}
              </Button>
              <p className="hidden text-xs text-muted-foreground sm:block">Opening a branch workspace keeps this console tab available</p>
            </div>
          </div>
          {/* v2.149.0: min-w-0 — same intrinsic-min-content propagation as the
              drill-down above (measured: the table's 978px min-content pushed
              the console to 1012px at 390 viewport); tabIndex names + focuses
              the scrolling region once it actually scrolls on a phone. */}
          {/* v2.182.0: the branches table learns the matrix's full owner
              vocabulary — sortable headers (the ONE comparator, aria-sort
              carrying the state), drag-resizable widths (the separator
              recipe, defaults from the column spec, saved widths winning
              through the prefs spine), hideable columns and a compact
              density. The v2.175.0 comment rides with the 7d trend column
              it describes. */}
          {/* v2.175.0: the week's shape per branch — sits beside the
              revenue column it decorates, same gross vocabulary. */}
          <div
            className="min-w-0 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            role="region"
            tabIndex={0}
            aria-label="Branches, scrollable table"
          >
            <table className={`w-full text-sm${branchDense ? ' [&_td]:px-2 [&_td]:py-1 [&_th]:py-1' : ''}`}>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  {branchShown.map((c) => (
                    <th
                      key={c.key}
                      style={{ width: branchWidthOf(c), minWidth: branchWidthOf(c) }}
                      className={`px-4 py-2 font-medium ${c.align === 'right' ? 'text-right' : ''}`}
                      aria-sort={branchAriaSortOf(c.key)}
                    >
                      <div className={`flex items-center gap-1 ${c.align === 'right' ? 'justify-end' : ''}`}>
                        {c.sortable ? (
                          <button
                            type="button"
                            onClick={() => onBranchSort(c.key)}
                            className={`focus-ring group -ml-1 flex items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-muted ${
                              branchSort?.key === c.key ? 'font-semibold text-foreground' : ''
                            }`}
                          >
                            <span className="whitespace-nowrap">{c.label}</span>
                            <BranchSortGlyph state={branchSort?.key === c.key ? branchSort.dir : 'none'} />
                          </button>
                        ) : (
                          <span className="whitespace-nowrap">{c.label}</span>
                        )}
                        <span
                          role="separator"
                          aria-orientation="vertical"
                          className="ml-1 h-4 w-1 cursor-col-resize rounded bg-border hover:bg-orange-400"
                          onMouseDown={(e) => onBranchResizeDown(c.key, e)}
                          title="Drag to resize"
                        />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {branchRows.map((store) => {
                  const inactive = store.status !== 'ACTIVE';
                  // v2.175.0: this branch's 7-day revenue spark, joined by
                  // storeId (never row order). Absent payload (an older
                  // cached response without perStoreTrend) or a missing
                  // entry renders a muted "—" — honest absence, never a
                  // fabricated shape.
                  const storeTrend =
                    summary.perStoreTrend?.find((t) => t.storeId === store.id) ?? null;
                  // v2.177.0: the accessible verdict for this branch's week —
                  // computed once here, spoken as the SECOND sr-only sentence
                  // in the 7d cell (null → no words, the base clause already
                  // said everything there is).
                  const deltaWords = storeTrend
                    ? weekDeltaWords(storeTrend.weekTotal, storeTrend.priorWeekTotal ?? 0)
                    : null;
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
                      {/* v2.182.0: every cell wraps in its column's
                          visibility — a hidden column's td simply does not
                          render, so the row stays a row (never an empty
                          gap) and the header stays in step. */}
                      {branchVisible.branch !== false && (
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
                      )}
                      {branchVisible.revenue !== false && (
                      <td className="px-4 py-3 text-right tabular-nums">{formatKES(store.todayRevenue)}</td>
                      )}
                      {/* v2.175.0: the branch's 7-day revenue spark — the SAME
                          Sparkline primitive the header cards speak, muted
                          slate so a table full of them never out-screams the
                          cards; the numbers live in the title tooltip + the
                          sr-only clause (the svg is aria-hidden decoration).
                          w-[84px] keeps every row's spark column equally
                          wide so the digits to the right stop dancing.
                          v2.177.0: the week learns its own variance — the
                          WeekDeltaChip stacks under the spark (up emerald /
                          down red / flat muted, the lib's weekDelta math),
                          the tooltip gains the prior week, and a SECOND
                          sr-only sentence speaks the verdict so the base
                          clause keeps its exact shape. No prior week → no
                          chip, no words, nothing fabricated. */}
                      {branchVisible.week !== false && (
                      <td className="w-[84px] px-4 py-3">
                        {storeTrend ? (
                          <div
                            className="flex w-[76px] flex-col gap-0.5"
                            title={`7-day revenue ${formatKES(storeTrend.weekTotal)} (gross)${storeTrend.priorWeekTotal ? ` · prior ${formatKES(storeTrend.priorWeekTotal)}` : ''}`}
                          >
                            <Sparkline data={storeTrend.spark} stroke="#64748b" width={72} height={20} />
                            <WeekDeltaChip current={storeTrend.weekTotal} prior={storeTrend.priorWeekTotal ?? 0} />
                            <span className="sr-only">7-day revenue {formatKES(storeTrend.weekTotal)}</span>
                            {deltaWords ? <span className="sr-only">{deltaWords}</span> : null}
                          </div>
                        ) : (
                          <span className="text-muted-foreground" aria-hidden="true">
                            —
                          </span>
                        )}
                      </td>
                      )}
                      {branchVisible.txns !== false && (
                      <td className="px-4 py-3 text-right tabular-nums">{store.todayTransactions}</td>
                      )}
                      {branchVisible.low !== false && (
                      <td className={`px-4 py-3 text-right tabular-nums ${store.lowStockCount > 0 ? 'text-amber-700 font-medium dark:text-amber-400' : ''}`}>{store.lowStockCount}</td>
                      )}
                      {branchVisible.overdue !== false && (
                      <td className={`px-4 py-3 text-right tabular-nums ${store.overdueRentals > 0 ? 'text-red-600 font-medium' : ''}`}>{store.overdueRentals}</td>
                      )}
                      {branchVisible.debt !== false && (
                      <td className="px-4 py-3 text-right tabular-nums">{formatKES(store.debtOutstanding)}</td>
                      )}
                      {branchVisible.mpesa !== false && (
                      <td className="px-4 py-3 text-right tabular-nums">{store.pendingMpesa}</td>
                      )}
                      {branchVisible.workspace !== false && (
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
                                    /* v2.168.0: the accessible name IS the
                                        hover sentence now — one truth, two
                                        surfaces (the title stays for the
                                        mouse; AT hears the same intent). */
                                    aria-label={`Open the People & Payroll tab pre-filtered to ${store.name}`}
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
                      )}
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
            {/* v2.170.0: the refusal becomes visible — a wrong-secret tick
                used to vanish (403, no ledger row), leaving a green gate
                with an aging tick and no explanation. The gate now writes
                CRON_TICK_DENIED (only for denials that SENT a secret), and
                the card counts them in the same 7-day window as the failed
                ticks. Amber — the same family as the unset posture — with
                the full v2.167/v2.168 hint treatment: title, tab stop,
                sr-only copy, visible bubble. Zero denials render nothing:
                silence does not invent a problem. */}
            {automationPhase === 'ready' && automation && (automation.deniedTicks7d ?? 0) > 0 && (
              <span
                data-testid="automation-denied-pill"
                className="relative group inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-1"
                title={deniedTickTooltip(automation)}
                tabIndex={0}
              >
                {automation.deniedTicks7d} denied tick{(automation.deniedTicks7d ?? 0) === 1 ? '' : 's'} in 7d
                {/* v2.171.0: when every refusal the ledger lists named the
                    SAME gate (and the list is complete), the pill itself
                    says which — a stale secret then points at one side of
                    the arming walkthrough at a glance. Mixed or unknown
                    gates render no suffix, never a guess. */}
                {deniedGateLabel(automation) && ` · ${deniedGateLabel(automation)}`}
                <span className="sr-only">{deniedTickTooltip(automation)}</span>
                <span
                  aria-hidden="true"
                  data-testid="automation-denied-bubble"
                  className={`${HINT_BUBBLE} normal-case tracking-normal`}
                >
                  {deniedTickTooltip(automation)}
                </span>
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
                  {/* v2.167.0: the exact stamp rides the screen-reader line
                      too — the tooltip stops being mouse-only. */}
                  <span className="sr-only">
                    (recorded {formatEatStamp(new Date(automation.lastTick.at))})
                  </span>
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
                    className="relative group inline-flex items-center rounded-full border border-red-300 bg-red-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1"
                    title={failedTickTooltip(automation)}
                    /* v2.167.0: the pill reaches the keyboard — focusable
                       while it has an exact-tick sentence to say (a focus
                       ring IS the affordance), never a dead tab stop when
                       the stamps are absent. */
                    tabIndex={failedTickTooltip(automation) ? 0 : undefined}
                  >
                    {automation.lastTick.failedCount} failed tick
                    {automation.lastTick.failedCount === 1 ? '' : 's'} in 7d
                    {failedTickTooltip(automation) && (
                      <span className="sr-only">{failedTickTooltip(automation)}</span>
                    )}
                    {/* v2.168.0: the stamps become VISIBLE on keyboard focus —
                        a popover bubble overlays the cadence line below (an
                        absolute overlay, so the two-row chip area never
                        reflows), aria-hidden because the sr-only line above
                        already speaks it once. Overrides the pill's 9px
                        uppercase display type — the bubble reads as prose. */}
                    {failedTickTooltip(automation) && (
                      <span
                        aria-hidden="true"
                        data-testid="automation-failed-bubble"
                        className={`${HINT_BUBBLE} normal-case tracking-normal`}
                      >
                        {failedTickTooltip(automation)}
                      </span>
                    )}
                  </span>
                )}
              </div>
              {/* v2.172.0: the card EXPECTS the tick. The Last-tick line
                  above is history ("3h ago"); this line is the honest
                  answer to "when is the next one due, and is the
                  heartbeat on time?" — computed once from the ledger
                  read's own anchors (generatedAt is the server's clock;
                  the browser's never enters the math). The sentence is
                  the full visible text, so unlike the compressed pills
                  it needs no tooltip and no tab stop: role="note" is
                  read by screen readers as-is, and the state dot is
                  decorative (aria-hidden). Tint families: emerald
                  on-time, amber overdue, muted unarmed — the same three
                  voices the rest of the card speaks. */}
              {(() => {
                const expectation = nextTickExpectation({
                  lastTickAt: automation.lastTick.at,
                  generatedAt: automation.generatedAt,
                  secretConfigured: automation.secretConfigured,
                  vercelHourUtc: automation.cadence.vercelHourUtc,
                });
                if (!expectation) return null;
                return (
                  <p
                    role="note"
                    data-testid="automation-expectation"
                    className={`flex items-center gap-1.5 text-xs ${expectationTextClass(expectation.state)}`}
                  >
                    <span
                      aria-hidden="true"
                      data-testid="automation-expectation-dot"
                      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${expectationDotClass(expectation.state)}`}
                    />
                    <span>{expectation.text}</span>
                  </p>
                );
              })()}
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
                          it; an unknown name renders bare - never a guess.
                          v2.167.0: hinted chips also reach the KEYBOARD -
                          a tab stop with a family-colored focus ring, and
                          the ownership line rides an sr-only copy so the
                          hint is no longer mouse-only. */
                      title={AUTOMATION_SUBJOB_HINTS[job.name]}
                      tabIndex={AUTOMATION_SUBJOB_HINTS[job.name] ? 0 : undefined}
                      className={
                        job.ok
                          ? `relative group inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700${
                              AUTOMATION_SUBJOB_HINTS[job.name] ? ' cursor-help' : ''
                            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1`
                          : `relative group inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700${
                              AUTOMATION_SUBJOB_HINTS[job.name] ? ' cursor-help' : ''
                            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1`
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
                        /* v2.168.0: the suffix speaks for itself — the count
                            is the sweep's own ledger row, and "clean" means
                            zero expired sessions at tick time, not silence. */
                        <span
                          className="tabular-nums cursor-help"
                          title={
                            job.deleted > 0
                              ? `The reaper deleted ${job.deleted} expired session${job.deleted === 1 ? '' : 's'} — the sweep's own ledger count.`
                              : 'The reaper swept and deleted nothing — zero expired sessions at tick time.'
                          }
                        >
                          · {job.deleted > 0 ? `reaped ${job.deleted}` : 'clean'}
                        </span>
                      )}
                      {!job.ok && (
                        /* v2.168.0: the failure suffix names its source — the
                            dispatcher's own recorded HTTP result. */
                        <span
                          className="tabular-nums cursor-help"
                          title={`The dispatcher recorded HTTP ${job.status} for this sub-job — the tick's own result, not a guess.`}
                        >
                          · HTTP {job.status}
                        </span>
                      )}
                      {/* v2.167.0: the ownership line rides an sr-only copy
                          (only when hinted) — screen readers get the same
                          sentence the hover tooltip says, and an unhinted
                          chip stays silent, never a guess. */}
                      {AUTOMATION_SUBJOB_HINTS[job.name] && (
                        <span className="sr-only"> — {AUTOMATION_SUBJOB_HINTS[job.name]}</span>
                      )}
                      {/* v2.168.0: the hint becomes VISIBLE to sighted
                          keyboard users — on focus the same sentence renders
                          in a popover bubble overlaying the line below (an
                          absolute overlay: the chip list never reflows),
                          aria-hidden because the sr-only line already spoke
                          it. An unhinted chip renders no bubble, never a
                          guess. */}
                      {AUTOMATION_SUBJOB_HINTS[job.name] && (
                        <span
                          aria-hidden="true"
                          data-testid="automation-subjob-hint-bubble"
                          className={HINT_BUBBLE}
                        >
                          {AUTOMATION_SUBJOB_HINTS[job.name]}
                        </span>
                      )}
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
