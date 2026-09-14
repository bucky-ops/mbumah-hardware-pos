"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { PackageSearch, Plus, Search } from "lucide-react";

import type { Product } from "@/lib/types";
import { D, formatKES, formatQty } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY VIRTUALIZATION?
 * ─────────────────────────────────────────────────────────────────────────────
 * A hardware store easily carries 2,500+ SKUs (fasteners alone are hundreds of
 * diameter/length variants). Rendering the full catalog costs ~8 DOM nodes per
 * row → 20k+ nodes, which blows the frame budget while scrolling
 * (style → layout → paint >> 16 ms/frame) and spikes memory on the cheap shop
 * tablets this POS targets.
 *
 * @tanstack/react-virtual keeps only the visible window (+ overscan) mounted:
 *   ≈ (viewportHeight / 64px) + 2 × 8 overscan ≈ 25 rows ≈ 200 DOM nodes
 * and repositions rows with `transform` — a compositor-only property, so
 * scrolling never triggers re-layout of the list.
 *
 * 60 FPS BUDGET AT 2,500+ SKUs:
 *  - the filter pass is a single O(n) `useMemo` over plain string compares
 *    (sub-millisecond at 2.5k rows), debounced 150 ms so typing never
 *    re-filters per keystroke;
 *  - a scroll/keystroke re-render touches ≤ ~25 row elements, never the
 *    catalog — React reconciliation cost is bounded by the window size;
 *  - row identity is stable (`product.id`) so re-renders patch, not rebuild.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface InventoryListProps {
  products: Product[];
  loading?: boolean;
  onAdd: (p: Product) => void;
  className?: string;
}

type StockState = "out" | "low" | "ok";

// Responsive grid ships as plain CSS (.sku-row in globals.css) — immune to
// Tailwind arbitrary-value scanning lapses; mobile 4-col, sm+ 6-col.
const ROW_GRID = "sku-row";

const ROW_GRID_HEADER = ROW_GRID;

function stockState(p: Product): StockState {
  const qty = D(p.stockQty);
  if (qty.lte(0)) return "out";
  if (qty.lte(D(p.reorderLevel))) return "low";
  return "ok";
}

const STOCK_BADGE: Record<StockState, string> = {
  out: "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
  low: "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
};

export function InventoryList({ products, loading = false, onAdd, className }: InventoryListProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const parentRef = useRef<HTMLDivElement>(null);

  // 150 ms debounce — filtering 2,500+ SKUs on every keystroke would eat the
  // input-latency budget; 150 ms stays under a "snappy" perception threshold.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), 150);
    return () => window.clearTimeout(t);
  }, [query]);

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category))).sort((a, b) => a.localeCompare(b)),
    [products]
  );

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (lowStockOnly && !D(p.stockQty).lte(D(p.reorderLevel))) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q)
      );
    });
  }, [products, debouncedQuery, category, lowStockOnly]);

  // eslint-disable-next-line react-hooks/incompatible-library -- false positive: the scroll element is a stable ref and the virtualizer instance is constant per mount
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      {/* Toolbar: search (F1 focus target) + category + low-stock toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            data-hotkey-target="search"
            aria-label="Search products by name, SKU or barcode"
            placeholder="Search name, SKU, barcode…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[11rem]" aria-label="Filter by category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-500">
          <Switch checked={lowStockOnly} onCheckedChange={setLowStockOnly} aria-label="Show low stock only" />
          Low stock only
        </label>
      </div>

      {/* Sticky column header (inside the scroll container so it tracks it) */}
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-card dark:border-stone-800">
        <div className={cn(ROW_GRID, "border-b border-stone-200 bg-stone-50 px-3 py-2 text-xs font-medium tracking-wide text-stone-500 uppercase dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-400")}>
          <span>Product</span>
          <span className="hidden sm:block">SKU</span>
          <span className="hidden sm:block">Category</span>
          <span>Stock</span>
          <span className="text-right">Price</span>
          <span className="sr-only">Add</span>
        </div>

        {loading ? (
          <div className="space-y-2 p-3" aria-label="Loading products">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-stone-500 dark:text-stone-400">
            <PackageSearch className="size-8 text-stone-300 dark:text-stone-600" aria-hidden />
            <p className="font-medium text-stone-600 dark:text-stone-500">No products match</p>
            <p className="text-xs">Adjust the search, category or low-stock filter.</p>
          </div>
        ) : (
          <div
            ref={parentRef}
            className="max-h-[calc(100vh-16rem)] overflow-auto"
            role="listbox"
            aria-label="Product inventory"
          >
            <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const p = filtered[vi.index];
                const stock = stockState(p);
                return (
                  <div
                    key={p.id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: vi.size,
                      transform: `translateY(${vi.start}px)`,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onAdd(p)}
                      aria-label={`Add ${p.name} (${formatKES(p.sellingPrice)}) to cart`}
                      className={cn(
                        ROW_GRID,
                        "h-full w-full cursor-pointer border-b border-stone-100 px-3 text-left transition-colors hover:bg-emerald-50/60 focus-visible:bg-emerald-50 focus-visible:outline-none dark:border-stone-800 dark:hover:bg-emerald-950/40 dark:focus-visible:bg-emerald-950/40"
                      )}
                    >
                      <span className="min-w-0 truncate text-sm font-medium text-stone-800 dark:text-stone-200">{p.name}</span>
                      <span className="hidden truncate text-xs text-stone-500 sm:block dark:text-stone-400" title={p.sku}>{p.sku}</span>
                      <Badge variant="outline" className="hidden max-w-full truncate border-stone-200 text-stone-600 sm:flex dark:border-stone-800 dark:text-stone-500">
                        {p.category}
                      </Badge>
                      {stock === "out" ? (
                        <Badge variant="outline" className={cn("justify-center", STOCK_BADGE.out)}>OUT</Badge>
                      ) : stock === "low" ? (
                        <Badge
                          variant="outline"
                          className={cn("justify-center", STOCK_BADGE.low)}
                          title={`Reorder level: ${formatQty(p.reorderLevel, p.unit)}`}
                        >
                          {formatQty(p.stockQty, p.unit)}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className={cn("justify-center", STOCK_BADGE.ok)}
                          title={`Reorder level: ${formatQty(p.reorderLevel, p.unit)}`}
                        >
                          {formatQty(p.stockQty, p.unit)}
                        </Badge>
                      )}
                      <span className="truncate text-right text-sm font-semibold text-stone-800 dark:text-stone-200">
                        {formatKES(p.sellingPrice)}
                      </span>
                      <span
                        aria-hidden
                        className="inline-flex items-center justify-center gap-0.5 rounded-md bg-emerald-600 px-1.5 py-1 text-xs font-medium text-white"
                      >
                        <Plus className="size-3" />
                        Add
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer census — confirms the virtualized window is what you're seeing */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {filtered.length} of {products.length} SKUs · virtualized
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => {
            setQuery("");
            setCategory("all");
            setLowStockOnly(false);
          }}
        >
          Reset filters
        </Button>
      </div>
    </div>
  );
}
