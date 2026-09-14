"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  ClipboardCheck, FileWarning, History, PackagePlus, RefreshCw, ShieldAlert, ShoppingCart, Undo2,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatKES, formatQty } from "@/lib/format";
import { roleAtLeast, type SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// StockMovementsLog — self-contained panel over GET /api/inventory/movements.
//
//  • MANAGER+ data (RESTOCK rows carry the supplier buying price), so the
//    component short-circuits to a quiet notice for cashiers instead of
//    firing a doomed request — and still handles a runtime 403 (role changed
//    mid-session) the same way.
//  • The parent bumps `refreshKey` (e.g. after an adjust or product create)
//    to trigger a silent refetch; stale responses from an older request are
//    dropped via a monotonically increasing sequence guard.
// ─────────────────────────────────────────────────────────────────────────────

export interface StockMovement {
  id: string;
  type: string; // RESTOCK | SALE | WRITE_OFF | STOCK_COUNT | RETURN
  quantity: string; // signed delta, decimals as strings
  unitCost: string | null;
  reason: string | null;
  reference: string | null;
  createdAt: string;
  product: { name: string; sku: string; unit: string };
  user: { name: string };
  branchId: string;
}

interface MovementsResponse {
  items: StockMovement[];
}

export interface StockMovementsLogProps {
  session: SessionUser;
  /** Bump to refetch (parent changes it after adjustments / product creation). */
  refreshKey?: number;
  /** OWNER branch scope: `null`/omitted = all branches. Ignored server-side for
   *  non-OWNERs (assertTargetBranch fences them to their own branch). */
  branchId?: string | null;
}

const MOVEMENT_STYLE: Record<string, { icon: LucideIcon; chip: string; label: string }> = {
  RESTOCK: { icon: PackagePlus, chip: "bg-emerald-100 text-emerald-700", label: "Restock" },
  WRITE_OFF: { icon: FileWarning, chip: "bg-rose-100 text-rose-700", label: "Write-off" },
  SALE: { icon: ShoppingCart, chip: "bg-slate-100 text-slate-700", label: "Sale" },
  STOCK_COUNT: { icon: ClipboardCheck, chip: "bg-amber-100 text-amber-700", label: "Stock count" },
  RETURN: { icon: Undo2, chip: "border border-emerald-300 bg-white text-emerald-700", label: "Return" },
};

function qtyChipClass(n: number): string {
  if (n > 0) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (n < 0) return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function StockMovementsLog({ session, refreshKey = 0, branchId = null }: StockMovementsLogProps) {
  const isManager = roleAtLeast(session.role, "MANAGER");

  const [items, setItems] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true); // skeleton only on the very first load
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sequence guard: only the most recent request may commit its result.
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (branchId) params.set("branchId", branchId); // OWNER scope only — server re-fences via assertTargetBranch
      const res = await fetch(`/api/inventory/movements?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as (MovementsResponse & { error?: string }) | null;
      if (seq !== seqRef.current) return; // a newer request superseded this one
      if (res.status === 403) {
        setForbidden(true);
        setItems([]);
        setError(null);
        return;
      }
      if (!res.ok || !data) {
        throw new Error(data?.error ?? `Failed to load movements (${res.status})`);
      }
      setForbidden(false);
      setError(null);
      setItems(data.items ?? []);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load stock movements");
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [branchId]); // branch scope change → silent refetch (sequence guard drops stale rows)

  useEffect(() => {
    if (!isManager) return; // cashier → quiet notice, no doomed request
    void load();
  }, [isManager, refreshKey, load]);

  if (!isManager || forbidden) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-stone-400" aria-hidden /> Recent stock movements
          </CardTitle>
          <CardDescription className="text-xs">Audited StockAdjustment ledger.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-500">
            <ShieldAlert className="size-4 shrink-0 text-stone-400" aria-hidden />
            Stock movement history requires MANAGER role.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-emerald-700" aria-hidden /> Recent stock movements
        </CardTitle>
        <CardDescription className="text-xs">
          Audited StockAdjustment ledger · buying costs visible to MANAGER+.
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh stock movements"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden /> Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2" aria-label="Loading stock movements">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700" role="alert">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-8 text-center text-sm text-stone-500">
            <History className="size-8 text-stone-300" aria-hidden />
            <p className="font-medium text-stone-600">No stock movements yet</p>
            <p className="text-xs">Restocks, write-offs and sales will appear here.</p>
          </div>
        ) : (
          <ul className="max-h-80 divide-y divide-stone-100 overflow-y-auto" aria-label="Stock movement history">
            {items.map((m) => {
              const style = MOVEMENT_STYLE[m.type] ?? MOVEMENT_STYLE.SALE;
              const Icon = style.icon;
              const qty = Number(m.quantity);
              const note = [m.reason, m.reference].filter(Boolean).join(" · ");
              return (
                <li key={m.id} className="flex items-start gap-3 py-2.5">
                  <span
                    className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-md", style.chip)}
                    aria-hidden
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-stone-800">{m.product.name}</p>
                      <Badge
                        variant="outline"
                        className={cn("shrink-0 justify-center font-mono tabular-nums", qtyChipClass(qty))}
                      >
                        {qty > 0 ? "+" : ""}
                        {formatQty(m.quantity, m.product.unit)}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-stone-500">
                      {m.product.sku} · {style.label}
                      {note ? ` · ${note}` : ""}
                    </p>
                    <p className="text-[11px] text-stone-400">
                      by {m.user.name} · {format(new Date(m.createdAt), "dd MMM HH:mm")}
                      {m.unitCost !== null ? ` · Cost ${formatKES(m.unitCost)}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
