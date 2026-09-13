'use client';

// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — notification read/dismissed state
// ─────────────────────────────────────────────────────────────────────────────
//
// A tiny localStorage-backed external store shared by the NotificationCenter
// panel AND the badge hook (useNotificationCount), so the sidebar/top-bar
// bell recomputes in the same tick a notification is read/dismissed — no
// more waiting for the next 60s react-query poll to notice "Mark all read".
//
// • Persists to the LEGACY keys (mbt_read_notifications / mbt_dismissed_notifications)
//   so existing users keep their state across this upgrade.
// • Listens to `storage` events so multiple tabs stay in sync.
// • SSR-safe: on the server every list is empty and no window is touched.
// • Snapshots are frozen and identity-stable (only rebuilt on real change),
//   which is what useSyncExternalStore requires.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useSyncExternalStore } from 'react';

// Keep in sync with the keys the NotificationCenter has always used.
const READ_KEY = 'mbt_read_notifications';
const DISMISSED_KEY = 'mbt_dismissed_notifications';
// Cap persisted lists so localStorage can't grow unbounded over years of use.
const MAX_PERSISTED_IDS = 2000;

export interface NotificationsReadStateSnapshot {
  readonly readIds: readonly string[];
  readonly dismissedIds: readonly string[];
  /** Bumped on every real change so consumers can cheaply detect updates. */
  readonly version: number;
}

// Server snapshot — a frozen constant so hydration never mismatches.
const EMPTY_SNAPSHOT: NotificationsReadStateSnapshot = Object.freeze({
  readIds: Object.freeze([]),
  dismissedIds: Object.freeze([]),
  version: 0,
});

let readIdSet = new Set<string>();
let dismissedIdSet = new Set<string>();
let snapshot: NotificationsReadStateSnapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();
let detachStorageListener: (() => void) | null = null;

function parseIdList(raw: string | null): Set<string> {
  if (!raw) return new Set<string>();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set<string>();
  }
}

function sameIdList(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

function rebuildSnapshot() {
  snapshot = Object.freeze({
    readIds: Object.freeze([...readIdSet]),
    dismissedIds: Object.freeze([...dismissedIdSet]),
    version: snapshot.version + 1,
  });
}

function persist() {
  if (typeof window === 'undefined') return;
  try {
    // Sets preserve insertion order → slice keeps the MOST RECENT ids.
    window.localStorage.setItem(
      READ_KEY,
      JSON.stringify([...readIdSet].slice(-MAX_PERSISTED_IDS)),
    );
    window.localStorage.setItem(
      DISMISSED_KEY,
      JSON.stringify([...dismissedIdSet].slice(-MAX_PERSISTED_IDS)),
    );
  } catch {
    // Storage blocked/full — in-memory state still works for this tab.
  }
}

function emitChange() {
  rebuildSnapshot();
  persist();
  for (const listener of listeners) listener();
}

/**
 * Re-read localStorage into memory. `notify` must be false during module
 * init/subscribe (no listeners yet) and true from the `storage` handler.
 */
function syncFromStorage(notify: boolean) {
  if (typeof window === 'undefined') return;
  let nextRead: Set<string>;
  let nextDismissed: Set<string>;
  try {
    nextRead = parseIdList(window.localStorage.getItem(READ_KEY));
    nextDismissed = parseIdList(window.localStorage.getItem(DISMISSED_KEY));
  } catch {
    return; // storage unavailable — keep whatever we have in memory
  }
  if (sameIdList(nextRead, readIdSet) && sameIdList(nextDismissed, dismissedIdSet)) return;
  readIdSet = nextRead;
  dismissedIdSet = nextDismissed;
  rebuildSnapshot();
  if (notify) {
    for (const listener of listeners) listener();
  }
}

// Prime once at module load (client only) so the first render already
// reflects persisted state without a post-hydration flash.
syncFromStorage(false);

export function getNotificationsReadStateSnapshot(): NotificationsReadStateSnapshot {
  return snapshot;
}

function getServerSnapshot(): NotificationsReadStateSnapshot {
  return EMPTY_SNAPSHOT;
}

export function subscribeNotificationsReadState(cb: () => void): () => void {
  listeners.add(cb);

  // Lazy-attach the cross-tab listener on the FIRST subscriber; tear it down
  // when the last one unsubscribes (refcount pattern).
  if (listeners.size === 1 && typeof window !== 'undefined') {
    syncFromStorage(false); // another tab may have written before we subscribed

    const handleStorage = (event: StorageEvent) => {
      // key === null means another tab ran localStorage.clear() — resync too.
      if (event.key !== null && event.key !== READ_KEY && event.key !== DISMISSED_KEY) return;
      syncFromStorage(true);
    };

    window.addEventListener('storage', handleStorage);
    detachStorageListener = () => window.removeEventListener('storage', handleStorage);
  }

  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && detachStorageListener) {
      detachStorageListener();
      detachStorageListener = null;
    }
  };
}

// ── Mutators (module-level → stable identities for the hook) ─────────────────

export function markNotificationRead(id: string): void {
  if (readIdSet.has(id)) return; // already read — keep snapshot identity stable
  readIdSet.add(id);
  emitChange();
}

export function markAllNotificationsRead(ids: readonly string[]): void {
  let changed = false;
  for (const id of ids) {
    if (!readIdSet.has(id)) {
      readIdSet.add(id);
      changed = true;
    }
  }
  if (changed) emitChange();
}

export function dismissNotification(id: string): void {
  if (dismissedIdSet.has(id)) return;
  dismissedIdSet.add(id);
  emitChange();
}

export function restoreNotification(id: string): void {
  if (!dismissedIdSet.delete(id)) return;
  emitChange();
}

export function restoreDismissedNotifications(): void {
  if (dismissedIdSet.size === 0) return;
  dismissedIdSet.clear();
  emitChange();
}

export function resetNotificationReadState(): void {
  if (readIdSet.size === 0 && dismissedIdSet.size === 0) return;
  readIdSet.clear();
  dismissedIdSet.clear();
  emitChange();
}

// ── React hook ───────────────────────────────────────────────────────────────

export interface UseNotificationReadStateResult {
  readIds: ReadonlySet<string>;
  dismissedIds: ReadonlySet<string>;
  markRead: typeof markNotificationRead;
  markAllRead: typeof markAllNotificationsRead;
  dismiss: typeof dismissNotification;
  /** Put a single dismissed notification back into the active list. */
  restore: typeof restoreNotification;
  /** Put ALL dismissed notifications back into the active list. */
  restoreDismissed: typeof restoreDismissedNotifications;
  reset: typeof resetNotificationReadState;
}

export function useNotificationReadState(): UseNotificationReadStateResult {
  // Always render from React's snapshot (never module state directly) to stay tear-free.
  const current = useSyncExternalStore(
    subscribeNotificationsReadState,
    getNotificationsReadStateSnapshot,
    getServerSnapshot,
  );

  // Set identities only change when the underlying arrays change (frozen snapshots).
  const readIds = useMemo(() => new Set(current.readIds) as ReadonlySet<string>, [current.readIds]);
  const dismissedIds = useMemo(
    () => new Set(current.dismissedIds) as ReadonlySet<string>,
    [current.dismissedIds],
  );

  return {
    readIds,
    dismissedIds,
    markRead: markNotificationRead,
    markAllRead: markAllNotificationsRead,
    dismiss: dismissNotification,
    restore: restoreNotification,
    restoreDismissed: restoreDismissedNotifications,
    reset: resetNotificationReadState,
  };
}
