'use client';

// StockMovementLog — a self-contained inventory audit trail table.
//
// Features:
//   • Table of recent stock movements with product + user details.
//   • Type filter (PURCHASE / SALE / ADJUSTMENT / RETURN / TRANSFER /
//     RENTAL_OUT / RENTAL_RETURN / ALL).
//   • Date-range filter (from / to).
//   • Pagination controls (prev / next + page indicator) using the new
//     `offset` + `limit` query params supported by /api/stock-movements.
//   • Color-coded type badges per task spec:
//       PURCHASE → blue, SALE → gray, ADJUSTMENT → amber,
//       RETURN → green, TRANSFER → purple, RENTAL_* → slate.
//   • Empty state with a friendly message when no movements match.
//
// Props:
//   storeId — required. The store whose movements to display.
//   productId — optional. When set, the log is scoped to that product
//     (used by the product detail drawer).
//   pageSize — optional, default 10.

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Package, ArrowDownLeft, ArrowUpRight, SlidersHorizontal,
  ChevronLeft, ChevronRight, History, X,
} from 'lucide-react';

import { formatDateTime } from '@/lib/api';
import { formatQtyWithUnit } from '@/lib/utils/financialMath';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// ── Types ───────────────────────────────────────────────────────────────────

interface StockMovementProduct {
  id: string;
  name: string;
  sku: string;
  unitType: string;
  quantityInStock: number | string;
}

export interface StockMovementRow {
  id: string;
  storeId: string;
  productId: string;
  movementType: string;
  quantity: number | string;
  referenceId: string | null;
  notes: string | null;
  performedBy: string | null;
  createdAt: string;
  product?: StockMovementProduct;
}

interface StockMovementsResponse {
  success: boolean;
  data?: StockMovementRow[];
  pagination?: {
    offset: number;
    limit: number;
    total: number;
    totalPages: number;
    page: number;
  };
  summary?: Array<{ type: string; count: number; totalQuantity: number }>;
}

// ── Movement type config ────────────────────────────────────────────────────

type MovementTypeKey =
  | 'PURCHASE' | 'SALE' | 'ADJUSTMENT' | 'RETURN'
  | 'TRANSFER' | 'RENTAL_OUT' | 'RENTAL_RETURN';

interface MovementTypeConfig {
  label: string;
  badgeClass: string;
  icon: typeof Package;
  sign: '+' | '-' | '±';
}

const MOVEMENT_TYPE_CONFIG: Record<MovementTypeKey, MovementTypeConfig> = {
  PURCHASE: {
    label: 'Purchase',
    badgeClass:
      'border-transparent bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300',
    icon: ArrowDownLeft,
    sign: '+',
  },
  SALE: {
    label: 'Sale',
    badgeClass:
      'border-transparent bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    icon: ArrowUpRight,
    sign: '-',
  },
  ADJUSTMENT: {
    label: 'Adjustment',
    badgeClass:
      'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
    icon: SlidersHorizontal,
    sign: '±',
  },
  RETURN: {
    label: 'Return',
    badgeClass:
      'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
    icon: ArrowDownLeft,
    sign: '+',
  },
  TRANSFER: {
    label: 'Transfer',
    badgeClass:
      'border-transparent bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300',
    icon: ArrowUpRight,
    sign: '±',
  },
  RENTAL_OUT: {
    label: 'Rental Out',
    badgeClass:
      'border-transparent bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    icon: ArrowUpRight,
    sign: '-',
  },
  RENTAL_RETURN: {
    label: 'Rental Return',
    badgeClass:
      'border-transparent bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    icon: ArrowDownLeft,
    sign: '+',
  },
};

const FILTER_TYPES: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All Types' },
  { value: 'PURCHASE', label: 'Purchase' },
  { value: 'SALE', label: 'Sale' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
  { value: 'RETURN', label: 'Return' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'RENTAL_OUT', label: 'Rental Out' },
  { value: 'RENTAL_RETURN', label: 'Rental Return' },
];

// ── Component ───────────────────────────────────────────────────────────────

export function StockMovementLog({
  storeId,
  productId,
  pageSize = 10,
  className,
}: {
  storeId: string;
  productId?: string;
  pageSize?: number;
  className?: string;
}) {
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [offset, setOffset] = useState<number>(0);

  // Build the query string for the API.
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('storeId', storeId);
    params.set('limit', String(pageSize));
    params.set('offset', String(offset));
    if (productId) params.set('productId', productId);
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    return params.toString();
  }, [storeId, productId, typeFilter, dateFrom, dateTo, offset, pageSize]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['stock-movement-log', queryString],
    queryFn: async (): Promise<StockMovementsResponse> => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
      const res = await fetch(`/api/stock-movements?${queryString}`, {
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
      return (await res.json()) as StockMovementsResponse;
    },
    enabled: !!storeId,
    staleTime: 30_000,
  });

  const movements = useMemo(() => {
    if (!data?.data) return [];
    return Array.isArray(data.data) ? data.data : [];
  }, [data]);

  const pagination = data?.pagination;
  const total = pagination?.total ?? 0;
  const totalPages = pagination?.totalPages ?? 1;
  const currentPage = pagination?.page ?? 1;

  const handleFilterChange = useCallback(() => {
    setOffset(0);
  }, []);

  const onTypeChange = (v: string) => {
    setTypeFilter(v);
    handleFilterChange();
  };

  const onDateFromChange = (v: string) => {
    setDateFrom(v);
    handleFilterChange();
  };

  const onDateToChange = (v: string) => {
    setDateTo(v);
    handleFilterChange();
  };

  const clearFilters = () => {
    setTypeFilter('all');
    setDateFrom('');
    setDateTo('');
    setOffset(0);
  };

  const hasActiveFilters = typeFilter !== 'all' || !!dateFrom || !!dateTo;

  const goPrev = () => setOffset((o) => Math.max(0, o - pageSize));
  const goNext = () => setOffset((o) => o + pageSize);

  if (isError) {
    const msg = error instanceof Error ? error.message : 'Failed to load stock movements.';
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Stock Movement Log
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {msg}
          </div>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            Retry
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
            <History className="h-4 w-4" /> Stock Movement Log
          </CardTitle>
          <div className="text-xs text-muted-foreground">
            {total} record{total !== 1 ? 's' : ''} {productId ? 'for this product' : 'total'}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Filter bar ─────────────────────────────────────────── */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Type</label>
            <Select value={typeFilter} onValueChange={onTypeChange}>
              <SelectTrigger size="sm" className="w-[160px]">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                {FILTER_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">From</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              className="h-8 w-[150px]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">To</label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              className="h-8 w-[150px]"
            />
          </div>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">
              <X className="mr-1 h-3.5 w-3.5" /> Clear
            </Button>
          )}

          {/* Summary chips (top 3 movement types by count) */}
          {data?.summary && data.summary.length > 0 && (
            <div className="ml-auto hidden flex-wrap gap-1.5 sm:flex">
              {data.summary.slice(0, 4).map((s) => {
                const cfg = MOVEMENT_TYPE_CONFIG[s.type as MovementTypeKey];
                if (!cfg) return null;
                return (
                  <span
                    key={s.type}
                    className="inline-flex items-center rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {cfg.label}: <span className="ml-1 font-medium text-foreground">{s.count}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Table ────────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-md border">
          <div className="max-h-[28rem] overflow-auto scrollbar-thin">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="w-[140px]">Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="w-[120px]">Type</TableHead>
                  <TableHead className="w-[100px] text-right">Quantity</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="w-[140px]">User</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: Math.min(pageSize, 6) }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`}>
                      <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-[180px]" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-[80px] rounded-full" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-[50px]" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-[160px]" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                    </TableRow>
                  ))
                ) : movements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32">
                      <div className="flex flex-col items-center justify-center gap-2 text-center">
                        <Package className="h-8 w-8 text-muted-foreground/50" />
                        <p className="text-sm font-medium">No stock movements found</p>
                        <p className="text-xs text-muted-foreground">
                          {hasActiveFilters
                            ? 'Try adjusting your filters or clearing them.'
                            : 'Stock movements will appear here once products are sold, purchased, or adjusted.'}
                        </p>
                        {hasActiveFilters && (
                          <Button variant="outline" size="sm" onClick={clearFilters} className="mt-2 h-7 text-xs">
                            <X className="mr-1 h-3 w-3" /> Clear Filters
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  movements.map((m) => {
                    const cfg =
                      MOVEMENT_TYPE_CONFIG[m.movementType as MovementTypeKey] || {
                        label: m.movementType,
                        badgeClass: 'border-transparent bg-muted text-muted-foreground',
                        icon: SlidersHorizontal,
                        sign: '±',
                      };
                    const Icon = cfg.icon;
                    const qty = Number(m.quantity) || 0;
                    const isNegative = qty < 0;
                    // Signed display qty with smart unit label; formatQtyWithUnit
                    // renders "-2.50 m" verbatim so the sign is preserved.
                    const displayQty = `${qty > 0 ? '+' : ''}${formatQtyWithUnit(qty, m.product?.unitType)}`;
                    return (
                      <TableRow key={m.id} className="hover:bg-muted/40">
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(m.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium leading-tight">
                              {m.product?.name || 'Unknown product'}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {m.product?.sku || '—'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`gap-1 ${cfg.badgeClass}`}>
                            <Icon className="h-3 w-3" />
                            {cfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={`font-mono text-sm font-semibold ${
                              isNegative
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {displayQty}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {m.notes || '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {m.performedBy ? (
                            <span className="font-mono">{m.performedBy.slice(0, 8)}…</span>
                          ) : (
                            <span className="italic">System</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* ── Pagination ────────────────────────────────────────── */}
        {total > pageSize && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Showing {offset + 1}–{Math.min(offset + pageSize, total)} of {total}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={goPrev}
                disabled={offset === 0 || isLoading}
                className="h-8"
              >
                <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Prev
              </Button>
              <span className="px-2 text-xs text-muted-foreground">
                Page {currentPage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={goNext}
                disabled={offset + pageSize >= total || isLoading}
                className="h-8"
              >
                Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default StockMovementLog;
