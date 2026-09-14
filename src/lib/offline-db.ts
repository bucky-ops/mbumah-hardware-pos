import Dexie, { type EntityTable } from "dexie";

import type { CartLine, PendingOrder } from "@/lib/types";

/**
 * Offline persistence (Task 2.4) — Dexie over IndexedDB.
 *
 * WHY INDEXEDDB OVER localStorage?
 *  - Survives reloads AND browser restarts with a much larger quota
 *    (hundreds of MB vs ~5 MB), so a day of queued sales never overflows.
 *  - Structured storage: objects/arrays are stored natively — no JSON
 *    stringify/parse round-trips corrupting decimal-string money fields.
 *  - Fully async: reads/writes never block the main thread, so enqueueing a
 *    sale while the UI renders stays jank-free.
 *  - Indexed queries (`createdAt`) give us FIFO replay order for free.
 */

export interface CartSnapshot {
  id: string; // always "current" — the single live cart
  lines: CartLine[];
  customerId: string | null;
  savedAt: number;
}

export class MbumahOfflineDb extends Dexie {
  pendingOrders!: EntityTable<PendingOrder, "id">;
  cartSnapshots!: EntityTable<CartSnapshot, "id">;

  constructor() {
    super("mbumah-pos-offline");
    this.version(1).stores({
      pendingOrders: "id, createdAt",
      cartSnapshots: "id",
    });
  }
}

// Guarded construction: IndexedDB only exists in the browser. The module is
// imported by client hooks, but Next may evaluate it during SSR/prerender.
const dbInstance: MbumahOfflineDb | null =
  typeof window !== "undefined" && typeof indexedDB !== "undefined"
    ? new MbumahOfflineDb()
    : null;

function requireDb(): MbumahOfflineDb {
  if (!dbInstance) {
    throw new Error("Offline storage (IndexedDB) is only available in the browser.");
  }
  return dbInstance;
}

/** Queue a checkout payload captured while offline. id doubles as Idempotency-Key. */
export async function enqueuePendingOrder(order: PendingOrder): Promise<void> {
  await requireDb().pendingOrders.put(order);
}

/** FIFO replay order (oldest first) so the ledger stays chronological. */
export async function listPendingOrders(): Promise<PendingOrder[]> {
  if (!dbInstance) return [];
  return dbInstance.pendingOrders.orderBy("createdAt").toArray();
}

export async function deletePendingOrder(id: string): Promise<void> {
  if (!dbInstance) return;
  await dbInstance.pendingOrders.delete(id);
}

export async function countPendingOrders(): Promise<number> {
  if (!dbInstance) return 0;
  return dbInstance.pendingOrders.count();
}

/** Record another failed sync attempt (kept for diagnostics / retry caps). */
export async function bumpAttempts(order: PendingOrder): Promise<void> {
  if (!dbInstance) return;
  await dbInstance.pendingOrders.update(order.id, { attempts: order.attempts + 1 });
}

/** Persist the live cart so an accidental reload doesn't lose the till. */
export async function saveCartSnapshot(lines: CartLine[], customerId: string | null): Promise<void> {
  const snapshot: CartSnapshot = { id: "current", lines, customerId, savedAt: Date.now() };
  await requireDb().cartSnapshots.put(snapshot);
}

export async function loadCartSnapshot(): Promise<CartSnapshot | null> {
  if (!dbInstance) return null;
  const snap = await dbInstance.cartSnapshots.get("current");
  return snap ?? null;
}

export async function clearCartSnapshot(): Promise<void> {
  if (!dbInstance) return;
  await dbInstance.cartSnapshots.delete("current");
}

export interface FlushResult {
  synced: number;
  failed: number;
}

/**
 * Drain the offline queue, oldest first, STRICTLY sequential — order matters
 * for stock movements, so we never parallelize replays.
 *
 * Status policy (never poison the queue):
 *  - 2xx                     → accepted by the server, drop from queue.
 *  - 400 / 409 (any 4xx)     → already synced (409 idempotent duplicate) or
 *                              permanently invalid (400 schema violation) —
 *                              retrying can never succeed, drop from queue.
 *  - 5xx / network error     → server or link is unhealthy (would likely fail
 *                              the whole batch anyway) → bumpAttempts and
 *                              ABORT the round; the next trigger retries.
 */
export async function flushPendingOrders(): Promise<FlushResult> {
  const result: FlushResult = { synced: 0, failed: 0 };
  if (!dbInstance) return result;

  const orders = await dbInstance.pendingOrders.orderBy("createdAt").toArray();

  for (const order of orders) {
    try {
      const res = await fetch("/api/v1/sales/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": order.id,
        },
        body: JSON.stringify({
          orders: [{ clientId: order.id, ...(order.payload as object) }],
        }),
      });

      if (res.ok || (res.status >= 400 && res.status < 500)) {
        // 2xx = synced; 4xx = duplicate (already synced) or permanently invalid.
        await dbInstance.pendingOrders.delete(order.id);
        if (res.ok) result.synced += 1;
        else result.failed += 1;
      } else {
        // 5xx — server-side trouble; abort the round, keep the order queued.
        await bumpAttempts(order);
        result.failed += 1;
        break;
      }
    } catch {
      // Network error — we are (still) offline; abort and retry on next trigger.
      await bumpAttempts(order);
      result.failed += 1;
      break;
    }
  }

  return result;
}
