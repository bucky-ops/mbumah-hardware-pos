'use client';

// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — OfflineIndicator (sticky banner)
// ─────────────────────────────────────────────────────────────────────────────
//
// A small, non-intrusive banner that sits at the very top of the POS screen
// and tells the cashier the current network status + pending-sync count.
//
// Behaviour:
//   ┌────────────────────────────────────────────────────────────────────┐
//   │  OFFLINE                                                           │
//   │  📶 Offline Mode: Sales will sync when connected.                 │
//   │  [3 sale(s) queued — will sync automatically when back online]    │
//   └────────────────────────────────────────────────────────────────────┘
//   (red / rose background, full-width, sticky at the top of <main>)
//
//   ┌────────────────────────────────────────────────────────────────────┐
//   │  ONLINE + QUEUE                                                    │
//   │  🔄 3 sale(s) syncing...  [Sync now]                              │
//   └────────────────────────────────────────────────────────────────────┘
//   (amber background — only shown when the queue is non-empty)
//
//   ONLINE + EMPTY QUEUE → banner is hidden (a tiny green dot lives in
//   the TopBar instead, so the cashier always knows the connection is live).
//
// Design notes:
//   • Uses Framer Motion for a smooth slide-down when the banner appears
//     (so it doesn't jarringly shove the POS content).
//   • "Sync now" button calls syncQueue() directly and shows a toast with
//     the result — useful when the cashier knows the network is back but
//     the auto-sync hasn't fired yet.
//   • The pending-sync count comes from the reactive external store in
//     offline-sync.ts (subscribeOfflineCount / getOfflineCountSnapshot),
//     so it updates in real time as sales are queued and synced.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff, RefreshCw, CloudCheck, CloudOff, Loader2, CheckCircle2 } from 'lucide-react';
import { useNetworkStatus } from '@/hooks/use-network-status';
import {
  subscribeOfflineCount,
  getOfflineCountSnapshot,
  syncQueue,
  onBackgroundSync,
  type SyncResult,
} from '@/lib/offline-sync';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';

export function OfflineIndicator() {
  const { isOnline, wasOffline: _wasOffline } = useNetworkStatus();
  const pendingCount = useSyncExternalStore(
    subscribeOfflineCount,
    getOfflineCountSnapshot,
    () => 0, // SSR snapshot
  );

  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);

  // ── Manual "Sync now" handler ──
  const handleSyncNow = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const result = await syncQueue();
      setLastSyncResult(result);
      if (result.succeeded > 0 && result.failed === 0) {
        toast.success(`Synced ${result.succeeded} sale(s) to the server.`, {
          duration: 4000,
        });
      } else if (result.succeeded > 0 && result.failed > 0) {
        toast.warning(
          `Synced ${result.succeeded} sale(s), but ${result.failed} failed. Will retry automatically.`,
          { duration: 5000 },
        );
      } else if (result.failed > 0 && result.succeeded === 0) {
        toast.error(`Sync failed for ${result.failed} sale(s). Will retry automatically.`, {
          duration: 5000,
        });
      } else {
        toast.info('No sales to sync — the queue is empty.');
      }
    } catch (err) {
      toast.error(
        `Sync error: ${err instanceof Error ? err.message : 'Unknown error'}. Will retry automatically.`,
      );
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing]);

  // ── Listen for background syncs (fired by the `online` event) ──
  // so the banner updates its "last result" message even when the cashier
  // didn't click "Sync now" manually.
  useEffect(() => {
    const unsub = onBackgroundSync((result) => {
      setLastSyncResult(result);
      if (result.succeeded > 0) {
        toast.success(`Auto-synced ${result.succeeded} sale(s).`, { duration: 4000 });
      }
    });
    return unsub;
  }, []);

  // ── Decide what to render ──
  //
  // Priority:
  //   1. OFFLINE → always show the red banner (even if queue is empty, so the
  //      cashier knows new sales will go to the queue).
  //   2. ONLINE + pendingCount > 0 → show the amber "syncing" banner with a
  //      "Sync now" button.
  //   3. ONLINE + pendingCount === 0 → show nothing (the TopBar green dot
  //      is enough). BUT if we just finished a sync, show a brief "synced!"
  //      confirmation for 4 seconds.

  const showOfflineBanner = !isOnline;
  const showSyncBanner = isOnline && pendingCount > 0;
  const showJustSynced =
    isOnline &&
    pendingCount === 0 &&
    lastSyncResult !== null &&
    lastSyncResult.succeeded > 0 &&
    lastSyncResult.failed === 0;

  // Auto-dismiss the "just synced" message after 4 seconds.
  useEffect(() => {
    if (!showJustSynced) return;
    const t = setTimeout(() => setLastSyncResult(null), 4000);
    return () => clearTimeout(t);
  }, [showJustSynced]);

  return (
    <AnimatePresence mode="wait">
      {showOfflineBanner && (
        <motion.div
          key="offline-banner"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="sticky top-0 z-40 w-full"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-lg">
            <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 shrink-0">
                <WifiOff className="h-4 w-4 animate-pulse" aria-hidden />
                <span className="font-semibold text-sm tracking-wide uppercase">
                  Offline
                </span>
              </div>
              <p className="text-sm flex-1 min-w-0">
                📶 Offline Mode: Sales will sync when connected.
              </p>
              {pendingCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm">
                  <CloudOff className="h-3 w-3" aria-hidden />
                  {pendingCount} sale{pendingCount === 1 ? '' : 's'} queued
                </span>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {showSyncBanner && (
        <motion.div
          key="sync-banner"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="sticky top-0 z-40 w-full"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg">
            <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 shrink-0">
                {isSyncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="h-4 w-4" aria-hidden />
                )}
                <span className="font-semibold text-sm tracking-wide uppercase">
                  {isSyncing ? 'Syncing' : 'Pending Sync'}
                </span>
              </div>
              <p className="text-sm flex-1 min-w-0">
                {isSyncing
                  ? `Syncing ${pendingCount} sale${pendingCount === 1 ? '' : 's'} to the server…`
                  : `${pendingCount} sale${pendingCount === 1 ? '' : 's'} waiting to sync.`}
              </p>
              {!isSyncing && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 px-3 text-xs bg-white/90 hover:bg-white text-amber-700 font-medium shadow-sm"
                  onClick={handleSyncNow}
                  aria-label="Sync queued sales now"
                >
                  <RefreshCw className="h-3 w-3 mr-1" aria-hidden />
                  Sync now
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {showJustSynced && (
        <motion.div
          key="just-synced"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="sticky top-0 z-40 w-full"
          role="status"
          aria-live="polite"
        >
          <div className="bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow-lg">
            <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              <p className="text-sm flex-1">
                All sales synced successfully — queue is empty.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* When online + empty queue + no recent sync, render nothing.
          The OnlineBadge (below) can be used in the TopBar instead. */}
      {!showOfflineBanner && !showSyncBanner && !showJustSynced && null}
    </AnimatePresence>
  );
}

// ── Compact OnlineBadge for the TopBar ───────────────────────────────────────
//
// A tiny green dot (online) or red dot (offline) for the TopBar — so the
// cashier always has a peripheral-vision indicator even when the full
// banner is hidden.

export function OnlineBadge() {
  const { isOnline } = useNetworkStatus();
  const pendingCount = useSyncExternalStore(
    subscribeOfflineCount,
    getOfflineCountSnapshot,
    () => 0,
  );

  if (!isOnline) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 dark:bg-rose-950/40 px-2 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300"
        title="Offline — sales will be queued locally"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-600" />
        </span>
        <span className="hidden sm:inline">Offline</span>
      </span>
    );
  }

  if (pendingCount > 0) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
        title={`${pendingCount} sale(s) waiting to sync`}
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-600" />
        </span>
        <span className="hidden sm:inline">{pendingCount} pending</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
      title="Online — all systems connected"
    >
      <CloudCheck className="h-3 w-3" aria-hidden />
      <span className="hidden sm:inline">Online</span>
    </span>
  );
}
