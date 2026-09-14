"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { computeCart } from "@/lib/format";
import { useCartStore } from "@/stores/cart";

// ─────────────────────────────────────────────────────────────────────────────
// Public cart hook (spec Task 2.2) — the ONLY surface POS components should use
// to read/mutate the till.
//
// FINANCIAL FORMULAS — spec LaTeX → code mapping (cart engine; VAT basis is a
// per-ticket flag, POS default INCLUSIVE per spec):
//
//   \text{LineBase}   = \text{UnitPrice} \times \text{Qty}            → computeLine base
//   \text{LineDisc}   = \text{LineBase} \times \frac{d}{100}         → computeLine discount (2dp half-up)
//   \text{LineNet}    = \text{LineBase} - \text{LineDisc}            → computeLine net
//   \text{CartDisc}   = \sum \text{LineNet} \times \frac{o}{100}     → computeCart orderDiscount
//   \text{Subtotal}   = \sum \text{LineNet} - \text{CartDisc}        → totals.netTotal
//   \text{VAT}        = inclusive: Net − Net/1.16 · exclusive: Net × 0.16 → totals.vatAmount
//   \text{GrandTotal} = inclusive: Subtotal · exclusive: Subtotal + VAT   → totals.grandTotal
//
// INVARIANT — DISCOUNTS ARE APPLIED **BEFORE** 16% VAT (KRA eTIMS rule):
// the taxable amount is the DISCOUNTED net, never the gross. Tax-exempt lines
// (isTaxExempt / eTIMS category A) carry VAT = 0. All arithmetic is Decimal.js
// (src/lib/format.ts) with ROUND_HALF_UP at 2dp per line; document totals are
// exact sums of the rounded lines (no per-total re-rounding drift).
// ─────────────────────────────────────────────────────────────────────────────

export function useCart() {
  const lines = useCartStore((s) => s.lines);
  const orderDiscountPct = useCartStore((s) => s.orderDiscountPct);
  const vatInclusive = useCartStore((s) => s.vatInclusive);

  // One engine pass produces BOTH the document totals and the allocated per-line
  // maths (order discount already spread, VAT per the ticket basis) so the cart
  // panel and the printed receipt can never disagree. Index-aligned with `lines`.
  const { totals, lines: mathLines } = useMemo(
    () =>
      computeCart(
        lines.map((l) => ({
          qty: l.qty,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          isTaxExempt: l.isTaxExempt,
          uom: l.uom,
          description: l.description,
        })),
        { orderDiscountPct, vatInclusive }
      ),
    [lines, orderDiscountPct, vatInclusive]
  );

  const heldOrders = useCartStore((s) => s.heldOrders);
  const customerId = useCartStore((s) => s.customerId);

  // Actions — zustand action references are stable across renders.
  const addProduct = useCartStore((s) => s.addProduct);
  const setQty = useCartStore((s) => s.setQty);
  const setLineDiscount = useCartStore((s) => s.setLineDiscount);
  const removeLine = useCartStore((s) => s.removeLine);
  const clearCart = useCartStore((s) => s.clearCart);
  const holdOrder = useCartStore((s) => s.holdOrder);
  const resumeOrder = useCartStore((s) => s.resumeOrder);
  const discardHeld = useCartStore((s) => s.discardHeld);
  const setCustomer = useCartStore((s) => s.setCustomer);
  const setOrderDiscountPct = useCartStore((s) => s.setOrderDiscountPct);
  const setVatBasis = useCartStore((s) => s.setVatBasis);
  const openPayment = useCartStore((s) => s.openPayment);
  const closePayment = useCartStore((s) => s.closePayment);
  const setLastReceipt = useCartStore((s) => s.setLastReceipt);
  const openReceipt = useCartStore((s) => s.openReceipt);
  const closeReceipt = useCartStore((s) => s.closeReceipt);

  return {
    lines,
    mathLines,
    totals,
    vatInclusive,
    heldOrders,
    customerId,
    orderDiscountPct,
    addProduct,
    setQty,
    setLineDiscount,
    removeLine,
    clearCart,
    holdOrder,
    resumeOrder,
    discardHeld,
    setCustomer,
    setOrderDiscountPct,
    setVatBasis,
    openPayment,
    closePayment,
    setLastReceipt,
    openReceipt,
    closeReceipt,
  };
}

/**
 * Generic input-debounce helper (spec Task 2.2 — 150ms barcode intake).
 * The latest `fn` is always invoked with the most recent args after `delay`
 * ms of silence; earlier pending invocations are cancelled. The timer is
 * cleaned up on unmount.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number
): (...args: A) => void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return useCallback(
    (...args: A) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay]
  );
}
