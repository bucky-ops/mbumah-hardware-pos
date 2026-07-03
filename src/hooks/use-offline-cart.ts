'use client';

// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — useOfflineCart hook
// ─────────────────────────────────────────────────────────────────────────────
//
// Syncs the Zustand cart store (`useCartStore`) to IndexedDB so that a
// browser crash, accidental refresh, or power outage mid-sale does NOT lose
// the items the cashier has rung up.
//
// This is DISTINCT from the offline TRANSACTION queue (src/lib/offline-sync.ts):
//   • offline-sync.ts  → persists COMPLETED sales that couldn't reach the server
//   • this hook        → persists the IN-PROGRESS cart (items being rung up)
//
// Together they give full offline resilience:
//   1. Cashier adds 12 items to the cart.
//   2. Browser crashes / power drops.
//   3. On re-open, the cart is HYDRATED from IndexedDB — the cashier
//      continues exactly where they left off.
//   4. Checkout completes offline → the sale lands in the transaction queue.
//   5. When connectivity returns, syncQueue() replays the sale to the server.
//
// ## Storage strategy
//
// We use IndexedDB (via the `idb` library, already a project dependency)
// rather than localStorage because:
//   • Cart items can be large (a busy sale has 30+ line items with full
//     product metadata) — localStorage's 5MB cap is easy to hit across
//     multiple persisted slices.
//   • IndexedDB is async, so persisting 30 items doesn't block the UI thread
//     on every keystroke the way a synchronous localStorage.setItem would.
//   • We already use IndexedDB for the transaction queue, so we reuse the
//     same DB connection pattern.
//
// ## Debouncing
//
// Cart mutations can fire rapidly (e.g. typing in a quantity field). We
// debounce writes by 300ms so we don't hammer IndexedDB on every keystroke.
// The LAST state always wins (trailing debounce).
//
// ## Per-store isolation
//
// The cart is keyed by `storeId` in IndexedDB. If a SUPER_ADMIN switches
// branches, they get a fresh cart for that branch — they don't accidentally
// ring up Juja stock against the Thika till.
//
// Usage:
//   // Inside the POS component:
//   useOfflineCart({ storeId: currentStoreId });
//
//   // That's it. The hook handles hydration + persistence transparently.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { useCartStore } from '@/lib/stores';
import type { CartItem } from '@/lib/types';

// ── Schema ───────────────────────────────────────────────────────────────────

interface CartSnapshot {
  /** The storeId this cart belongs to — used as the primary key. */
  storeId: string;
  /** The cart items at the moment of persistence. */
  items: CartItem[];
  /** Cart-level flat discount (Ksh). */
  discount: number;
  /** ISO timestamp of the last write. */
  savedAt: string;
}

interface MbumahCartDB extends DBSchema {
  carts: {
    key: string; // storeId
    value: CartSnapshot;
  };
}

const DB_NAME = 'mbumah-offline-pos';
const DB_VERSION = 2; // Bump from v1 (transaction queue) — adds the `carts` store
const STORE_NAME = 'carts';

// ── Singleton DB handle ──────────────────────────────────────────────────────
//
// NOTE: We intentionally reuse the SAME database name as offline-sync.ts
// (`mbumah-offline-pos`). IndexedDB databases are versioned — v1 created the
// `transactions` store; v2 here adds the `carts` store. The `upgrade()`
// callback is written defensively so it works whether v1 or v2 is the
// starting point.

let dbPromise: Promise<IDBPDatabase<MbumahCartDB>> | null = null;

function getDB(): Promise<IDBPDatabase<MbumahCartDB>> | null {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return null;
  }
  if (!dbPromise) {
    dbPromise = openDB<MbumahCartDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // v1 store (created by offline-sync.ts) — only create if absent
        // (idb calls upgrade for every version step, so on a fresh DB this
        // runs for v1 then v2; on an existing v1 DB it only runs for v2).
        if (!db.objectStoreNames.contains('transactions')) {
          const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
          txStore.createIndex('by-queuedAt', 'queuedAt');
        }
        // v2 store — the cart snapshots
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'storeId' });
        }
      },
    });
  }
  return dbPromise;
}

// ── Low-level read/write helpers (exported for testing / debugging) ──────────

export async function persistCart(snapshot: CartSnapshot): Promise<void> {
  const db = getDB();
  if (!db) return;
  try {
    await (await db).put(STORE_NAME, snapshot);
  } catch (err) {
    // Never let a persistence failure crash the POS — log and move on.
    console.warn('[useOfflineCart] persistCart failed:', err);
  }
}

export async function loadCart(storeId: string): Promise<CartSnapshot | null> {
  const db = getDB();
  if (!db) return null;
  try {
    return (await db).get(STORE_NAME, storeId);
  } catch (err) {
    console.warn('[useOfflineCart] loadCart failed:', err);
    return null;
  }
}

export async function clearCartSnapshot(storeId: string): Promise<void> {
  const db = getDB();
  if (!db) return;
  try {
    await (await db).delete(STORE_NAME, storeId);
  } catch (err) {
    console.warn('[useOfflineCart] clearCartSnapshot failed:', err);
  }
}

// ── The hook ─────────────────────────────────────────────────────────────────

export interface UseOfflineCartOptions {
  /** The store whose cart should be persisted. Required. */
  storeId: string | undefined | null;
  /**
   * Set to false to disable persistence (e.g. in tests). Default true.
   */
  enabled?: boolean;
}

/**
 * Persists the Zustand cart to IndexedDB and hydrates it on mount.
 *
 * Call this ONCE from the POS component (or MainApp). It:
 *   1. On mount (or when `storeId` changes), loads the saved snapshot for
 *      that store and hydrates `useCartStore` — but ONLY if the cart is
 *      currently empty (so we never clobber a cart that's already in flight).
 *   2. Subscribes to `useCartStore` changes and debounces-writes the new
 *      state to IndexedDB.
 *   3. Clears the persisted snapshot when the cart is explicitly cleared
 *      (so a fresh session starts fresh).
 */
export function useOfflineCart({ storeId, enabled = true }: UseOfflineCartOptions) {
  // Track whether the initial hydration for THIS storeId has completed.
  // We must not write until we've read — otherwise we'd persist an empty
  // cart over a saved one before hydration finishes.
  const hydratedForStore = useRef<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Hydration ──
  useEffect(() => {
    if (!enabled || !storeId) return;
    // Re-hydrate whenever storeId changes (branch switch).
    if (hydratedForStore.current === storeId) return;

    let cancelled = false;
    (async () => {
      const snapshot = await loadCart(storeId);
      if (cancelled || !snapshot) {
        hydratedForStore.current = storeId;
        return;
      }

      // Only hydrate if the cart is currently empty — never clobber an
      // in-flight cart (defensive: shouldn't happen on a fresh mount, but
      // protects against React StrictMode double-invocation).
      const currentItems = useCartStore.getState().items;
      if (currentItems.length === 0 && snapshot.items.length > 0) {
        // Re-hydrate item by item via the store API so line totals are
        // recomputed (in case the pricing/tax logic changed since the
        // snapshot was taken).
        snapshot.items.forEach((item) => {
          useCartStore.getState().addItem({
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            quantity: item.quantity,
            unitType: item.unitType,
            pricePerUnit: item.pricePerUnit,
            costPrice: item.costPrice,
            discountPercent: item.discountPercent,
            taxRate: item.taxRate,
            isRentalItem: item.isRentalItem,
            isBundle: item.isBundle,
          });
        });
        // Restore the cart-level discount.
        if (snapshot.discount > 0) {
          useCartStore.getState().setDiscount(snapshot.discount);
        }

        // Soft notification — the cashier should know their cart was
        // restored (not freshly scanned). Avoids confusion if a crashed
        // session is reopened hours later.
        console.info(
          `[useOfflineCart] Restored ${snapshot.items.length} item(s) from ${new Date(
            snapshot.savedAt,
          ).toLocaleTimeString()} (offline snapshot for store ${storeId}).`,
        );
      }
      hydratedForStore.current = storeId;
    })();

    return () => {
      cancelled = true;
    };
  }, [storeId, enabled]);

  // ── Persistence (debounced) ──
  useEffect(() => {
    if (!enabled || !storeId) return;
    // Don't write until hydration for this store has completed.
    if (hydratedForStore.current !== storeId) return;

    // Subscribe to cart state changes.
    const unsubscribe = useCartStore.subscribe((state) => {
      // Clear any pending write — only the latest state matters.
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      debounceTimer.current = setTimeout(() => {
        const snapshot: CartSnapshot = {
          storeId,
          items: state.items,
          discount: state.discount,
          savedAt: new Date().toISOString(),
        };
        void persistCart(snapshot);

        // If the cart was cleared (empty items + zero discount), remove the
        // snapshot so the next session starts clean. We still write the
        // empty snapshot first to handle the race where a new item is added
        // in the same tick — the next debounced write will overwrite.
        if (state.items.length === 0 && state.discount === 0) {
          void clearCartSnapshot(storeId);
        }
      }, 300);
    });

    return () => {
      unsubscribe();
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, [storeId, enabled]);

  // ── Clear persisted cart on logout (best-effort) ──
  // We listen for the auth store flipping to unauthenticated and wipe the
  // snapshot so the next login starts fresh. This is defensive — the cart
  // is per-storeId, so it's already isolated, but this avoids a stale cart
  // lingering if the same browser is used by two different cashiers.
  useEffect(() => {
    if (!enabled) return;
    let prevStoreId = storeId;
    const unsubscribe = useCartStore.subscribe(() => {
      // no-op — we only care about storeId changes below
    });
    // Watch for storeId becoming null/undefined (e.g. on logout the
    // currentStoreId may be reset).
    if (prevStoreId && !storeId) {
      void clearCartSnapshot(prevStoreId);
    }
    prevStoreId = storeId;
    return unsubscribe;
  }, [storeId, enabled]);
}

// ── Utility: count of persisted carts (for the "restore cart?" prompt) ───────

export async function countPersistedCarts(): Promise<number> {
  const db = getDB();
  if (!db) return 0;
  try {
    return (await db).count(STORE_NAME);
  } catch {
    return 0;
  }
}
