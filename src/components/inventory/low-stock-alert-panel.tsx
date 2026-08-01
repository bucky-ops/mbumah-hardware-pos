'use client';

// LowStockAlertPanel — inventory restock watchlist.
//
// Pulls products where `quantityInStock <= reorderLevel` (with an optional
// "near reorder" yellow band when `includeNear=true`). Each row shows:
//   • Product name + SKU
//   • Current stock vs. reorder level (with a mini progress bar)
//   • Supplier (resolved from the most recent PO that contained the product)
//   • Last restocked date (most recent PURCHASE StockMovement)
//   • "Create Purchase Order" button (calls onCreatePurchaseOrder)
//
// Color coding by urgency:
//   • Out of stock (stock <= 0)       → red
//   • Below reorder (0 < stock ≤ RL)  → amber
//   • Near reorder (RL < stock ≤ 1.5×)→ yellow
//
// Summary header: "X products need attention" with breakdown chips.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, PackageX, ShoppingCart, Phone, Mail,
  Clock, RefreshCw, ChevronRight, Package,
} from 'lucide-react';

import { formatDate } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';

// ── Types ───────────────────────────────────────────────────────────────────

interface LowStockCategory {
  id: string;
  name: string;
  color: string | null;
}

interface LowStockSupplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  paymentTerms: string;
  lastPoNumber: string;
  lastPoDate: string;
  lastPoStatus: string;
  lastUnitCost: number;
}

export interface LowStockProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unitType: string;
  category: LowStockCategory | null;
  quantityInStock: number;
  reorderLevel: number;
  minimumStockLevel: number;
  maximumStockLevel: number | null;
  costPrice: number;
  pricePerUnit: number;
  deficit: number;
  urgency: 'OUT_OF_STOCK' | 'BELOW_REORDER' | 'NEAR_REORDER';
  suggestedReorderQty: number;
  supplier: LowStockSupplier | null;
  lastRestockedAt: string | null;
  lastRestockQuantity: number | null;
}

interface LowStockResponse {
  success: boolean;
  data?: LowStockProduct[];
  summary?: {
    total: number;
    outOfStock: number;
    belowReorder: number;
    nearReorder: number;
  };
}

// ── Urgency config ─────────────────────────────────────────────────────────

type UrgencyKey = 'OUT_OF_STOCK' | 'BELOW_REORDER' | 'NEAR_REORDER';

interface UrgencyConfig {
  label: string;
  rowAccent: string;     // left border accent
  badgeClass: string;    // badge styles
  barClass: string;      // progress bar fill
  icon: typeof PackageX;
}

const URGENCY_CONFIG: Record<UrgencyKey, UrgencyConfig> = {
  OUT_OF_STOCK: {
    label: 'Out of stock',
    rowAccent: 'border-l-4 border-red-500',
    badgeClass:
      'border-transparent bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
    barClass: 'bg-red-500',
    icon: PackageX,
  },
  BELOW_REORDER: {
    label: 'Below reorder',
    rowAccent: 'border-l-4 border-amber-500',
    badgeClass:
      'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
    barClass: 'bg-amber-500',
    icon: AlertTriangle,
  },
  NEAR_REORDER: {
    label: 'Near reorder',
    rowAccent: 'border-l-4 border-yellow-400',
    badgeClass:
      'border-transparent bg-yellow-100 text-yellow-700 dark:bg-yellow-950/60 dark:text-yellow-300',
    barClass: 'bg-yellow-400',
    icon: AlertTriangle,
  },
};

// ── Component ───────────────────────────────────────────────────────────────

export function LowStockAlertPanel({
  storeId,
  includeNear = false,
  onCreatePurchaseOrder,
  className,
}: {
  storeId: string;
  /** When true, also surface products between reorderLevel and 1.5× reorderLevel. */
  includeNear?: boolean;
  /** Optional callback — receives the low-stock product so the parent can open
   *  a PO dialog pre-filled with the suggested reorder quantity + supplier. */
  onCreatePurchaseOrder?: (product: LowStockProduct) => void;
  className?: string;
}) {
  const queryString = useMemo(() => {
    const params = new URLSearchParams({ storeId });
    if (includeNear) params.set('includeNear', 'true');
    return params.toString();
  }, [storeId, includeNear]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['low-stock-products', queryString],
    queryFn: async (): Promise<LowStockResponse> => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
      const res = await fetch(`/api/products/low-stock?${queryString}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'same-origin',
      });
      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          const err = await res.json();
          msg = err.error || err.message || msg;
        } catch { /* non-JSON body */ }
        throw new Error(msg);
      }
      return (await res.json()) as LowStockResponse;
    },
    enabled: !!storeId,
    staleTime: 60_000, // 1 min — stock levels change frequently during the day
  });

  const products = useMemo(() => {
    if (!data?.data) return [];
    return Array.isArray(data.data) ? data.data : [];
  }, [data]);

  const summary = data?.summary || {
    total: products.length,
    outOfStock: products.filter((p) => p.urgency === 'OUT_OF_STOCK').length,
    belowReorder: products.filter((p) => p.urgency === 'BELOW_REORDER').length,
    nearReorder: products.filter((p) => p.urgency === 'NEAR_REORDER').length,
  };

  if (isError) {
    const msg = error instanceof Error ? error.message : 'Failed to load low-stock alerts.';
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Low Stock Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {msg}
          </div>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Low Stock Alerts
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`mr-1 h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Summary header — "X products need attention" + breakdown chips */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-sm">
            <span className="font-semibold text-foreground">{summary.total}</span>
            <span className="text-muted-foreground"> product{summary.total !== 1 ? 's' : ''} need attention</span>
          </p>
          {summary.outOfStock > 0 && (
            <Badge variant="outline" className={URGENCY_CONFIG.OUT_OF_STOCK.badgeClass}>
              {summary.outOfStock} out of stock
            </Badge>
          )}
          {summary.belowReorder > 0 && (
            <Badge variant="outline" className={URGENCY_CONFIG.BELOW_REORDER.badgeClass}>
              {summary.belowReorder} below reorder
            </Badge>
          )}
          {summary.nearReorder > 0 && (
            <Badge variant="outline" className={URGENCY_CONFIG.NEAR_REORDER.badgeClass}>
              {summary.nearReorder} near reorder
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/60">
              <Package className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm font-medium">All products are well stocked!</p>
            <p className="text-xs text-muted-foreground">
              No items require restocking at this time.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[36rem] pr-2">
            <div className="space-y-2">
              {products.map((product) => {
                const cfg = URGENCY_CONFIG[product.urgency];
                const Icon = cfg.icon;
                const pct =
                  product.reorderLevel > 0
                    ? Math.min(100, (product.quantityInStock / product.reorderLevel) * 100)
                    : 0;

                return (
                  <div
                    key={product.id}
                    className={`rounded-lg border bg-card p-3 shadow-sm transition-colors hover:bg-muted/30 ${cfg.rowAccent}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">
                            {product.name}
                          </span>
                          <Badge variant="outline" className={`gap-1 ${cfg.badgeClass}`}>
                            <Icon className="h-3 w-3" />
                            {cfg.label}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          SKU: <span className="font-mono">{product.sku}</span>
                          {product.category && (
                            <>
                              {' · '}
                              <span>{product.category.name}</span>
                            </>
                          )}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 shrink-0 text-xs"
                        onClick={() => onCreatePurchaseOrder?.(product)}
                      >
                        <ShoppingCart className="mr-1 h-3 w-3" />
                        Create PO
                        <ChevronRight className="ml-0.5 h-3 w-3" />
                      </Button>
                    </div>

                    {/* Stock vs reorder bar */}
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex-1">
                        <div className="mb-1 flex items-baseline justify-between text-xs">
                          <span className="text-muted-foreground">
                            Stock:{' '}
                            <span className="font-mono font-semibold text-foreground">
                              {product.quantityInStock}
                            </span>
                            <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                              {product.unitType}
                            </span>
                          </span>
                          <span className="text-muted-foreground">
                            Reorder:{' '}
                            <span className="font-mono font-semibold text-foreground">
                              {product.reorderLevel}
                            </span>
                          </span>
                        </div>
                        <div className="relative h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full transition-all ${cfg.barClass}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      {product.deficit > 0 && (
                        <div className="shrink-0 text-right">
                          <p className="text-[10px] uppercase text-muted-foreground">Deficit</p>
                          <p className="font-mono text-sm font-semibold text-red-600 dark:text-red-400">
                            -{product.deficit}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Supplier + last restock */}
                    <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                      <div>
                        <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Supplier
                        </p>
                        {product.supplier ? (
                          <div className="space-y-0.5">
                            <p className="font-medium text-foreground">
                              {product.supplier.name}
                            </p>
                            {product.supplier.phone && (
                              <p className="flex items-center gap-1 text-muted-foreground">
                                <Phone className="h-3 w-3" />
                                <span className="font-mono">{product.supplier.phone}</span>
                              </p>
                            )}
                            {product.supplier.email && (
                              <p className="flex items-center gap-1 text-muted-foreground">
                                <Mail className="h-3 w-3" />
                                <span className="truncate">{product.supplier.email}</span>
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="italic text-muted-foreground">
                            No supplier on record
                          </p>
                        )}
                      </div>

                      <div>
                        <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Last restocked
                        </p>
                        {product.lastRestockedAt ? (
                          <div className="space-y-0.5">
                            <p className="flex items-center gap-1 text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              <span>{formatDate(product.lastRestockedAt)}</span>
                            </p>
                            {product.lastRestockQuantity !== null && (
                              <p className="text-muted-foreground">
                                Qty:{' '}
                                <span className="font-mono font-medium text-foreground">
                                  +{product.lastRestockQuantity}
                                </span>
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="italic text-muted-foreground">Never restocked</p>
                        )}
                      </div>
                    </div>

                    {product.suggestedReorderQty > 0 && (
                      <div className="mt-2 rounded-md bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
                        Suggested reorder:{' '}
                        <span className="font-mono font-semibold text-foreground">
                          {product.suggestedReorderQty} {product.unitType}
                        </span>
                        {' '}
                        <span className="text-muted-foreground/70">
                          (to reach 1.5× reorder level)
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export default LowStockAlertPanel;
