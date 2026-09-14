"use client";

import { useEffect, useRef, useState } from "react";
import { Banknote, Minus, Pause, Plus, ScanLine, Smartphone, Trash2, User, X } from "lucide-react";
import { toast } from "sonner";
import { useCart, useDebouncedCallback } from "@/hooks/useCart";
import { useCartStore } from "@/stores/cart";
import { formatKES, formatQty } from "@/lib/format";
import { roleAtLeast, type CartLine, type Product, type SessionUser } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

// ─────────────────────────────────────────────────────────────────────────────
// CartPanel — the till: scan/search intake, editable lines, financial totals
// (discounts BEFORE 16% VAT), customer picker, held-order chips and the
// Hold / M-Pesa / Cash action bar with F4/F2/F3 hotkeys.
// ─────────────────────────────────────────────────────────────────────────────

const SCAN_DEBOUNCE_MS = 150; // spec: 150ms barcode intake debounce
const BULK_SCAN_WINDOW_MS = 1_500; // identical SKU within 1.5s → increment, not duplicate

// Module-level (survives re-renders, shared per browser tab): last accepted scan.
let lastScan: { sku: string; at: number } | null = null;

export interface CustomerSummary {
  id: string;
  name: string;
  currentBalance: string;
  creditLimit: string;
  kraPin?: string | null;
}

interface CartPanelProps {
  products: Product[];
  customers: CustomerSummary[];
  session: SessionUser;
}

/** Fractional-qty input. Uncontrolled + commit-on-blur so typing never fights
 *  the store; the parent's key remounts it when qty changes externally (steppers,
 *  bulk-scan merges) so the displayed value always matches the cart. */
function QtyInput({ line, onQty }: { line: CartLine; onQty: (qty: number) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fractional = line.uom === "KG" || line.uom === "M" || line.uom === "FT";
  const commit = () => {
    const el = inputRef.current;
    if (!el) return;
    const n = Number(el.value);
    if (el.value !== "" && Number.isFinite(n)) onQty(n);
    else el.value = String(line.qty); // emptied → restore current qty
  };
  return (
    <Input
      ref={inputRef}
      type="number"
      min={0}
      step={fractional ? "0.001" : "1"}
      defaultValue={String(line.qty)}
      className="h-7 w-20 px-2 text-xs"
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      aria-label={`Quantity for ${line.description}`}
    />
  );
}

/** Line discount % — uncontrolled, clamped to 0..50 on commit (server re-clamps). */
function DiscountInput({ value, onDiscount }: { value: number; onDiscount: (pct: number) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const commit = () => {
    const el = inputRef.current;
    if (!el) return;
    const n = Number(el.value);
    if (el.value === "" || !Number.isFinite(n)) {
      el.value = "";
      onDiscount(0);
      return;
    }
    const clamped = Math.min(50, Math.max(0, Math.round(n)));
    el.value = clamped ? String(clamped) : "";
    onDiscount(clamped);
  };
  return (
    <Input
      ref={inputRef}
      type="number"
      min={0}
      max={50}
      step="1"
      placeholder="0"
      defaultValue={value ? String(value) : ""}
      className="h-7 w-14 px-2 text-xs"
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      aria-label="Line discount percent"
    />
  );
}

export function CartPanel({ products, customers, session }: CartPanelProps) {
  const {
    lines,
    mathLines,
    totals,
    vatInclusive,
    heldOrders,
    customerId,
    addProduct,
    setQty,
    setLineDiscount,
    removeLine,
    holdOrder,
    resumeOrder,
    discardHeld,
    setCustomer,
    orderDiscountPct,
    setOrderDiscountPct,
    setVatBasis,
    openPayment,
  } = useCart();

  const [scanValue, setScanValue] = useState("");
  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  // ── Scan/search intake ─────────────────────────────────────────────────────
  const processScan = (raw: string, fromEnter: boolean) => {
    const value = raw.trim();
    if (!value) return;
    const lower = value.toLowerCase();
    const product =
      products.find((p) => p.barcode === value) ??
      products.find((p) => p.sku.toLowerCase() === lower) ??
      // prefix name search only on explicit Enter (never mid-typing)
      (fromEnter ? products.find((p) => p.name.toLowerCase().startsWith(lower)) : undefined);

    if (!product) {
      if (fromEnter) toast.error(`No product matches “${value}”`);
      return;
    }

    // BULK-SCAN MERGE: the same SKU re-scanned within 1.5s increments the
    // existing line's qty (regardless of its discount) instead of spawning a
    // duplicate line — cashiers rip-scanning 12 identical items get qty 12.
    const now = Date.now();
    const repeatScan = !!lastScan && lastScan.sku === product.sku && now - lastScan.at < BULK_SCAN_WINDOW_MS;
    lastScan = { sku: product.sku, at: now };
    if (repeatScan) {
      const existing = lines.find((l) => l.productId === product.id);
      if (existing) setQty(existing.lineId, existing.qty + 1);
      else addProduct(product, 1);
    } else {
      addProduct(product, 1);
    }
    setScanValue("");
  };

  const debouncedScan = useDebouncedCallback((raw: string, fromEnter: boolean) => processScan(raw, fromEnter), SCAN_DEBOUNCE_MS);

  // ── F2 / F3 / F4 hotkeys ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useCartStore.getState();
      if (st.paymentDialogOpen || st.receiptDialogOpen) return;
      if (e.key === "F2") {
        e.preventDefault();
        openPayment("MPESA");
      } else if (e.key === "F3") {
        e.preventDefault();
        openPayment("CASH");
      } else if (e.key === "F4") {
        e.preventDefault();
        holdOrder();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPayment, holdOrder]);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Scan / search */}
      <div className="relative">
        <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
        <Input
          data-hotkey-target="scan"
          placeholder="Scan barcode or search SKU… (Enter to add)"
          className="pl-9"
          value={scanValue}
          onChange={(e) => {
            setScanValue(e.target.value);
            debouncedScan(e.target.value, false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              debouncedScan(scanValue, true);
            }
          }}
        />
      </div>

      {/* Held-order chips */}
      {heldOrders.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {heldOrders.map((h) => (
            <Badge
              key={h.id}
              variant="outline"
              className="cursor-pointer border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900/60"
              onClick={() => resumeOrder(h.id)}
            >
              <Pause className="mr-1 h-3 w-3" />
              {new Date(h.savedAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })} · {h.lines.length} items
              <span
                role="button"
                tabIndex={0}
                className="ml-1.5 rounded-full p-0.5 hover:bg-amber-200 dark:hover:bg-amber-900"
                onClick={(e) => {
                  e.stopPropagation();
                  discardHeld(h.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    discardHeld(h.id);
                  }
                }}
                aria-label="Discard held order"
              >
                <X className="h-3 w-3" />
              </span>
            </Badge>
          ))}
        </div>
      )}

      {/* Lines */}
      <ScrollArea className="min-h-0 flex-1 rounded-md border border-stone-200 dark:border-stone-800">
        {lines.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-stone-400 dark:text-stone-500">
            <ScanLine className="h-6 w-6" />
            Cart empty — scan or search to add items
          </div>
        ) : (
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            {lines.map((line, index) => {
              // Allocated per-line maths straight from the engine (order-discount
              // share already spread, VAT per the ticket basis) — index-aligned
              // with the store lines, so the on-screen line can never disagree
              // with the totals block or the printed receipt.
              const lineTotal = mathLines[index]?.total ?? 0;
              return (
                <div key={line.lineId} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-stone-800 dark:text-stone-200">{line.description}</p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-stone-500 dark:text-stone-400">
                          {line.sku}
                        </Badge>
                        {line.isTaxExempt && (
                          <Badge variant="outline" className="h-4 border-amber-300 px-1.5 text-[10px] text-amber-700 dark:border-amber-800 dark:text-amber-400">
                            Exempt
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-stone-400 hover:text-rose-600 dark:text-stone-500 dark:hover:text-rose-400"
                      onClick={() => removeLine(line.lineId)}
                      aria-label={`Remove ${line.description}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setQty(line.lineId, line.qty - 1)}
                        aria-label="Decrease quantity"
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <QtyInput key={`${line.lineId}:${line.qty}`} line={line} onQty={(q) => setQty(line.lineId, q)} />
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setQty(line.lineId, line.qty + 1)}
                        aria-label="Increase quantity"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <span className="w-14 text-[11px] text-stone-500 dark:text-stone-400">{formatQty(line.qty, line.uom)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <DiscountInput value={line.discountPct} onDiscount={(pct) => setLineDiscount(line.lineId, pct)} />
                      <span className="text-[11px] text-stone-500 dark:text-stone-400">% off</span>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">{formatKES(lineTotal)}</p>
                      <p className="text-[11px] text-stone-500 dark:text-stone-400">{formatKES(line.unitPrice)} / {line.uom}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Totals — exact spec formula order: discounts BEFORE 16% VAT.
          Reconciliation: Gross − Line discounts − Order discount = NET. */}
      <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm dark:border-stone-800 dark:bg-stone-900/60">
        {/* VAT basis — MANAGER+ can flip the ticket between inclusive shelf
            pricing (spec default) and exclusive wholesale quoting. */}
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">VAT basis</span>
          {roleAtLeast(session.role, "MANAGER") ? (
            <div
              className="flex rounded-md border border-stone-200 bg-white p-0.5 shadow-sm dark:border-stone-700 dark:bg-stone-800"
              role="radiogroup"
              aria-label="VAT basis for this ticket"
            >
              <button
                type="button"
                role="radio"
                aria-checked={vatInclusive}
                onClick={() => setVatBasis(true)}
                className={`rounded-[5px] px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  vatInclusive ? "bg-emerald-600 text-white shadow-sm dark:bg-emerald-500" : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
                }`}
              >
                Inclusive
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!vatInclusive}
                onClick={() => setVatBasis(false)}
                className={`rounded-[5px] px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  !vatInclusive ? "bg-emerald-600 text-white shadow-sm dark:bg-emerald-500" : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
                }`}
              >
                Exclusive
              </button>
            </div>
          ) : (
            <Badge variant="outline" className="h-4 border-stone-300 px-1.5 text-[9px] uppercase text-stone-500 dark:border-stone-700 dark:text-stone-400">
              {vatInclusive ? "VAT-inclusive" : "VAT-exclusive"}
            </Badge>
          )}
        </div>
        <div className="flex justify-between text-stone-600 dark:text-stone-500">
          <span>Gross</span>
          <span>{formatKES(totals.grossSubtotal)}</span>
        </div>
        {totals.lineDiscounts > 0 && (
          <div className="flex justify-between text-rose-600 dark:text-rose-400">
            <span>Line discounts</span>
            <span>−{formatKES(totals.lineDiscounts)}</span>
          </div>
        )}
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-stone-600 dark:text-stone-500">
            <span>Order discount</span>
            <Input
              type="number"
              min={0}
              max={30}
              step="1"
              placeholder="0"
              className="h-6 w-14 px-2 text-xs"
              value={orderDiscountPct || ""}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (e.target.value === "") setOrderDiscountPct(0);
                else if (Number.isFinite(n)) setOrderDiscountPct(Math.min(30, Math.max(0, n)));
              }}
              aria-label="Order discount percent"
            />
            <span className="text-xs text-stone-500 dark:text-stone-400">%</span>
          </div>
          {totals.orderDiscount > 0 && <span className="text-rose-600 dark:text-rose-400">−{formatKES(totals.orderDiscount)}</span>}
        </div>
        <Separator className="my-2" />
        <div className="flex justify-between font-medium text-stone-700 dark:text-stone-300">
          <span>{vatInclusive ? "NET (incl. VAT)" : "NET (pre-VAT)"}</span>
          <span>{formatKES(totals.netTotal)}</span>
        </div>
        <div className="flex justify-between text-stone-600 dark:text-stone-500">
          <span>VAT 16%{vatInclusive ? " (incl.)" : ""}</span>
          <span>{formatKES(totals.vatAmount)}</span>
        </div>
        <Separator className="my-2" />
        <div className="flex justify-between text-base font-bold text-stone-900 dark:text-stone-50">
          <span>TOTAL</span>
          <span className="text-emerald-700 dark:text-emerald-400">{formatKES(totals.grandTotal)}</span>
        </div>
        {vatInclusive && totals.vatAmount > 0 && (
          <p className="mt-0.5 text-right text-[10px] text-stone-400 dark:text-stone-500">
            shelf price · includes 16% VAT ({formatKES(totals.vatAmount)})
          </p>
        )}
      </div>

      {/* Customer */}
      <div className="grid gap-1.5">
        <Label className="text-xs text-stone-500 dark:text-stone-400">Customer</Label>
        <Select value={customerId ?? "walk-in"} onValueChange={(v) => setCustomer(v === "walk-in" ? null : v)}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Walk-in customer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="walk-in">
              <span className="flex items-center gap-2">
                <User className="h-3.5 w-3.5" /> Walk-in customer
              </span>
            </SelectItem>
            {customers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="flex flex-col">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-stone-500 dark:text-stone-400">
                    Bal {formatKES(c.currentBalance)} · Limit {formatKES(c.creditLimit)}
                    {c.kraPin ? ` · PIN ${c.kraPin}` : ""}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedCustomer && (
          <p className="text-[11px] text-stone-500 dark:text-stone-400">
            Available credit:{" "}
            <span className="font-medium text-stone-700 dark:text-stone-300">
              {formatKES(Math.max(0, Number(selectedCustomer.creditLimit) - Number(selectedCustomer.currentBalance)))}
            </span>
            {selectedCustomer.kraPin ? ` · KRA PIN ${selectedCustomer.kraPin}` : " · no KRA PIN on file"}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <Button variant="ghost" className="border border-stone-200 dark:border-stone-800" onClick={() => holdOrder()} disabled={lines.length === 0}>
          <Pause className="mr-2 h-4 w-4" /> Hold (F4)
        </Button>
        <Button variant="outline" onClick={() => openPayment("CASH")} disabled={lines.length === 0}>
          <Banknote className="mr-2 h-4 w-4" /> Cash (F3)
        </Button>
        <Button
          className="col-span-2 bg-emerald-600 text-white hover:bg-emerald-700 dark:hover:bg-emerald-500"
          onClick={() => openPayment("MPESA")}
          disabled={lines.length === 0}
        >
          <Smartphone className="mr-2 h-4 w-4" /> M-Pesa (F2)
        </Button>
      </div>
      <p className="text-center text-[11px] text-stone-400 dark:text-stone-500">
        Cashier: {session.name} · {session.branchName ?? session.branchId}
      </p>
    </div>
  );
}
