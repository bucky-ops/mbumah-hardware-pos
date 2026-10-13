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

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Building2,
  CircleDollarSign,
  Clock,
  LayoutDashboard,
  MessagesSquare,
  PackageOpen,
  ReceiptText,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { LoginScreen } from '@/components/login-screen';
import { ErrorBoundary } from '@/components/error-boundary';
import { useAuthStore } from '@/lib/stores';
import { authorizedFetchJson } from '@/lib/api';
import { getBranchWorkspaceHref } from '@/lib/branch-workspace';
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
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'warn';
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={tone === 'warn' ? 'text-amber-600' : 'text-muted-foreground'}>{icon}</span>
        {label}
      </div>
      <p className={`mt-2 text-xl font-semibold tabular-nums ${tone === 'warn' ? 'text-amber-600' : ''}`}>{value}</p>
    </div>
  );
}

export function OrgConsole() {
  const hasMounted = useWorkspaceAuthBoot();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const setOrganizationMode = useWorkspaceStore((s) => s.setWorkspace);
  const [summary, setSummary] = useState<OrgSummary | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    setOrganizationMode({ store: null, hostMode: 'organization' });
    document.title = 'Organization Console | Mbumah Hardware POS';
    return () => {
      document.title = 'MBUMAH HARDWARE - POS & ERP System';
    };
  }, [setOrganizationMode]);

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
    <div className="min-h-screen bg-muted/30">
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
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
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

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
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

        {/* Store performance table */}
        <section aria-label="Store performance" className="border rounded-lg bg-card overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold">Branches ({summary.stores.length})</h2>
            <p className="text-xs text-muted-foreground">Opening a branch workspace keeps this console tab available</p>
          </div>
          <div className="overflow-x-auto">
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
                  // Safe v2.18.0.0 builder: path URL on localhost / raw IPs,
                  // subdomain URL only when every safety check passes, null
                  // for inactive stores or a missing slug (never a broken
                  // placeholder path).
                  const href = getBranchWorkspaceHref({
                    store: { slug: store.slug, subdomain: store.subdomain, isActive: !inactive },
                    currentHost: typeof window !== 'undefined' ? window.location.host : '',
                    protocol: typeof window !== 'undefined' ? window.location.protocol : undefined,
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
                      <td className={`px-4 py-3 text-right tabular-nums ${store.lowStockCount > 0 ? 'text-amber-600 font-medium' : ''}`}>{store.lowStockCount}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${store.overdueRentals > 0 ? 'text-red-600 font-medium' : ''}`}>{store.overdueRentals}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatKES(store.debtOutstanding)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{store.pendingMpesa}</td>
                      <td className="px-4 py-3 text-right">
                        {href ? (
                          <Button asChild size="sm" variant="outline" disabled={inactive}>
                            <a href={href} target="_blank" rel="noopener noreferrer">
                              <Building2 className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                              Open branch workspace
                              <ArrowUpRight className="h-3 w-3 ml-1" aria-hidden="true" />
                            </a>
                          </Button>
                        ) : (
                          <span
                            className="inline-block max-w-[10rem] text-xs text-muted-foreground"
                            title={
                              inactive
                                ? 'This branch is currently inactive. The workspace cannot be opened.'
                                : 'Branch workspace unavailable. Store slug is not configured.'
                            }
                          >
                            Branch workspace unavailable
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
      </main>
    </div>
  );
}
