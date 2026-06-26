// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Offline-First Transaction Queue (IndexedDB)
// ─────────────────────────────────────────────────────────────────────────────
//
// Cashiers in areas with unstable internet (Juja, Nakuru, Ruiru) must be able
// to keep processing sales when the connection drops. This module implements
// an IndexedDB-backed queue of unsynced POS transactions:
//
//   • saveOfflineTransaction(payload)  — persists a failed POST /api/transactions
//                                         payload locally with a synthetic
//                                         receipt number so the cashier can
//                                         hand the customer a paper receipt
//                                         immediately.
//   • syncQueue()                       — replays every queued transaction
//                                         against the live API in FIFO order.
//                                         Successfully synced rows are deleted
//                                         from the queue; failures remain and
//                                         are retried on the next `online`
//                                         event or manual retry.
//   • getQueueCount() / subscribe()     — lightweight reactive count for the
//                                         POS "pending syncs" badge.
//
// Design notes:
//   • Uses the `idb` Promise wrapper for ergonomic IndexedDB access.
//   • The DB + store live entirely client-side; the server never sees these
//     rows until syncQueue() succeeds. This is intentional — the queue is a
//     local buffer, not a source of truth.
//   • Each queued row carries a client-generated `clientReceiptNumber`
//     (format OFFLINE-<timestamp>-<rand>) so the cashier can print a receipt
//     with a unique number even before the server assigns the real one.
//   • The actual `receiptNumber` is assigned server-side on sync; the client
//     receipt number is included in the payload as `notes` so the server-side
//     transaction can be cross-referenced if needed.
//   • All functions are SSR-safe (no-op when `window` is undefined) so they
//     can be imported from any client component without breaking the server
//     render.
// ─────────────────────────────────────────────────────────────────────────────

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CheckoutPayload, TransactionItem } from '@/lib/types';

// ── Schema ───────────────────────────────────────────────────────────────────

interface OfflineTransactionRow {
  /** Client-generated UUID (crypto.randomUUID()). Primary key. */
  id: string;
  /** Client receipt number, e.g. OFFLINE-1700000000000-AB12. */
  clientReceiptNumber: string;
  /** The exact CheckoutPayload that would have been POSTed. */
  payload: CheckoutPayload;
  /** ISO timestamp when the sale was queued. */
  queuedAt: string;
  /** ISO timestamp of the last sync attempt (null if never attempted). */
  lastAttemptAt: string | null;
  /** Number of failed sync attempts (for backoff / diagnostics). */
  attempts: number;
  /** Last error message (if any). */
  lastError: string | null;
}

interface MbumahOfflineDB extends DBSchema {
  transactions: {
    key: string;
    value: OfflineTransactionRow;
    indexes: { 'by-queuedAt': string };
  };
}

const DB_NAME = 'mbumah-offline-pos';
const DB_VERSION = 1;
const STORE_NAME = 'transactions';

// ── Singleton DB handle (lazy) ────────────────────────────────────────────────

let dbPromise: Promise<IDBPDatabase<MbumahOfflineDB>> | null = null;

function getDB(): Promise<IDBPDatabase<MbumahOfflineDB>> | null {
  // SSR guard — IndexedDB only exists in the browser.
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return null;
  }
  if (!dbPromise) {
    dbPromise = openDB<MbumahOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('by-queuedAt', 'queuedAt');
        }
      },
    });
  }
  return dbPromise;
}

// ── Client receipt number generator ──────────────────────────────────────────

/**
 * Generate a unique, human-readable receipt number for offline sales. Format:
 * `OFFLINE-<epoch-ms>-<4-hex>`. This is printed on the paper receipt handed to
 * the customer immediately, and is included in the server payload as `notes`
 * so the real (server-assigned) receipt number can be cross-referenced later.
 */
export function generateOfflineReceiptNumber(): string {
  const ts = Date.now();
  const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `OFFLINE-${ts}-${rand}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Persist a failed checkout payload to the local queue. Returns the queued row
 * (including the client receipt number) so the caller can immediately render a
 * receipt for the customer.
 *
 * Also appends the `clientReceiptNumber` to the payload's `notes` so the
 * server-side transaction — once synced — carries the offline reference.
 */
export async function saveOfflineTransaction(
  payload: CheckoutPayload,
): Promise<OfflineTransactionRow | null> {
  const db = getDB();
  if (!db) return null;

  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `off-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const clientReceiptNumber = generateOfflineReceiptNumber();

  // Stamp the payload with the offline reference so the server can reconcile.
  const stampedPayload: CheckoutPayload = {
    ...payload,
    notes: [payload.notes, `Offline ref: ${clientReceiptNumber}`]
      .filter(Boolean)
      .join(' | '),
  };

  const row: OfflineTransactionRow = {
    id,
    clientReceiptNumber,
    payload: stampedPayload,
    queuedAt: new Date().toISOString(),
    lastAttemptAt: null,
    attempts: 0,
    lastError: null,
  };

  await (await db).put(STORE_NAME, row);
  notifyCountChange();
  return row;
}

/**
 * Replay every queued transaction against the live API, in FIFO order
*  (oldest first). Successfully synced rows are deleted from the queue.
 *  Failures are recorded on the row (attempts++, lastError) and left in the
 *  queue for the next retry.
 *
 * Returns a summary of the sync run.
 */
export interface SyncResult {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ clientReceiptNumber: string; error: string }>;
}

export async function syncQueue(): Promise<SyncResult> {
  const result: SyncResult = { attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const db = getDB();
  if (!db) return result;

  // Don't attempt a sync if we're known to be offline — the fetches would
  // just fail immediately and inflate the attempt counters.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return result;
  }

  const conn = await db;
  const queued = await conn.getAllFromIndex(STORE_NAME, 'by-queuedAt');

  for (const row of queued) {
    result.attempted += 1;
    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(row.payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body?.error || body?.message || `HTTP ${res.status} ${res.statusText}`,
        );
      }

      // Success — remove from queue.
      await conn.delete(STORE_NAME, row.id);
      result.succeeded += 1;
    } catch (err) {
      // Failure — record the error and leave in queue for next retry.
      const message = err instanceof Error ? err.message : 'Unknown sync error';
      await conn.put(STORE_NAME, {
        ...row,
        attempts: row.attempts + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: message,
      });
      result.failed += 1;
      result.errors.push({ clientReceiptNumber: row.clientReceiptNumber, error: message });

      // If the failure looks like a network error (TypeError from fetch),
      // stop the sync early — the rest will likely fail the same way and
      // we don't want to hammer the (still-down) connection.
      if (err instanceof TypeError) {
        // Fill in the remaining count as "not attempted this run".
        result.attempted = queued.indexOf(row) + 1;
        break;
      }
    }
  }

  notifyCountChange();
  return result;
}

/**
 * Returns the number of transactions currently waiting in the offline queue.
 * SSR-safe (returns 0 on the server).
 */
export async function getQueueCount(): Promise<number> {
  const db = getDB();
  if (!db) return 0;
  return (await db).count(STORE_NAME);
}

/**
 * Returns all queued transactions (newest first) for UI display / debugging.
 */
export async function getQueuedTransactions(): Promise<OfflineTransactionRow[]> {
  const db = getDB();
  if (!db) return [];
  const all = await (await db).getAllFromIndex(STORE_NAME, 'by-queuedAt');
  return all.reverse(); // newest first for UI
}

/**
 * Permanently remove a single queued transaction (e.g. the cashier decides to
 * discard a sale that can't be synced). Returns true if a row was deleted.
 */
export async function discardQueuedTransaction(id: string): Promise<boolean> {
  const db = getDB();
  if (!db) return false;
  try {
    await (await db).delete(STORE_NAME, id);
    notifyCountChange();
    return true;
  } catch {
    return false;
  }
}

// ── Reactive count subscription (for the POS badge) ──────────────────────────
//
// A tiny pub/sub so React components can subscribe to queue-count changes
// without polling. `useSyncExternalStore` is the idiomatic React 18+ hook for
// this.

let cachedCount = 0;
const listeners = new Set<() => void>();

function notifyCountChange() {
  // Fire-and-forget the recount; subscribers re-read via getSnapshot.
  getQueueCount()
    .then((n) => {
      if (n !== cachedCount) {
        cachedCount = n;
        listeners.forEach((l) => l());
      }
    })
    .catch(() => {
      /* ignore — will retry on next change */
    });
}

function subscribeCount(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshotCount(): number {
  return cachedCount;
}

/**
 * React 18+ `useSyncExternalStore` bindings for the offline queue count.
 * Usage:
 *   const queueCount = useSyncExternalStore(
 *     subscribeOfflineCount, getOfflineCountSnapshot
 *   );
 */
export { subscribeCount as subscribeOfflineCount, getSnapshotCount as getOfflineCountSnapshot };

/** Prime the cached count on app boot (call once from a top-level effect). */
export async function primeOfflineCount(): Promise<void> {
  cachedCount = await getQueueCount();
  listeners.forEach((l) => l());
}

// ── Online/offline event wiring ───────────────────────────────────────────────
//
// Registers window listeners that auto-trigger syncQueue() when connectivity
// is restored. Idempotent — safe to call from multiple components; only the
// first call actually attaches the listeners.

let listenersAttached = false;
const syncListeners: Array<(r: SyncResult) => void> = [];

/**
 * Register a callback fired whenever an automatic background sync completes.
 * Useful for showing "Synced N sales" toasts. Returns an unsubscribe fn.
 */
export function onBackgroundSync(cb: (r: SyncResult) => void): () => void {
  syncListeners.push(cb);
  return () => {
    const i = syncListeners.indexOf(cb);
    if (i >= 0) syncListeners.splice(i, 1);
  };
}

/**
 * Attach `online` / `offline` window listeners. On the `online` event we
 * automatically fire syncQueue() and notify subscribers. Idempotent.
 *
 * Should be called once from a top-level client component (e.g. MainApp mount).
 */
export function initOfflineSync(): () => void {
  if (typeof window === 'undefined') return () => {};

  if (!listenersAttached) {
    listenersAttached = true;

    const handleOnline = () => {
      // Small delay to let the network stack actually settle.
      setTimeout(async () => {
        const result = await syncQueue();
        if (result.succeeded > 0 || result.failed > 0) {
          syncListeners.forEach((l) => l(result));
        }
      }, 500);
    };

    window.addEventListener('online', handleOnline);

    // Store for cleanup (we don't actually detach in this long-lived app,
    // but expose the capability for tests / HMR).
    (initOfflineSync as unknown as { _cleanup?: () => void })._cleanup = () => {
      window.removeEventListener('online', handleOnline);
      listenersAttached = false;
    };
  }

  return () => {
    const cleanup = (initOfflineSync as unknown as { _cleanup?: () => void })._cleanup;
    if (cleanup) cleanup();
  };
}

// ── Synthetic offline receipt ─────────────────────────────────────────────────
//
// When a sale is queued offline, the cashier still needs to hand the customer
// a receipt immediately. This builds a TransactionItem-shaped object from the
// queued payload + row so the existing Receipt dialog can render it without
// special-casing.

export function buildOfflineReceipt(
  row: OfflineTransactionRow,
  cashierName: string,
): TransactionItem {
  const { payload } = row;
  const subtotal = payload.items.reduce(
    (sum, it) => sum + it.pricePerUnit * it.quantity * (1 - (it.discountPercent || 0) / 100),
    0,
  );
  const taxRate = 0.16; // Kenya VAT — matches cart.getTax()
  const tax = subtotal * taxRate;
  const discount = payload.discountAmount || 0;
  const total = subtotal + tax - discount;

  return {
    id: row.id,
    storeId: payload.storeId,
    receiptNumber: row.clientReceiptNumber,
    customerId: payload.customerId || null,
    cashierId: payload.cashierId,
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount: Math.round(tax * 100) / 100,
    discountAmount: discount,
    totalAmount: Math.round(total * 100) / 100,
    paymentMethod: payload.paymentMethod,
    paymentStatus: 'PENDING_SYNC', // sentinel — the Receipt dialog treats this as "offline"
    transactionType: 'SALE',
    notes: row.clientReceiptNumber,
    isOffline: true,
    createdAt: row.queuedAt,
    updatedAt: row.queuedAt,
    items: payload.items.map((it, idx) => ({
      id: `${row.id}-${idx}`,
      productId: it.productId,
      productName: it.productName,
      quantity: it.quantity,
      unitType: it.unitType,
      pricePerUnit: it.pricePerUnit,
      costPrice: it.costPrice,
      discountPercent: it.discountPercent || 0,
      taxRate: 16,
      lineTotal: it.pricePerUnit * it.quantity * (1 - (it.discountPercent || 0) / 100),
      isRentalItem: it.isRentalItem || false,
    })),
    cashier: { id: payload.cashierId, name: cashierName },
  };
}

export type { OfflineTransactionRow };
