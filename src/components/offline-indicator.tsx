'use client';

// MBUMAH HARDWARE POS - OfflineIndicator (top-bar status dot + queue dialog)
//
// A compact connectivity + pending-sync indicator that lives on the right
// side of the TopBar. The queue engine itself is src/lib/offline-sync.ts
// (canonical import path '@/lib/offline'); this component only makes the
// offline story VISIBLE and MANAGEABLE for the cashier:
//
//   ONLINE, EMPTY QUEUE   subtle green dot, tooltip "All sales synced".
//                         Not clickable - there is nothing to manage.
//   ONLINE, PENDING > 0   amber pulsing dot + amber count badge ("3 pending"
//                         on sm+ screens). Click opens the Offline Queue
//                         dialog.
//   OFFLINE               amber pulsing dot + "Offline" (text hidden on xs)
//                         + pending badge when sales are queued. Click opens
//                         the dialog (sales made offline land there).
//
// The dialog lists every queued sale (client receipt number, item count,
// estimated total, queued-at time, retry status) with two actions:
//   - "Sync Now" replays the queue immediately via syncQueue() and toasts
//     the result.
//   - "Clear Queue" (destructive, AlertDialog confirmed) discards every
//     queued sale via clearOfflineQueue(). Removed rows never reach the
//     server, so the cashier must confirm explicitly.
//
// Sync-on-reconnect: the component watches the reactive queue count and, on
// the pending > 0 -> 0 transition that follows a successful sync, shows
// exactly one "Offline sales synced" toast. Manual syncs and clears show
// their own result toast, so the transition toast is suppressed for them
// (one toast per transition, no spam).
//
// Accessibility: the trigger carries a state-describing aria-label, the
// count badge is role="status" so screen readers announce queue changes,
// and the green dot keeps an sr-only description.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { CloudOff, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useNetworkStatus } from '@/hooks/use-network-status';
import { getCachedVatRate } from '@/lib/vat-rate-cache';
import { formatKES } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  clearOfflineQueue,
  getOfflineCountSnapshot,
  getQueuedTransactions,
  primeOfflineCount,
  subscribeOfflineCount,
  syncQueue,
  type OfflineTransactionRow,
} from '@/lib/offline';

/** Same math as buildOfflineReceipt: subtotal + VAT - discount, at 2dp. */
function estimateRowTotal(row: OfflineTransactionRow): number {
  const subtotal = row.payload.items.reduce(
    (sum, item) =>
      sum + item.pricePerUnit * item.quantity * (1 - (item.discountPercent || 0) / 100),
    0,
  );
  const tax = subtotal * (getCachedVatRate() / 100);
  const total = subtotal + tax - (row.payload.discountAmount || 0);
  return Math.round(total * 100) / 100;
}

/** "9 Oct 14:32" style queued-at stamp for the dialog list. */
function formatQueuedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })} ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Rows never attempted are "Queued"; rows with failures keep their count. */
function rowStatus(row: OfflineTransactionRow): { label: string; failed: boolean } {
  if (row.attempts > 0) {
    return { label: `Retry (${row.attempts})`, failed: true };
  }
  return { label: 'Queued', failed: false };
}

function pluralSales(count: number): string {
  return `${count} ${count === 1 ? 'sale' : 'sales'}`;
}

// Compact amber count badge ("3 pending" on sm+, just the number on xs).
function PendingBadge({ count }: { count: number }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-amber-100 px-1.5 text-[10px] font-bold leading-4 tabular-nums text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
    >
      {count}
      <span className="hidden sm:inline">&nbsp;pending</span>
    </span>
  );
}

// Pulsing amber dot shared by the offline and pending states.
function AmberDot() {
  return (
    <span className="relative flex h-2 w-2" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-60 animate-ping" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
    </span>
  );
}

const TRIGGER_BASE =
  'inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40';

function OfflineQueueDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: OfflineTransactionRow[];
  pendingCount: number;
  isOnline: boolean;
  isSyncing: boolean;
  isClearing: boolean;
  onSyncNow: () => void;
  onRequestClear: () => void;
}) {
  const {
    open,
    onOpenChange,
    rows,
    pendingCount,
    isOnline,
    isSyncing,
    isClearing,
    onSyncNow,
    onRequestClear,
  } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0">
        <DialogHeader className="px-4 pb-2 pt-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            Offline Queue
            <Badge variant="secondary" className="tabular-nums">
              {pendingCount}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isOnline
              ? 'Sales made while offline replay to the server from here.'
              : 'You are offline. Queued sales replay automatically when the connection returns.'}
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <CloudOff className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" aria-hidden="true" />
            <p className="text-sm font-medium">No sales waiting to sync</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sales made while offline are saved here automatically.
            </p>
          </div>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto custom-scrollbar">
            {rows.map((row) => {
              const status = rowStatus(row);
              const itemCount = row.payload.items.length;
              return (
                <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-semibold text-foreground">
                      {row.clientReceiptNumber}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {itemCount} {itemCount === 1 ? 'item' : 'items'} · queued{' '}
                      {formatQueuedAt(row.queuedAt)}
                    </p>
                    {row.lastError ? (
                      <p className="mt-1 truncate text-xs text-destructive" title={row.lastError}>
                        {row.lastError}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="whitespace-nowrap text-sm font-semibold tabular-nums">
                      {formatKES(estimateRowTotal(row))}
                    </span>
                    <Badge variant={status.failed ? 'destructive' : 'secondary'} className="text-[10px]">
                      {status.label}
                    </Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter className="gap-2 border-t px-4 py-3 sm:items-center sm:justify-between">
          <p className="self-center text-xs text-muted-foreground sm:self-auto">
            {pluralSales(pendingCount)} waiting ·{' '}
            {isOnline ? 'ready to sync' : 'will sync when back online'}
          </p>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button
              variant="destructive"
              size="sm"
              className="flex-1 sm:flex-none"
              disabled={rows.length === 0 || isSyncing || isClearing}
              onClick={onRequestClear}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Clear Queue
            </Button>
            <Button
              size="sm"
              className="flex-1 sm:flex-none"
              disabled={!isOnline || rows.length === 0 || isSyncing || isClearing}
              onClick={onSyncNow}
            >
              {isSyncing ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              )}
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OfflineIndicator() {
  const { isOnline } = useNetworkStatus();
  const pendingCount = useSyncExternalStore(
    subscribeOfflineCount,
    getOfflineCountSnapshot,
    () => 0, // SSR snapshot
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [rows, setRows] = useState<OfflineTransactionRow[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Keep the reactive count honest app-wide: the POS tab primes it on its
  // own mount, but the TopBar mounts on every tab, so prime here too
  // (idempotent, one IndexedDB count read).
  useEffect(() => {
    primeOfflineCount().catch(() => {
      /* non-fatal - the count stays at 0 until the next queue change */
    });
  }, []);

  // Sync-on-reconnect toast: exactly one per pending > 0 -> 0 transition.
  const prevCountRef = useRef<number | null>(null);
  const suppressTransitionToastRef = useRef(false);

  useEffect(() => {
    const previous = prevCountRef.current;
    prevCountRef.current = pendingCount;
    if (previous === null || previous === pendingCount) return;
    if (previous > 0 && pendingCount === 0) {
      if (suppressTransitionToastRef.current) {
        // The manual sync/clear already showed its own result toast.
        suppressTransitionToastRef.current = false;
        return;
      }
      toast.success('Offline sales synced', { duration: 4000 });
    } else if (pendingCount > previous) {
      // New sales queued - re-arm the transition toast.
      suppressTransitionToastRef.current = false;
    }
  }, [pendingCount]);

  const refreshRows = useCallback(async () => {
    try {
      setRows(await getQueuedTransactions());
    } catch {
      setRows([]);
    }
  }, []);

  // Load the dialog list when it opens and whenever the queue size changes
  // while it is open (an automatic background sync drains it live).
  useEffect(() => {
    if (dialogOpen) {
      refreshRows();
    }
  }, [dialogOpen, pendingCount, refreshRows]);

  const handleSyncNow = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    // Arm the suppression BEFORE awaiting: the external store publishes the
    // new count while syncQueue() resolves, and the manual result toast
    // below already covers this transition.
    suppressTransitionToastRef.current = true;
    try {
      const result = await syncQueue();
      if (result.succeeded > 0 && result.failed === 0) {
        toast.success(`Synced ${result.succeeded} ${result.succeeded === 1 ? 'sale' : 'sales'}.`, {
          duration: 4000,
        });
      } else if (result.succeeded > 0) {
        toast.warning(
          `Synced ${result.succeeded} ${result.succeeded === 1 ? 'sale' : 'sales'}, but ${result.failed} failed and will retry.`,
          { duration: 5000 },
        );
      } else if (result.failed > 0) {
        toast.error(
          `${result.failed} ${result.failed === 1 ? 'sale' : 'sales'} failed to sync and will retry automatically.`,
          { duration: 5000 },
        );
      } else {
        toast.info(isOnline ? 'No sales to sync right now.' : 'You are offline. Reconnect to sync queued sales.');
      }
      if (!(result.succeeded > 0 && result.failed === 0)) {
        // The queue did not fully drain - re-arm the automatic toast.
        suppressTransitionToastRef.current = false;
      }
      await refreshRows();
    } catch (error) {
      suppressTransitionToastRef.current = false;
      toast.error(
        `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}. Will retry automatically.`,
      );
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, isOnline, refreshRows]);

  const handleRequestClear = useCallback(() => {
    setConfirmClearOpen(true);
  }, []);

  const handleConfirmClear = useCallback(async () => {
    if (isClearing) return;
    setIsClearing(true);
    // The toast below covers this transition - arm the suppression before
    // the await so it is already set when the store publishes the new count.
    suppressTransitionToastRef.current = true;
    try {
      const removed = await clearOfflineQueue();
      if (removed > 0) {
        toast.success(`Cleared ${removed} queued ${removed === 1 ? 'sale' : 'sales'} from this device.`);
      } else {
        // Nothing was removed, so no transition will fire - disarm.
        suppressTransitionToastRef.current = false;
        toast.info('The queue is already empty.');
      }
      setRows([]);
    } catch {
      suppressTransitionToastRef.current = false;
      toast.error('Could not clear the queue. Please try again.');
    } finally {
      setIsClearing(false);
      setConfirmClearOpen(false);
    }
  }, [isClearing]);

  // Trigger: state (a) online + subtle green dot, (b) pending/offline amber.
  let trigger: ReactNode;
  if (!isOnline) {
    trigger = (
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className={`${TRIGGER_BASE} text-amber-700 hover:bg-amber-500/10 dark:text-amber-300`}
        title={
          pendingCount > 0
            ? `Offline - ${pluralSales(pendingCount)} will sync when back online`
            : 'Offline - sales will be saved locally'
        }
        aria-label={
          pendingCount > 0
            ? `Offline. ${pluralSales(pendingCount)} waiting to sync. Open the offline queue.`
            : 'Offline. Open the offline queue.'
        }
      >
        <AmberDot />
        <span className="hidden sm:inline">Offline</span>
        {pendingCount > 0 && <PendingBadge count={pendingCount} />}
      </button>
    );
  } else if (pendingCount > 0) {
    trigger = (
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className={`${TRIGGER_BASE} text-amber-700 hover:bg-amber-500/10 dark:text-amber-300`}
        title={`${pluralSales(pendingCount)} waiting to sync`}
        aria-label={`${pluralSales(pendingCount)} waiting to sync. Open the offline queue.`}
      >
        <AmberDot />
        <PendingBadge count={pendingCount} />
      </button>
    );
  } else {
    trigger = (
      <span className="inline-flex items-center px-1 py-1.5" title="All sales synced">
        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
        <span className="sr-only">Online. All sales synced.</span>
      </span>
    );
  }

  return (
    <>
      {trigger}
      <OfflineQueueDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rows={rows}
        pendingCount={pendingCount}
        isOnline={isOnline}
        isSyncing={isSyncing}
        isClearing={isClearing}
        onSyncNow={handleSyncNow}
        onRequestClear={handleRequestClear}
      />
      <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the offline queue?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently discards {pluralSales(rows.length)} queued on this device. They will
              never reach the server and cannot be recovered. Sync first if they should be on the
              ledger.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>Keep sales</AlertDialogCancel>
            <AlertDialogAction
              disabled={isClearing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                // Keep the alert dialog open while the async clear runs.
                event.preventDefault();
                handleConfirmClear();
              }}
            >
              {isClearing ? 'Clearing...' : 'Clear queue'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
