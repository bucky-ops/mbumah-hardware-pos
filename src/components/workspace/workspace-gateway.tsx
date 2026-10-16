'use client';

// MBUMAH HARDWARE POS - Workspace gateway (v2.16.0 subdomain workspaces)
//
// Client bootstrap for branch workspaces:
//   - path mode:  /stores/juja-main/dashboard  (slug prop)
//   - subdomains: juja-main.mbumah.test/pos    (proxy rewrites internally to
//                 the same route; the slug prop arrives as the subdomain)
//
// Responsibilities:
//   1. Adopt a shared session cookie when this origin has no localStorage
//      token (cross-subdomain single sign-on, see session-cookie.ts).
//   2. Resolve + authorize the workspace via GET /api/me/store-context.
//   3. Render calm, specific states: loading, login, denied, not-found -
//      with a distinct message per cause (v2.18.0.0 reasonCode vocabulary:
//      store-not-found, store-inactive, user-not-allowed, missing-slug,
//      schema-drift, subdomain-unavailable).
//   4. On success: pin the app store to the workspace store, set the page
//      title to "{Store Name} | Mbumah Hardware POS", apply the branch
//      accent, and render the SAME MainApp shell used on the root domain.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Lock, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorBoundary } from '@/components/error-boundary';
import { LoginScreen } from '@/components/login-screen';
import { ChangePasswordScreen } from '@/components/change-password-screen';
import { MainApp } from '@/components/app/main-app';
import { useAppStore, useAuthStore } from '@/lib/stores';
import { useWorkspaceStore, type WorkspaceStoreRef } from '@/lib/workspace/workspace-store';

interface StoreContextResponse {
  success: boolean;
  error?: string;
  data?: {
    mode: 'subdomain' | 'path' | 'organization' | 'denied' | 'not-found';
    allowed: boolean;
    readOnly: boolean;
    reason?: string;
    /** Stable client-safe cause code (v2.18.0.0); see docs/store-context-resolution.md. */
    reasonCode?: string;
    hostMode: 'subdomain' | 'path' | 'organization';
    store?: WorkspaceStoreRef & { status: string; isActive: boolean; phone: string | null; email: string | null };
    memberships: string[];
    user: { id: string; email: string; name: string; role: string; storeId: string | null } | null;
  };
}

type GatewayPhase = 'loading' | 'login' | 'ready' | 'denied' | 'not-found';

function adoptCookieSession(): void {
  // Cross-subdomain SSO bootstrap: when the shared cookie domain is
  // configured, a branch subdomain origin may have the mbt_token cookie but
  // no localStorage token yet. Adopt the cookie into localStorage and let
  // fetchUser() validate it (invalid cookies are cleared by the 401 path).
  try {
    if (localStorage.getItem('mbt_token')) return;
    const match = document.cookie.match(/(?:^|;\s*)mbt_token=([^;]+)/);
    if (match && match[1]) {
      localStorage.setItem('mbt_token', decodeURIComponent(match[1]));
    }
  } catch {
    // Storage unavailable: proceed without adoption.
  }
}

function GatewaySkeleton() {
  return (
    <div className="min-h-screen bg-background p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function GatewayMessage({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-4 border rounded-xl p-8 bg-card shadow-sm">
        <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
          {icon}
        </div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
        {action}
      </div>
    </div>
  );
}

export function WorkspaceGateway({ slug }: { slug: string | null }) {
  const [phase, setPhase] = useState<GatewayPhase>('loading');
  const [deniedReason, setDeniedReason] = useState<string>('');
  // Stable client-safe cause for the not-found / denied views (v2.18.0.0).
  const [statusCode, setStatusCode] = useState<string>('');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // v2.44.0: first sign-in password rotation gate for branch workspaces —
  // mirrors the root page.tsx gate so a temporary-password session cannot
  // browse the branch shell either.
  const rotationPending = useAuthStore((s) => s.isAuthenticated && !!s.user?.mustChangePassword);
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage);
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  // Hooks must run unconditionally: the resolved workspace store is read on
  // every render (early returns below must not skip this subscription).
  const workspaceStore = useWorkspaceStore((s) => s.store);
  const bootedRef = useRef(false);

  // Same boot sequence as the root page (storage hydration is idempotent).
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    adoptCookieSession();
    hydrateFromStorage();
    try {
      if (useAppStore?.persist?.rehydrate) useAppStore.persist.rehydrate();
    } catch (err) {
      console.error('[WorkspaceBoot] Failed to rehydrate app store:', err);
    }
  }, [hydrateFromStorage]);

  const resolve = useCallback(async () => {
    setPhase('loading');
    try {
      const token = localStorage.getItem('mbt_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const query = slug ? `?slug=${encodeURIComponent(slug)}` : '';
      const res = await fetch(`/api/me/store-context${query}`, { headers, credentials: 'same-origin' });
      const json = (await res.json().catch(() => null)) as StoreContextResponse | null;

      if (!res.ok || !json?.data) {
        setStatusCode('store-not-found');
        setPhase(res.status === 401 ? 'login' : 'not-found');
        return;
      }

      const { allowed, mode, store, reason, reasonCode, hostMode, readOnly } = json.data;

      if (!allowed || !store) {
        if (mode === 'not-found' || reason === 'STORE_NOT_FOUND') {
          setStatusCode(reasonCode || 'store-not-found');
          setPhase('not-found');
        } else if (reason === 'UNAUTHENTICATED' || res.status === 401) {
          setPhase('login');
        } else {
          setDeniedReason(reason || 'ACCESS_DENIED');
          setStatusCode(reasonCode || '');
          setPhase('denied');
        }
        return;
      }

      // Success: pin the SPA to this branch and render the shared shell.
      setWorkspace({ store, hostMode, readOnly });
      const { setCurrentStoreId } = useAppStore.getState();
      if (setCurrentStoreId && currentStoreDifferent(store.id)) setCurrentStoreId(store.id);
      document.title = `${store.name} | Mbumah Hardware POS`;
      setPhase('ready');
    } catch {
      setStatusCode('store-not-found');
      setPhase('not-found');
    }
  }, [slug, setWorkspace]);

  useEffect(() => {
    // Re-resolve when auth state flips (login inside the workspace).
    // Deferred: keeps setState out of the synchronous effect body.
    const initial = setTimeout(() => void resolve(), 0);
    return () => clearTimeout(initial);
  }, [resolve, isAuthenticated]);

  // Reset the document title when leaving the workspace.
  useEffect(() => {
    return () => {
      document.title = 'MBUMAH HARDWARE - POS & ERP System';
    };
  }, []);

  if (phase === 'loading') return <GatewaySkeleton />;

  // v2.44.0: password rotation checkpoint — before the login/ready branches
  // so an authenticated-but-flagged session sees the forced rotation screen
  // no matter which workspace route it landed on.
  if (isAuthenticated && rotationPending) return <ChangePasswordScreen />;

  if (phase === 'login') {
    // Same-origin login: after success the effect above re-resolves and the
    // user lands back in THIS branch workspace (callbackUrl behavior).
    return (
      <ErrorBoundary>
        <LoginScreen />
      </ErrorBoundary>
    );
  }

  if (phase === 'not-found') {
    // One calm message per cause (v2.18.0.0); unknown codes fall back to the
    // plain store-not-found copy. Legacy payloads (no reasonCode) also land
    // on the plain copy, which keeps old API responses rendering correctly.
    if (statusCode === 'missing-slug') {
      return (
        <GatewayMessage
          icon={<SearchX className="h-6 w-6" aria-hidden="true" />}
          title="Branch workspace unavailable"
          description="Branch workspace unavailable. Store slug is not configured."
          action={
            <Button asChild variant="outline">
              <Link href="/">Go to the home page</Link>
            </Button>
          }
        />
      );
    }
    if (statusCode === 'schema-drift') {
      return (
        <GatewayMessage
          icon={<AlertTriangle className="h-6 w-6" aria-hidden="true" />}
          title="Schema update needed"
          description="The local database needs a schema update. Contact the administrator or run the safe repair process."
          action={
            <Button asChild variant="outline">
              <Link href="/">Go to the home page</Link>
            </Button>
          }
        />
      );
    }
    return (
      <GatewayMessage
        icon={<SearchX className="h-6 w-6" aria-hidden="true" />}
        title="Branch not found"
        description="Branch workspace not found. Check the store slug or open the workspace from the organization console."
        action={
          <Button asChild variant="outline">
            <Link href="/">Go to the home page</Link>
          </Button>
        }
      />
    );
  }

  if (phase === 'denied') {
    const inactive = statusCode === 'store-inactive' || deniedReason === 'STORE_INACTIVE';
    const subdomainUnavailable = statusCode === 'subdomain-unavailable';
    return (
      <GatewayMessage
        icon={
          inactive || subdomainUnavailable ? (
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          ) : (
            <Lock className="h-6 w-6" aria-hidden="true" />
          )
        }
        title="You do not have access to this branch."
        description={
          inactive
            ? 'This branch is currently inactive. Contact the store owner or system administrator.'
            : subdomainUnavailable
              ? 'Subdomain workspace is not available on this host. Use the path-based branch workspace.'
              : 'Your account is not assigned to this branch. If you believe this is a mistake, contact a store owner or administrator. This attempt has been logged.'
        }
        action={
          <Button asChild variant="outline">
            <Link href="/">Back to your workspace</Link>
          </Button>
        }
      />
    );
  }

  // Phase 'ready': the resolved workspace store drives the branch accent.
  const accent = workspaceStore?.brandingColor || '#B45309';
  return (
    <div
      style={{ ['--store-brand' as string]: accent }}
      className="min-h-screen bg-background"
      data-workspace-slug={workspaceStore?.slug || slug || undefined}
    >
      <ErrorBoundary>
        <MainApp />
      </ErrorBoundary>
    </div>
  );
}

function currentStoreDifferent(storeId: string): boolean {
  try {
    return useAppStore.getState().currentStoreId !== storeId;
  } catch {
    return false;
  }
}
