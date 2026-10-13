'use client';

// MBUMAH HARDWARE POS - Branch selector (v2.16.0 subdomain workspaces)
//
// For users assigned to multiple stores (WAREHOUSE_MANAGER pattern).
// "Open workspace" opens the branch in a NEW TAB; this selector tab stays
// available (spec Phase 8). Single-assignment users are redirected to their
// workspace; unassigned users see a calm empty state.

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Building2, Boxes, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { LoginScreen } from '@/components/login-screen';
import { ErrorBoundary } from '@/components/error-boundary';
import { useAuthStore } from '@/lib/stores';
import { authorizedFetchJson } from '@/lib/api';
import { buildStoreWorkspaceUrl } from '@/lib/workspace/links';
import { useWorkspaceAuthBoot } from '@/lib/workspace/workspace-store';
import { useWorkspaceStore, type WorkspaceStoreRef } from '@/lib/workspace/workspace-store';
import { useRouter } from 'next/navigation';

interface StoreContextData {
  allowed: boolean;
  mode: string;
  store?: WorkspaceStoreRef & { status: string };
  memberships: string[];
  user: { role: string } | null;
}

interface StoreRow extends WorkspaceStoreRef {
  code: string | null;
  location: string | null;
  phone: string | null;
  status: string;
}

export function BranchSelector() {
  const hasMounted = useWorkspaceAuthBoot();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const setOrganizationMode = useWorkspaceStore((s) => s.setWorkspace);
  const router = useRouter();
  const [stores, setStores] = useState<StoreRow[] | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const redirectAttempted = useRef(false);

  useEffect(() => {
    setOrganizationMode({ store: null, hostMode: 'organization' });
    document.title = 'Select Branch | Mbumah Hardware POS';
    return () => {
      document.title = 'MBUMAH HARDWARE - POS & ERP System';
    };
  }, [setOrganizationMode]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    (async () => {
      const context = await authorizedFetchJson('/api/me/store-context');
      if (cancelled) return;
      if (!context.ok || !context.json?.success || !context.json.data) {
        setPhase('error');
        return;
      }
      const data = context.json.data as StoreContextData;
      const assignedIds = new Set<string>(data.memberships || []);

      const list = await authorizedFetchJson('/api/stores?status=ACTIVE');
      if (cancelled) return;
      const allStores = (list.json?.data as StoreRow[] | undefined) ?? [];

      // Assigned stores only (never the whole organization, except org-wide
      // roles who use the organization console instead of this selector).
      const assigned = allStores.filter(
        (s) => assignedIds.has(s.id) && s.status === 'ACTIVE',
      );

      if (assigned.length === 0) {
        setPhase('empty');
        setStores([]);
        return;
      }

      // Single-assignment members go straight to their workspace (once).
      if (assigned.length === 1 && !redirectAttempted.current) {
        redirectAttempted.current = true;
        router.replace(buildStoreWorkspaceUrl(assigned[0]));
        return;
      }

      setStores(assigned);
      setPhase('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, router]);

  if (!hasMounted) {
    return (
      <div className="min-h-screen bg-muted/30 p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="h-8 w-56 rounded bg-muted animate-pulse" />
          <div className="h-28 rounded-lg bg-muted animate-pulse" />
        </div>
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

  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-muted/30 p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <Skeleton className="h-8 w-56" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'empty') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-4 border rounded-xl p-8 bg-card">
          <Boxes className="h-10 w-10 mx-auto text-muted-foreground" aria-hidden="true" />
          <h1 className="text-lg font-semibold">No branches assigned</h1>
          <p className="text-sm text-muted-foreground">
            Your account is not assigned to any branch workspace yet. This condition has been
            logged for administrator review. Ask a store owner to assign you to a branch.
          </p>
          <Button asChild variant="outline">
            <Link href="/">Back to the home page</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'error' || !stores) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-4 border rounded-xl p-8 bg-card">
          <h1 className="text-lg font-semibold">Branch list unavailable</h1>
          <p className="text-sm text-muted-foreground">Your assigned branches could not be loaded. Please retry.</p>
          <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Building2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Select Branch</h1>
            <p className="text-xs text-muted-foreground">
              {user?.name || 'Signed in'} - {user?.role || ''}. Each workspace opens in its own tab.
            </p>
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6">
        <div className="grid gap-3 sm:grid-cols-2">
          {stores.map((store) => {
            const href = buildStoreWorkspaceUrl(store);
            return (
              <div key={store.id} className="border rounded-lg bg-card p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-1 h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: store.brandingColor || '#B45309' }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="font-medium leading-tight truncate">{store.name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3 w-3" aria-hidden="true" />
                      {store.location || 'Location not set'}
                    </p>
                  </div>
                  <Badge variant="outline" className="ml-auto text-[10px] shrink-0">
                    {store.code || 'BRANCH'}
                  </Badge>
                </div>
                <Button asChild size="sm" className="mt-auto">
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    <Building2 className="h-4 w-4 mr-1.5" aria-hidden="true" />
                    Open workspace
                    <ArrowUpRight className="h-3 w-3 ml-1" aria-hidden="true" />
                  </a>
                </Button>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
