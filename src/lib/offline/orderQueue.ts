// Compatibility shim — canonical offline queue lives in src/lib/offline-db.ts
// (Dexie/IndexedDB). Keeps the `@/lib/offline/orderQueue` import path stable
// for components written against the earlier contract.
export {
  enqueuePendingOrder,
  listPendingOrders,
  deletePendingOrder,
  countPendingOrders,
  bumpAttempts,
} from "@/lib/offline-db";
