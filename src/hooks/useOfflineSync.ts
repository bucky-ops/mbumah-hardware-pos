"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { countPendingOrders, flushPendingOrders } from "@/lib/offline-db";

export interface OfflineSyncState {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  lastSyncAt: number | null;
  syncNow: () => Promise<void>;
}

const AUTO_FLUSH_INTERVAL_MS = 30_000;

/**
 * Online/offline lifecycle for the POS (Task 2.4).
 *
 *  - tracks navigator.onLine via the `online`/`offline` events;
 *  - keeps pendingCount fresh (mount + every relevant event);
 *  - auto-flushes the Dexie queue when the tab comes back online, when it
 *    becomes visible again, and every 30 s while open;
 *  - `syncNow()` is the manual F9 path and reports a toast summary;
 *  - registers the offline shell Service Worker exactly once.
 */
export function useOfflineSync(): OfflineSyncState {
  const [online, setOnline] = useState<boolean>(() =>
    typeof window === "undefined" ? true : navigator.onLine
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  const syncingRef = useRef(false);

  const refreshCount = useCallback(() => {
    countPendingOrders()
      .then(setPendingCount)
      .catch(() => {
        /* IndexedDB unavailable (SSR/first paint) — count stays as-is */
      });
  }, []);

  const runFlush = useCallback(
    async (manual: boolean) => {
      if (syncingRef.current) return; // never double-drain the queue
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        if (manual) toast.error("Offline — sync will resume automatically when reconnected.");
        return;
      }
      syncingRef.current = true;
      setSyncing(true);
      try {
        const { synced, failed } = await flushPendingOrders();
        setLastSyncAt(Date.now());
        if (manual) {
          if (synced > 0) {
            toast.success(`Synced ${synced} queued order${synced === 1 ? "" : "s"}.`);
          } else if (failed > 0) {
            toast.error(
              `${failed} order${failed === 1 ? "" : "s"} still queued — will retry automatically.`
            );
          } else {
            toast.info("Nothing to sync — offline queue is empty.");
          }
        }
      } catch {
        if (manual) toast.error("Sync failed — orders remain safely queued.");
      } finally {
        syncingRef.current = false;
        setSyncing(false);
        refreshCount();
      }
    },
    [refreshCount]
  );

  const syncNow = useCallback(() => runFlush(true), [runFlush]);

  useEffect(() => {
    setOnline(navigator.onLine);
    refreshCount();

    const goOnline = () => {
      setOnline(true);
      void runFlush(false);
    };
    const goOffline = () => setOnline(false);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshCount();
        void runFlush(false);
      }
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(() => void runFlush(false), AUTO_FLUSH_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
    };
  }, [refreshCount, runFlush]);

  // Service worker (offline shell) — register once per browser session.
  // PRODUCTION ONLY: in dev, Turbopack reuses stable chunk URLs, so a
  // cache-first SW would pin stale bundles across server restarts.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* SW is an enhancement — offline queue works without it */
    });
  }, []);

  return { online, pendingCount, syncing, lastSyncAt, syncNow };
}
