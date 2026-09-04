'use client';

/**
 * Held-carts picker — AUDIT FIX (Task 3-e).
 * Replaces the blind `heldCarts.pop()` LIFO recall: the cashier can now see
 * every parked cart (held-at, item count, total, customer) and resume ANY of
 * them out of order, or delete one. Held carts are localStorage-only and never
 * reserve stock, so deleting one requires no stock release.
 */

import {
  Pause, Play, Trash2, Package, Clock, Inbox,
} from 'lucide-react';
import { formatKES, formatDateTime, type CustomerItem } from '@/lib/api';
import type { CartItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

export interface HeldCartRecord {
  id: string;
  items: CartItem[];
  customer?: string;
  notes?: Record<string, string>;
  timestamp: string;
  // Picker metadata (added Task 3-e; older records fall back to items).
  count?: number;
  total?: number;
  label?: string;
}

// Total units across lines (matches cart.getItemCount()); falls back for
// records held before the metadata was introduced.
function itemCountOf(record: HeldCartRecord): number {
  if (typeof record.count === 'number') return record.count;
  if (!Array.isArray(record.items)) return 0;
  return record.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

// Pre-tax total at hold time (Σ lineTotal, i.e. after line discounts).
function cartTotalOf(record: HeldCartRecord): number {
  if (typeof record.total === 'number') return record.total;
  if (!Array.isArray(record.items)) return 0;
  return record.items.reduce(
    (sum, item) => sum + (Number(item.lineTotal) || (Number(item.pricePerUnit) || 0) * (Number(item.quantity) || 0)),
    0,
  );
}

export function HeldCartsDialog({
  open,
  onOpenChange,
  heldCarts,
  customers,
  onResume,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heldCarts: HeldCartRecord[];
  customers: CustomerItem[];
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const customerNameOf = (record: HeldCartRecord): string => {
    if (!record.customer || record.customer === 'walk-in') return 'Walk-in customer';
    return customers.find((c) => c.id === record.customer)?.name || record.customer;
  };

  // Newest first — the cart just parked is the one most likely to be resumed.
  const sorted = [...heldCarts].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pause className="h-5 w-5 text-amber-500" />
            Held carts
            {heldCarts.length > 0 && (
              <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                {heldCarts.length}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Resume a parked cart or delete it. Held carts don&apos;t reserve stock.
          </DialogDescription>
        </DialogHeader>

        {sorted.length === 0 ? (
          <div className="py-8 text-center">
            <Inbox className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm font-medium">No held carts</p>
            <p className="text-xs text-muted-foreground mt-1">Parked carts will appear here.</p>
          </div>
        ) : (
          <div
            className="max-h-[60vh] overflow-y-auto custom-scrollbar -mx-1 px-1 space-y-2"
            role="list"
            aria-label="Held carts list"
          >
            {sorted.map((record) => (
              <div
                key={record.id}
                role="listitem"
                className="rounded-lg border bg-muted/30 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                    <Clock className="h-3 w-3 shrink-0" />
                    <span className="truncate">{record.timestamp ? formatDateTime(record.timestamp) : 'Unknown time'}</span>
                  </span>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    <Package className="h-2.5 w-2.5 mr-0.5" />
                    {itemCountOf(record)} item{itemCountOf(record) !== 1 ? 's' : ''}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm min-w-0">
                    <span className="font-semibold">{formatKES(cartTotalOf(record))}</span>
                    <span className="text-muted-foreground text-xs ml-1 truncate">
                      · {customerNameOf(record)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      onClick={() => onResume(record.id)}
                      aria-label={`Resume held cart from ${record.timestamp ? formatDateTime(record.timestamp) : 'unknown time'}`}
                    >
                      <Play className="h-3 w-3" /> Resume
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                      onClick={() => onDelete(record.id)}
                      aria-label={`Delete held cart from ${record.timestamp ? formatDateTime(record.timestamp) : 'unknown time'}`}
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </Button>
                  </div>
                </div>
                {record.label && (
                  <p className="text-xs text-muted-foreground truncate">{record.label}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
