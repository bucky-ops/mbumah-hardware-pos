# Offline Queue (client-side sales buffer)

IndexedDB-backed queue that lets cashiers keep selling when the connection
drops (Juja, Nakuru, Ruiru branches). Canonical import path:

    import { syncQueue, getQueueCount, subscribeOfflineCount } from '@/lib/offline';

The engine itself lives in `src/lib/offline-sync.ts` (kept at the flat path so
existing imports keep working). UI lives in
`src/components/offline-indicator.tsx` (top-bar dot + queue dialog).

## Queue flow

1. QUEUE - a failed `POST /api/transactions` checkout is persisted locally by
   `saveOfflineTransaction(payload)`. The row carries a client receipt number
   (`OFFLINE-<ts>-<rand>`) so the cashier can print a paper receipt
   immediately, and a stable client-generated `idempotencyKey` (SYS-10).
2. REPLAY - on the browser `online` event, `initOfflineSync()` auto-fires
   `syncQueue()`, which replays every queued sale in FIFO order against the
   live API with the same Bearer token as the online checkout. Cashiers can
   also fire `syncQueue()` manually from the Offline Queue dialog.
3. DEDUPE - the server dedupes replays on `SalesTransaction.idempotencyKey`
   (@unique). A 409 duplicate or an `idempotentReplay: true` response counts
   as success, so a retried sale can never double-charge the customer.
4. CLEANUP - on success the row is deleted from the queue (the reactive count
   drops and the top-bar indicator turns green again). On failure the row
   stays queued with `attempts++` and `lastError`, and is retried with
   backoff on the next `online` event or manual sync; the client stops the
   run early on network errors instead of hammering a dead connection.

## Safety notes

- Rows are a local buffer only; the server ledger is the source of truth.
- `clearOfflineQueue()` discards every queued sale permanently (dialog
  "Clear Queue", AlertDialog-confirmed) - sales never reach the server.
