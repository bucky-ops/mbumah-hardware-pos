"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Loader2, PackagePlus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { roleAtLeast, type Product, type SessionUser } from "@/lib/types";
import { formatKES, formatQty, round3 } from "@/lib/format";

// ─────────────────────────────────────────────────────────────────────────────
// StockAdjustDialog — UI for the Zod-validated /api/inventory/adjust endpoint.
//
//  • INCREMENT → RESTOCK movement; supplying unitCost rolls the Moving Average
//    Cost forward server-side (weightedAverageCost).
//  • DECREMENT → WRITE_OFF movement — requires a reason AND is MANAGER+ only
//    (segregation of duties for stock shrinkage; the route enforces this too).
//  • The projected-stock preview prevents obviously-invalid submissions before
//    they hit the API; the API still re-validates inside a $transaction.
// ─────────────────────────────────────────────────────────────────────────────

export interface StockAdjustDialogProps {
  product: Product | null;
  session: SessionUser;
  onClose: () => void;
  /** Receive the updated product (new stockQty/buyingPrice) after a successful adjust. */
  onAdjusted: (updated: Product) => void;
}

type AdjustType = "INCREMENT" | "DECREMENT";

export function StockAdjustDialog({ product, session, onClose, onAdjusted }: StockAdjustDialogProps) {
  // Parent passes key={product?.id} → the component REMOUNTS per product, so
  // useState initializers below capture the right product with no reset logic.
  const [type, setType] = useState<AdjustType>("INCREMENT");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState(() =>
    product ? String(Math.round(Number(product.buyingPrice))) : ""
  );
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isManager = roleAtLeast(session.role, "MANAGER");
  const qty = Number.parseInt(quantity, 10);
  const validQty = Number.isInteger(qty) && qty > 0;

  const currentStock = useMemo(() => (product ? Number(product.stockQty) : 0), [product]);
  const projected = useMemo(() => {
    if (!product || !validQty) return null;
    const delta = type === "INCREMENT" ? qty : -qty;
    return round3(currentStock + delta);
  }, [product, validQty, qty, type, currentStock]);

  const projectedNegative = projected !== null && projected < 0;
  const reasonMissing = type === "DECREMENT" && reason.trim().length < 3;
  const canSubmit =
    !!product && validQty && !projectedNegative && !reasonMissing && (type === "DECREMENT" || isManager) && !busy;

  const submit = async () => {
    if (!product || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          branchId: product.branchId,
          type,
          quantity: qty,
          ...(type === "INCREMENT" && unitCost ? { unitCost: Number(unitCost) } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Adjustment failed (${res.status})`);
        return;
      }
      onAdjusted({
        ...product,
        stockQty: data.newStockQty,
        ...(type === "INCREMENT" && data.mac ? { buyingPrice: data.mac } : {}),
      });
      toast.success(
        `${product.name}: ${data.newStockQty} ${product.unit} on hand${data.mac ? ` · MAC ${formatKES(data.mac)}` : ""}`
      );
      onClose();
    } catch {
      setError("Network error — adjustment not saved");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!product} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <PackagePlus className="h-4 w-4 text-emerald-700" aria-hidden /> Stock adjustment
          </DialogTitle>
          <DialogDescription className="text-xs">
            Audited movement — every adjustment writes a StockAdjustment row and an audit-log entry.
          </DialogDescription>
        </DialogHeader>

        {product && (
          <div className="space-y-3">
            {/* Product summary strip */}
            <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-emerald-100 text-emerald-800">
                <PackagePlus className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-stone-900">{product.name}</p>
                <p className="truncate text-[11px] text-stone-500">
                  {product.sku} · {product.category} · price {formatKES(product.sellingPrice)}
                </p>
              </div>
              <Badge variant="outline" className="ml-auto shrink-0 font-mono text-xs">
                {formatQty(product.stockQty, product.unit)}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="adj-type">Movement</Label>
                <Select value={type} onValueChange={(v) => setType(v as AdjustType)}>
                  <SelectTrigger id="adj-type" aria-label="Adjustment type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INCREMENT">
                      <span className="flex items-center gap-2">
                        <ArrowDownToLine className="h-3.5 w-3.5 text-emerald-700" aria-hidden /> Restock / return (+)
                      </span>
                    </SelectItem>
                    <SelectItem value="DECREMENT" disabled={!isManager}>
                      <span className="flex items-center gap-2">
                        <ArrowUpFromLine className="h-3.5 w-3.5 text-rose-600" aria-hidden /> Write-off / issue (−)
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adj-qty">Quantity (integer)</Label>
                <Input
                  id="adj-qty"
                  type="number"
                  min={1}
                  step={1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  aria-invalid={!validQty}
                />
              </div>
            </div>

            {type === "INCREMENT" && (
              <div className="space-y-1.5">
                <Label htmlFor="adj-cost">Unit cost (KES) — rolls the moving-average cost</Label>
                <Input
                  id="adj-cost"
                  type="number"
                  min={0}
                  step="0.01"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  placeholder={product.buyingPrice}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="adj-reason">
                Reason {type === "DECREMENT" ? <span className="text-rose-600">(required)</span> : <span className="text-stone-400">(optional)</span>}
              </Label>
              <Input
                id="adj-reason"
                value={reason}
                maxLength={255}
                onChange={(e) => setReason(e.target.value)}
                placeholder={type === "DECREMENT" ? "e.g. Damaged in transit — batch #12" : "e.g. Supplier delivery GRN-2031"}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="adj-ref">Reference document <span className="text-stone-400">(GRN / PO / report no.)</span></Label>
              <Input id="adj-ref" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
            </div>

            {/* Projected stock preview */}
            <div className="flex items-center justify-between rounded-lg border border-dashed border-stone-300 bg-white px-3 py-2 text-sm">
              <span className="text-stone-500">Projected stock on hand</span>
              <span className={`font-mono font-semibold tabular-nums ${projectedNegative ? "text-rose-600" : "text-emerald-700"}`}>
                {projected === null ? "—" : `${projected} ${product.unit}`}
                {projectedNegative ? " (blocked)" : ""}
              </span>
            </div>

            {!isManager && (
              <Alert className="border-amber-200 bg-amber-50">
                <ShieldAlert className="h-4 w-4 text-amber-700" aria-hidden />
                <AlertTitle className="text-xs">Cashier restrictions</AlertTitle>
                <AlertDescription className="text-[11px]">
                  Write-offs require the MANAGER role (segregation of duties). Restocks are allowed.
                </AlertDescription>
              </Alert>
            )}
            {projectedNegative && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">
                  Adjustment would drive stock negative — reduce the quantity or restock first.
                </AlertDescription>
              </Alert>
            )}
            {reasonMissing && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">A reason (min 3 chars) is required for write-offs.</AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}

            <Separator />
            <p className="text-[11px] text-stone-400">
              MAC is recomputed automatically on restock: ((oldQty × oldCost) + (qty × newCost)) ÷ totalQty.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit} className="bg-emerald-700 text-white hover:bg-emerald-800">
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
            Apply adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
