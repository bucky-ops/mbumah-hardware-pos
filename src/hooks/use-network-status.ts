'use client';

// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — useNetworkStatus hook
// ─────────────────────────────────────────────────────────────────────────────
//
// A small, reusable React hook that exposes the browser's online/offline
// status reactively. Built on `useSyncExternalStore` (React 18+) so it is
// tear-free and concurrent-safe — no useState/useEffect flicker.
//
// Why a dedicated hook?
//   The existing offline-sync infra (src/lib/offline-sync.ts) attaches its
//   own window listeners, but POS UI components need a CLEAN, reactive way
//   to:
//     • show a red banner when offline
//     • disable the "M-Pesa STK Push" button when offline (no point trying)
//     • show a "pending syncs" badge when online but the queue is non-empty
//
//   Reading `navigator.onLine` directly in render is NOT reactive — it won't
//   re-render when the status flips. This hook solves that.
//
// Browser support: `online` / `offline` events + `navigator.onLine` are
// supported in every evergreen browser. On the server (SSR) we default to
// `true` (optimistic) to avoid a hydration mismatch where the server renders
// "offline" and the client immediately flips to "online".
//
// Usage:
//   const { isOnline, isOffline, wasOffline } = useNetworkStatus();
//
//   if (isOffline) {
//     return <OfflineBanner />;
//   }
// ─────────────────────────────────────────────────────────────────────────────

import { useSyncExternalStore, useCallback } from 'react';

// ── External store (module-level singleton) ──────────────────────────────────
//
// A tiny external store so every component using the hook shares ONE set of
// window listeners (not one per component instance). This is the idiomatic
// React 18+ pattern for subscribing to imperative APIs.

interface NetworkState {
  isOnline: boolean;
  /** ISO timestamp of the most recent online→offline OR offline→online flip. */
  lastChangeAt: string;
  /** True if the connection has EVER dropped during this page session. */
  wasOffline: boolean;
}

let currentState: NetworkState = {
  // Default to `true` on both server and first client render to avoid
  // hydration mismatches. The real value is read inside `subscribe()` /
  // `prime()` on the client.
  isOnline: true,
  lastChangeAt: new Date(0).toISOString(),
  wasOffline: false,
};

const listeners = new Set<() => void>();

function setState(next: NetworkState) {
  // Shallow compare to avoid spurious re-renders.
  if (
    next.isOnline === currentState.isOnline &&
    next.lastChangeAt === currentState.lastChangeAt
  ) {
    return;
  }
  currentState = next;
  listeners.forEach((l) => l());
}

function getSnapshot(): NetworkState {
  return currentState;
}

// Server snapshot — always "online" so SSR HTML matches the first client render.
function getServerSnapshot(): NetworkState {
  return {
    isOnline: true,
    lastChangeAt: new Date(0).toISOString(),
    wasOffline: false,
  };
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);

  // On the FIRST subscribe, attach the window listeners and prime the real
  // value. This lazy-attach avoids touching `window` during SSR.
  if (listeners.size === 1 && typeof window !== 'undefined') {
    const handleOnline = () => {
      setState({
        isOnline: true,
        lastChangeAt: new Date().toISOString(),
        wasOffline: currentState.wasOffline || false,
      });
    };

    const handleOffline = () => {
      setState({
        isOnline: false,
        lastChangeAt: new Date().toISOString(),
        wasOffline: true,
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Prime with the ACTUAL current status (navigator.onLine may already be
    // false if the page loaded while offline — the events only fire on a
    // TRANSITION, not on initial load).
    if (typeof navigator !== 'undefined') {
      const realOnline = navigator.onLine;
      if (realOnline !== currentState.isOnline) {
        setState({
          isOnline: realOnline,
          lastChangeAt: new Date().toISOString(),
          wasOffline: !realOnline,
        });
      }
    }

    // Store cleanup on the subscribe function itself so the LAST unsubscribe
    // tears down the listeners (refcount pattern).
    (subscribe as unknown as { _cleanup?: () => void })._cleanup = () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }

  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) {
      const cleanup = (subscribe as unknown as { _cleanup?: () => void })._cleanup;
      if (cleanup) {
        cleanup();
        (subscribe as unknown as { _cleanup?: () => void })._cleanup = undefined;
      }
    }
  };
}

// ── Public hook ──────────────────────────────────────────────────────────────

export interface UseNetworkStatusResult {
  /** True when the browser reports an active network connection. */
  isOnline: boolean;
  /** Convenience inverse of `isOnline`. */
  isOffline: boolean;
  /** True if the connection has dropped at least once this session. */
  wasOffline: boolean;
  /** ISO timestamp of the last online↔offline transition. */
  lastChangeAt: string;
  /** Manually re-check `navigator.onLine` and update state. Rarely needed. */
  recheck: () => void;
}

export function useNetworkStatus(): UseNetworkStatusResult {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const recheck = useCallback(() => {
    if (typeof navigator === 'undefined') return;
    const realOnline = navigator.onLine;
    if (realOnline !== currentState.isOnline) {
      setState({
        isOnline: realOnline,
        lastChangeAt: new Date().toISOString(),
        wasOffline: currentState.wasOffline || !realOnline,
      });
    }
  }, []);

  return {
    isOnline: state.isOnline,
    isOffline: !state.isOnline,
    wasOffline: state.wasOffline,
    lastChangeAt: state.lastChangeAt,
    recheck,
  };
}

// ── Optional: one-shot "is online?" check (non-reactive) ─────────────────────
//
// For code paths that just need the current value once (e.g. inside a
// mutationFn that already has its own logic), this avoids subscribing.

export function isCurrentlyOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}
