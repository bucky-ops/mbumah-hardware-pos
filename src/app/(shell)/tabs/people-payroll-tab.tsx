'use client';

// v2.109.0: People & Payroll tab — the Finance & Insights home of
// "People & payroll by branch".
//
// WHY HERE: the per-branch people and payroll drill-down (headcount,
// employment cost, absence, latest payroll run, expiry alerts) lived only on
// the Expert Console (/console). Finance owners now have it in the main
// SPA's Finance & Insights group, served by the SAME shared panel component
// and the SAME /api/org/summary endpoint the console reads — one
// implementation, one server truth, zero duplicated logic.
//
// AUTH/ISOLATION (fail-closed, client and server):
//   - the tab is offered to exactly the roles /api/org/summary's guard
//     serves (SUPER_ADMIN, STORE_OWNER, ACCOUNTANT) — the sidebar renders
//     it LOCKED for everyone else (v2.12.5 pattern), and
//   - the server re-validates every request (ORG_ROLES 403 otherwise), and
//     omits the hrPerStore block unless the HR module is on AND the caller
//     holds an HR report permission — the panel then shows the precise
//     reason code, never a blank or a guessed number.
//
// All data shown is real server data; nothing is fabricated client-side.

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, UserCog } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { authorizedFetchJson } from '@/lib/api';
import {
  PeoplePayrollByBranch,
  PeoplePayrollUnavailable,
  type HrPerStoreRow,
} from '@/components/finance/people-payroll-by-branch';

type SummaryEnvelope = { success?: boolean; error?: string; data?: unknown };

async function fetchOrgSummary(): Promise<{ status: number; body: SummaryEnvelope | null }> {
  const res = await authorizedFetchJson('/api/org/summary');
  return { status: res.status, body: res.json as SummaryEnvelope | null };
}

export default function PeoplePayrollTab() {
  const [refreshKey, setRefreshKey] = useState(0);
  // v2.111.0: the tab speaks deep links. A URL carrying ?branch=<storeId>
  // opens the panel pre-filtered; every filter change mirrors back into the
  // URL (replaceState — never a navigation, never a history entry); leaving
  // the tab strips the param so a stale filter cannot haunt the next mount.
  // The seed is a LAZY initializer (no setState-in-effect): the panel only
  // renders after the client fetch resolves, so the SSR pass never disagrees.
  const [linkBranchId] = useState(() => {
    try {
      if (typeof window === 'undefined') return '';
      return new URLSearchParams(window.location.search).get('branch') ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    return () => {
      // Strip ?branch on unmount so re-mounting fresh (e.g. from the sidebar)
      // does not silently inherit an old filter.
      try {
        const sp = new URLSearchParams(window.location.search);
        if (sp.has('branch')) {
          sp.delete('branch');
          const qs = sp.toString();
          window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
        }
      } catch {
        // same honesty: no URL, no cleanup
      }
    };
  }, []);
  const mirrorBranchToUrl = (branchId: string) => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (branchId) sp.set('branch', branchId);
      else sp.delete('branch');
      const qs = sp.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    } catch {
      // no URL surface — the filter still works, it just cannot be shared
    }
  };
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['people-payroll-org-summary', refreshKey],
    queryFn: fetchOrgSummary,
    staleTime: 30_000,
    retry: 1,
  });

  const status = data?.status;
  const payload = data?.body;
  const rows: HrPerStoreRow[] | null =
    payload?.success && payload.data && typeof payload.data === 'object'
      ? ((payload.data as { hrPerStore?: HrPerStoreRow[] | null }).hrPerStore ?? null)
      : null;

  let unavailable: { code: string; detail: string } | null = null;
  if (isError) {
    unavailable = {
      code: 'API_ERROR_SAFE',
      detail: error instanceof Error ? error.message : 'The summary request failed. Try refreshing.',
    };
  } else if (status === 401 || status === 403) {
    unavailable = {
      code: 'PERMISSION_DENIED',
      detail: 'People & payroll by branch is limited to org roles (SUPER_ADMIN, STORE_OWNER, ACCOUNTANT) with an HR report permission.',
    };
  } else if (status && status >= 200 && status < 300 && !rows) {
    unavailable = {
      code: 'HR_DATA_SOURCE_UNAVAILABLE',
      detail: 'The summary answered without the per-branch HR block — the HR module is off for this organization or this role lacks the HR report permission.',
    };
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        {/* Tab header */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400">
              <UserCog className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-foreground">People &amp; Payroll</h1>
              <p className="truncate text-xs text-muted-foreground">
                Finance &amp; Insights &middot; headcount, employment cost, absence, latest run and expiry alerts per branch
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {dataUpdatedAt > 0 && (
              <span className="hidden text-[10px] text-muted-foreground sm:block">
                synced {new Date(dataUpdatedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRefreshKey((k) => k + 1);
                void refetch();
              }}
              disabled={isFetching}
              aria-label="Refresh people and payroll data"
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Body: loading skeleton, precise unavailable reason, or the panel */}
        {isLoading ? (
          <div className="space-y-3" data-testid="people-payroll-loading" role="status" aria-label="Loading people and payroll by branch">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : unavailable ? (
          <PeoplePayrollUnavailable code={unavailable.code} detail={unavailable.detail} />
        ) : rows && rows.length > 0 ? (
          <PeoplePayrollByBranch
            rows={rows}
            defaultOpen
            testIdPrefix="people-payroll-tab"
            defaultBranchId={linkBranchId}
            onBranchFilterChange={mirrorBranchToUrl}
          />
        ) : (
          <PeoplePayrollUnavailable
            code="HR_DATA_SOURCE_UNAVAILABLE"
            detail="No branches reported people and payroll data for this organization yet."
          />
        )}
      </div>
    </div>
  );
}
