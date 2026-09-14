"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, Landmark, Loader2, Smartphone, TriangleAlert, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useCart } from "@/hooks/useCart";
import { useCartStore } from "@/stores/cart";
import { changeDue, formatKES } from "@/lib/format";
import { enqueuePendingOrder } from "@/lib/offline/orderQueue";
import type { PaymentMethod, ReceiptData } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MPesaCheckoutModal } from "@/components/pos/MPesaCheckoutModal";

// ─────────────────────────────────────────────────────────────────────────────
// PaymentDialog — store-driven checkout modal (paymentDialogOpen).
//
// TABS: CASH · MPESA · BANK_TRANSFER · STORE_CREDIT
//  • Cash: tendered input + quick chips, live change (changeDue).
//  • M-Pesa: embeds MPesaCheckoutModal against a client-generated ref; onPaid
//    auto-submits the sale with an MPESA payment row (receipt as reference).
//  • Bank transfer: free-text reference.
//  • STORE_CREDIT: requires a customer; client-side pre-check of available
//    credit (server re-validates atomically inside the checkout transaction).
//
// OFFLINE: network failure (or navigator.onLine false) → the order is queued
// in the Dexie offline queue and auto-syncs later (same clientRef becomes a
// stable sync idempotency key).
// ─────────────────────────────────────────────────────────────────────────────

type TabValue = "CASH" | "MPESA" | "BANK_TRANSFER" | "STORE_CREDIT";

interface PaymentDialogProps {
  customers?: Array<{ id: string; name: string; currentBalance: string; creditLimit: string; kraPin?: string | null }>;
}

interface CheckoutResponse {
  transaction: { id: string; ref: string; status: string; totalAmount: string; balanceDue: string };
  receipt: ReceiptData;
}

export function PaymentDialog({ customers = [] }: PaymentDialogProps) {
  const paymentDialogOpen = useCartStore((s) => s.paymentDialogOpen);
  const paymentHint = useCartStore((s) => s.paymentHint);
  const { lines, totals, vatInclusive, customerId, orderDiscountPct, clearCart, closePayment, setLastReceipt, openReceipt } = useCart();

  const [tab, setTab] = useState<TabValue>("CASH");
  const [clientRef, setClientRef] = useState("");
  const [tendered, setTendered] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const total = totals.grandTotal;

  // Fresh idempotency ref + tab hint on every open (spec: generate upfront).
  useEffect(() => {
    if (paymentDialogOpen) {
      setClientRef(crypto.randomUUID());
      setTab(paymentHint);
      setTendered("");
      setBankRef("");
      setSubmitting(false);
    }
  }, [paymentDialogOpen, paymentHint]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId]
  );
  const creditAvailable = selectedCustomer
    ? Math.max(0, Number(selectedCustomer.creditLimit) - Number(selectedCustomer.currentBalance))
    : 0;
  const creditShort = !!selectedCustomer && creditAvailable + 0.005 < total;

  const cashAmount = Number(tendered) || 0;
  const change = changeDue(cashAmount, total);

  async function submit(payments: Array<{ method: PaymentMethod; amount: number; reference?: string }>) {
    if (submitting || lines.length === 0 || !clientRef) return;
    setSubmitting(true);
    const payload = {
      items: lines.map((l) => ({ productId: l.productId, qty: l.qty, discountPct: l.discountPct })),
      payments,
      customerId: customerId ?? undefined,
      orderDiscountPct,
      vatInclusive, // per-ticket basis from the cart store (server recomputes authoritatively)
    };
    try {
      const res = await fetch("/api/v1/sales/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": clientRef },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `Checkout failed (HTTP ${res.status})`);
      }
      const data = (await res.json()) as CheckoutResponse;
      setLastReceipt(data.receipt);
      closePayment();
      openReceipt();
      clearCart();
      toast.success(`Sale ${data.transaction.ref} completed`);
    } catch (err) {
      // Offline (or the request never left) → queue for the auto-sync flush.
      // TypeError is what fetch throws on network failure / DNS / refused.
      if (!navigator.onLine || err instanceof TypeError) {
        try {
          await enqueuePendingOrder({
            id: clientRef,
            payload,
            label: `${lines.length} items · ${formatKES(total)}`,
            attempts: 0,
            createdAt: Date.now(),
          });
          toast.info("Saved offline — will auto-sync");
          closePayment();
          clearCart();
        } catch {
          toast.error("Device offline and local queue unavailable — sale NOT saved");
        }
      } else {
        toast.error(err instanceof Error ? err.message : "Checkout failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={paymentDialogOpen} onOpenChange={(open) => !open && closePayment()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between pr-6">
            <span>Take payment</span>
            <Badge variant="outline" className="font-mono text-emerald-700 dark:text-emerald-400">
              {formatKES(total)}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {lines.length} line{lines.length === 1 ? "" : "s"} · ref {clientRef.slice(0, 8)}…
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="CASH" className="gap-1">
              <Banknote className="h-3.5 w-3.5" /> Cash
            </TabsTrigger>
            <TabsTrigger value="MPESA" className="gap-1">
              <Smartphone className="h-3.5 w-3.5" /> M-Pesa
            </TabsTrigger>
            <TabsTrigger value="BANK_TRANSFER" className="gap-1">
              <Landmark className="h-3.5 w-3.5" /> Bank
            </TabsTrigger>
            <TabsTrigger value="STORE_CREDIT" className="gap-1">
              <Wallet className="h-3.5 w-3.5" /> Credit
            </TabsTrigger>
          </TabsList>

          {/* ── CASH ─────────────────────────────────────────────────────── */}
          <TabsContent value="CASH" className="grid gap-3 pt-2">
            <div className="flex items-center justify-between rounded-md bg-stone-50 px-3 py-2 text-sm dark:bg-stone-900/60">
              <span className="text-stone-600 dark:text-stone-500">Amount due</span>
              <span className="font-bold text-stone-900 dark:text-stone-50">{formatKES(total)}</span>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tendered">Cash tendered</Label>
              <Input
                id="tendered"
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                autoFocus
              />
              <div className="flex gap-1.5">
                {[total, 500, 1000].map((chip, i) => (
                  <Button
                    key={`${chip}-${i}`}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    onClick={() => setTendered(String(chip))}
                  >
                    {i === 0 ? "Exact" : formatKES(chip)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
              <span className="text-emerald-800 dark:text-emerald-300">Change</span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400">{formatKES(change)}</span>
            </div>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700 dark:hover:bg-emerald-500"
              disabled={submitting || cashAmount <= 0}
              onClick={() => void submit([{ method: "CASH", amount: Math.min(cashAmount, total) }])}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm cash payment
            </Button>
          </TabsContent>

          {/* ── MPESA ────────────────────────────────────────────────────── */}
          <TabsContent value="MPESA" className="pt-2">
            {clientRef && (
              <MPesaCheckoutModal
                key={clientRef}
                amount={total}
                ref={clientRef}
                customerPhone={undefined}
                onPaid={(receiptNo) => {
                  toast.success(`M-Pesa confirmed — receipt ${receiptNo}`);
                  void submit([{ method: "MPESA", amount: total, reference: receiptNo }]);
                }}
                onFailed={(desc) => toast.error(desc)}
                onCancel={() => closePayment()}
              />
            )}
          </TabsContent>

          {/* ── BANK_TRANSFER ────────────────────────────────────────────── */}
          <TabsContent value="BANK_TRANSFER" className="grid gap-3 pt-2">
            <div className="grid gap-1.5">
              <Label htmlFor="bank-ref">Transfer reference</Label>
              <Input
                id="bank-ref"
                placeholder="e.g. FT2219HJ88K"
                maxLength={100}
                value={bankRef}
                onChange={(e) => setBankRef(e.target.value)}
                autoFocus
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between text-sm">
              <span className="text-stone-600 dark:text-stone-500">Amount to book</span>
              <span className="font-bold text-stone-900 dark:text-stone-50">{formatKES(total)}</span>
            </div>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700 dark:hover:bg-emerald-500"
              disabled={submitting}
              onClick={() => void submit([{ method: "BANK_TRANSFER", amount: total, reference: bankRef || undefined }])}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record bank transfer
            </Button>
          </TabsContent>

          {/* ── STORE_CREDIT ─────────────────────────────────────────────── */}
          <TabsContent value="STORE_CREDIT" className="grid gap-3 pt-2">
            {!customerId || !selectedCustomer ? (
              <Alert className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50">
                <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <AlertTitle className="text-amber-800 dark:text-amber-400">Customer required</AlertTitle>
                <AlertDescription className="text-amber-700 dark:text-amber-400">
                  Pick a customer on the cart first — store credit charges against their account.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="rounded-md border border-stone-200 px-3 py-2 text-sm dark:border-stone-800">
                  <p className="font-medium text-stone-800 dark:text-stone-200">{selectedCustomer.name}</p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Balance {formatKES(selectedCustomer.currentBalance)} · Limit {formatKES(selectedCustomer.creditLimit)}
                    {selectedCustomer.kraPin ? ` · PIN ${selectedCustomer.kraPin}` : ""}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md bg-stone-50 px-3 py-2 dark:bg-stone-900/60">
                    <p className="text-xs text-stone-500 dark:text-stone-400">Available credit</p>
                    <p className="font-bold text-stone-900 dark:text-stone-50">{formatKES(creditAvailable)}</p>
                  </div>
                  <div className="rounded-md bg-stone-50 px-3 py-2 dark:bg-stone-900/60">
                    <p className="text-xs text-stone-500 dark:text-stone-400">Remaining due</p>
                    <p className="font-bold text-stone-900 dark:text-stone-50">{formatKES(total)}</p>
                  </div>
                </div>
                {creditShort && (
                  <Alert className="border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/50">
                    <TriangleAlert className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                    <AlertTitle className="text-rose-800 dark:text-rose-400">Credit limit exceeded</AlertTitle>
                    <AlertDescription className="text-rose-700 dark:text-rose-400">
                      Available {formatKES(creditAvailable)} is short of the {formatKES(total)} due. Reduce the ticket or
                      collect cash first — the server re-validates atomically either way.
                    </AlertDescription>
                  </Alert>
                )}
                <Button
                  className="bg-emerald-600 text-white hover:bg-emerald-700 dark:hover:bg-emerald-500"
                  disabled={submitting || creditShort}
                  onClick={() => void submit([{ method: "STORE_CREDIT", amount: total }])}
                >
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Charge to store credit
                </Button>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
