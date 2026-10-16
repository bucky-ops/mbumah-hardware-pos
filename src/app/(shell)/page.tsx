'use client';

/**
 * MBUMAH HARDWARE POS - Main Application Page
 * Refactored: components extracted into separate files for maintainability.
 * v2.16.0: the MainApp shell moved to src/components/app/main-app.tsx so the
 * branch workspace routes (/stores/{slug}/..., branch subdomains) render the
 * identical SPA shell. This file remains the root-domain entry point.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuthStore, useAppStore, useCartStore } from '@/lib/stores';
import { ErrorBoundary } from '@/components/error-boundary';
import { LoginScreen } from '@/components/login-screen';
import { ChangePasswordScreen } from '@/components/change-password-screen';
import { MainApp } from '@/components/app/main-app';

// Hydration-safe client-only mount detection
const emptySubscribe = () => () => {};
function useHasMounted() {
  return React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * Loading watchdog - if the app remains on the "Loading…" screen for more
 * than 5 seconds, log a diagnostic error. After 10 seconds, surface a retry UI.
 */
const LOADING_WARN_MS = 5000;
const LOADING_RETRY_MS = 10000;

function useLoadingWatchdog(hasMounted: boolean) {
  const [showRetry, setShowRetry] = useState(false);

  useEffect(() => {
    if (hasMounted) return;

    const warnTimer = setTimeout(() => {
      console.error(
        '[MbumahBoot] App has been on the "Loading…" screen for >5s. ' +
          'Hydration may have failed. Diagnostics:',
        {
          href: window.location.href,
          origin: window.location.origin,
          userAgent: navigator.userAgent,
          hasToken: !!localStorage.getItem('mbt_token'),
          scripts: Array.from(document.querySelectorAll('script[src]')).map(
            (s) => s.getAttribute('src'),
          ),
          readyState: document.readyState,
          timeOnLoad: Date.now(),
        },
      );
    }, LOADING_WARN_MS);

    const retryTimer = setTimeout(() => {
      setShowRetry(true);
    }, LOADING_RETRY_MS);

    return () => {
      clearTimeout(warnTimer);
      clearTimeout(retryTimer);
    };
  }, [hasMounted]);

  return showRetry;
}

export default function HomePage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // v2.44.0: first sign-in password rotation gate — the flagged user sees
  // the forced "Set a new password" screen INSTEAD of the whole POS shell.
  const rotationPending = useAuthStore((s) => s.isAuthenticated && !!s.user?.mustChangePassword);
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage);
  const hasMounted = useHasMounted();
  const showRetry = useLoadingWatchdog(hasMounted);

  // v2.6.0: one-time guard so React StrictMode double-invocation of the
  // effect never toasts "Previous cart restored" twice.
  const cartRehydrateToastShownRef = useRef(false);

  // Hydrate auth state from localStorage on first client mount.
  // Also rehydrate the persisted app store (sidebar state, active tab, etc.)
  // and - since v2.6.0 - the persisted CART (IndexedDB 'mbt_cart_v1').
  // Defensive checks ensure this never crashes even if persist middleware
  // is removed or the store structure changes.
  useEffect(() => {
    hydrateFromStorage();
    try {
      if (useAppStore?.persist?.rehydrate) {
        useAppStore.persist.rehydrate();
      }
    } catch (err) {
      console.error('[MbumahBoot] Failed to rehydrate app store:', err);
    }

    // v2.6.0 CART RESTORATION: the cart store persists to IndexedDB with
    // skipHydration: true - rehydrate it manually here (async storage, so
    // rehydrate() resolves AFTER the cart slice is merged). If a non-empty
    // cart came back, toast ONCE so the cashier knows their sale survived
    // the logout/idle-timeout. Gated on an existing token so the toast is
    // not shown on the cold login screen.
    try {
      if (typeof useCartStore?.persist?.rehydrate === 'function') {
        void Promise.resolve(useCartStore.persist.rehydrate())
          .then(() => {
            if (cartRehydrateToastShownRef.current) return;
            cartRehydrateToastShownRef.current = true;
            const hasToken = !!localStorage.getItem('mbt_token');
            const { items } = useCartStore.getState();
            if (hasToken && items.length > 0) {
              toast.success(`Previous cart restored (${items.length} item${items.length !== 1 ? 's' : ''})`);
            }
          })
          .catch((err) => console.error('[MbumahBoot] Failed to rehydrate cart store:', err));
      }
    } catch (err) {
      console.error('[MbumahBoot] Failed to rehydrate cart store:', err);
    }
  }, [hydrateFromStorage]);

  if (!hasMounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
          {showRetry && (
            <div className="flex flex-col items-center gap-2 mt-4">
              <p className="text-xs text-muted-foreground max-w-xs text-center">
                The app is taking longer than expected to load. This may be a
                network issue or a deployment still warming up.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
                className="mt-1"
              >
                <Loader2 className="h-3 w-3 mr-1.5" />
                Retry
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // v2.44.0: password rotation checkpoint — rendered before ANY shell so a
  // temporary-password session cannot browse a single tab of the POS.
  if (rotationPending) return <ChangePasswordScreen />;

  return isAuthenticated ? <MainApp /> : <ErrorBoundary><LoginScreen /></ErrorBoundary>;
}
