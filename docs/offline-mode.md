# Offline mode

The POS keeps selling when the connection drops (Juja, Nakuru, Ruiru branches). Offline sales are buffered on the device, replayed automatically when connectivity returns, and deduplicated server-side so a retried sale can never double-charge a customer.

## How it works

1. **Queue** - if a checkout fails because the device is offline, the sale is persisted locally (IndexedDB via the queue engine in `src/lib/offline-sync.ts`). The row carries a client receipt number (`OFFLINE-<ts>-<rand>`) so the cashier can print a paper receipt immediately, plus a stable client-generated `idempotencyKey`.
2. **Replay** - when the browser fires its `online` event, `initOfflineSync()` replays every queued sale in FIFO order against the live API with the same authentication as an online checkout. Cashiers can also trigger a replay manually from the Offline Queue dialog ("Sync Now").
3. **Dedupe** - the server deduplicates replays on `SalesTransaction.idempotencyKey` (unique). A 409 duplicate or an `idempotentReplay: true` response counts as success.
4. **Cleanup** - on success the row is deleted and the top-bar indicator returns to green. On failure the row stays queued with an attempt counter and the last error, and is retried with backoff on the next reconnect or manual sync.

## What the cashier sees

| Surface | Behaviour |
|---------|-----------|
| Top-bar indicator | Green dot when online, amber when there are queued sales, dialog lists every queued sale with its receipt number, attempts and last error. Available on every tab. |
| Offline warning | One toast when the device goes offline ("Sales will be saved locally and synced automatically"). |
| Back online | One "Back online - syncing queued sales..." toast on reconnect. |
| Sync result | Exactly one "Offline sales synced" success toast per queue transition, shown globally by the top-bar indicator. The POS tab adds detail only for failures (which sales will retry). |
| Clear Queue | Permanently discards every queued sale (confirmation dialog). Cleared sales never reach the server. |

## Testing offline mode

1. Sign in and open the POS tab.
2. DevTools > Network > set the throttling profile to **Offline**.
3. Ring up a sale and complete checkout - the sale completes locally, prints with an `OFFLINE-` receipt number and the indicator turns amber with a count.
4. Queue a second sale, then set throttling back to **No throttling**.
5. Watch the auto-replay: the count drops to zero, the single success toast appears, and the sales show up under Transactions with their real receipt numbers.

To wipe the local buffer instead of syncing, open the indicator dialog and use "Clear Queue" (permanently discards - the sales will not be charged or recorded).

## Developer notes

- Canonical import path: `import { syncQueue, getQueueCount, subscribeOfflineCount, clearOfflineQueue } from '@/lib/offline'` (the flat `@/lib/offline-sync` module remains for older imports and shares the same instance).
- Queue contract and safety notes: `src/lib/offline/README.md`.
- The reactive pending count uses `useSyncExternalStore`; components must never derive it from local state.
- Rows are a local buffer only - the server ledger is the source of truth.
- Realtime notifications (separate from the offline queue) ride a socket.io connection handled by `src/lib/socket-client.ts`; self-hosted deployments route it through nginx (see [Deployment](deployment.md)).
