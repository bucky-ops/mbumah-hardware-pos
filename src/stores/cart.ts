import { create } from "zustand";
import { round3 } from "@/lib/format";
import type { CartLine, Product, ReceiptData } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Cart store — single source of truth for the POS terminal.
//
// NOTE: `orderDiscountPct` lives here (not in the original field list) because
// the order-discount input in CartPanel and the totals engine in useCart must
// read the same value, and PaymentDialog sends it to /api/v1/sales/checkout.
//
// Money math happens OUTSIDE this store (useCart → computeCart); the store only
// holds raw lines (qty, unitPrice, discountPct) and UI dialog state.
// ─────────────────────────────────────────────────────────────────────────────

/** A parked cart — F4 parks the active sale so the till can serve the next customer. */
export interface HeldOrder {
  id: string;
  savedAt: number;
  lines: CartLine[];
  customerId: string | null;
}

/** Units sold by weight/length — quantities are rounded to 3 decimals. */
const FRACTIONAL_UOMS = new Set(["KG", "M", "FT"]);

const MAX_HELD_ORDERS = 10;

interface CartState {
  lines: CartLine[];
  heldOrders: HeldOrder[];
  customerId: string | null;
  orderDiscountPct: number;
  /** VAT basis for the current ticket (spec: POS defaults to VAT-INCLUSIVE —
   *  shelf prices already contain the 16%; wholesale quotes may flip to
   *  EXCLUSIVE where VAT is added on top). Flows into computeCart, the
   *  checkout payload and the printed receipt. */
  vatInclusive: boolean;
  lastReceipt: ReceiptData | null;
  paymentDialogOpen: boolean;
  receiptDialogOpen: boolean;
  paymentHint: "CASH" | "MPESA";

  /** Adds a product; merges into the existing line when productId AND discountPct match. */
  addProduct: (p: Product, qty?: number) => void;
  /** Sets quantity (round3 for KG/M/FT); drops the line when the result is ≤ 0. */
  setQty: (lineId: string, qty: number) => void;
  /** Line-level discount %, clamped to 0..50. */
  setLineDiscount: (lineId: string, pct: number) => void;
  removeLine: (lineId: string) => void;
  clearCart: () => void;
  /** Parks the current cart (max 10 held orders, oldest dropped). */
  holdOrder: () => void;
  /** Restores a held cart into the active till and removes it from the park list. */
  resumeOrder: (id: string) => void;
  discardHeld: (id: string) => void;
  setCustomer: (id: string | null) => void;
  setOrderDiscountPct: (pct: number) => void;
  /** Switches the ticket between VAT-inclusive and VAT-exclusive pricing. */
  setVatBasis: (inclusive: boolean) => void;
  /** Opens the payment dialog with the tab hint (F2 → MPESA, F3 → CASH). */
  openPayment: (hint: "CASH" | "MPESA") => void;
  closePayment: () => void;
  setLastReceipt: (receipt: ReceiptData) => void;
  openReceipt: () => void;
  closeReceipt: () => void;
}

export const useCartStore = create<CartState>()((set) => ({
  lines: [],
  heldOrders: [],
  customerId: null,
  orderDiscountPct: 0,
  vatInclusive: true, // spec default: shelf prices are VAT-inclusive
  lastReceipt: null,
  paymentDialogOpen: false,
  receiptDialogOpen: false,
  paymentHint: "CASH",

  addProduct: (p, qty = 1) =>
    set((state) => {
      const addQty = FRACTIONAL_UOMS.has(p.unit) ? round3(qty) : qty;
      // Merge rule: same productId AND same (incoming) discountPct of 0 —
      // a fresh scan never carries a discount, so discounted lines stay separate.
      const idx = state.lines.findIndex((l) => l.productId === p.id && l.discountPct === 0);
      if (idx >= 0) {
        const lines = [...state.lines];
        const existing = lines[idx];
        const merged = FRACTIONAL_UOMS.has(existing.uom)
          ? round3(existing.qty + addQty)
          : existing.qty + addQty;
        lines[idx] = { ...existing, qty: merged };
        return { lines };
      }
      const line: CartLine = {
        lineId: crypto.randomUUID(),
        productId: p.id,
        sku: p.sku,
        description: p.name,
        uom: p.unit,
        qty: addQty > 0 ? addQty : 1,
        unitPrice: Number(p.sellingPrice),
        discountPct: 0,
        isTaxExempt: p.isTaxExempt,
      };
      return { lines: [...state.lines, line] };
    }),

  setQty: (lineId, qty) =>
    set((state) => ({
      lines: state.lines.flatMap((l) => {
        if (l.lineId !== lineId) return [l];
        const next = FRACTIONAL_UOMS.has(l.uom) ? round3(qty) : qty;
        if (next <= 0) return []; // quantity zeroed → remove the line
        return [{ ...l, qty: next }];
      }),
    })),

  setLineDiscount: (lineId, pct) =>
    set((state) => ({
      lines: state.lines.map((l) =>
        l.lineId === lineId ? { ...l, discountPct: Math.min(50, Math.max(0, pct)) } : l
      ),
    })),

  removeLine: (lineId) =>
    set((state) => ({ lines: state.lines.filter((l) => l.lineId !== lineId) })),

  clearCart: () => set({ lines: [], customerId: null, orderDiscountPct: 0 }),

  holdOrder: () =>
    set((state) => {
      if (state.lines.length === 0) return state; // nothing to park
      const held: HeldOrder = {
        id: crypto.randomUUID(),
        savedAt: Date.now(),
        lines: state.lines,
        customerId: state.customerId,
      };
      return {
        heldOrders: [...state.heldOrders, held].slice(-MAX_HELD_ORDERS),
        lines: [],
        customerId: null,
        orderDiscountPct: 0,
      };
    }),

  resumeOrder: (id) =>
    set((state) => {
      const held = state.heldOrders.find((h) => h.id === id);
      if (!held) return state;
      return {
        lines: held.lines,
        customerId: held.customerId,
        heldOrders: state.heldOrders.filter((h) => h.id !== id),
      };
    }),

  discardHeld: (id) =>
    set((state) => ({ heldOrders: state.heldOrders.filter((h) => h.id !== id) })),

  setCustomer: (id) => set({ customerId: id }),

  setOrderDiscountPct: (pct) =>
    set({ orderDiscountPct: Math.min(30, Math.max(0, pct)) }),

  setVatBasis: (inclusive) => set({ vatInclusive: inclusive }),

  openPayment: (hint) => set({ paymentDialogOpen: true, paymentHint: hint }),
  closePayment: () => set({ paymentDialogOpen: false }),
  setLastReceipt: (receipt) => set({ lastReceipt: receipt }),
  openReceipt: () => set({ receiptDialogOpen: true }),
  closeReceipt: () => set({ receiptDialogOpen: false }),
}));
