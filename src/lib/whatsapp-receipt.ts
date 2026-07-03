/**
 * WhatsApp Receipt Deep-Link helpers.
 *
 * v1.2.0 Phase 2 — Offline-First POS + WhatsApp Receipts + PWA.
 *
 * This module is 100% client-side. It generates a fully-formatted receipt as
 * plain text and opens `https://wa.me/<phone>?text=<encoded>` in a new tab.
 * WhatsApp renders the message in the customer's chat as a preview the cashier
 * can confirm before tapping Send.
 *
 * Why client-side deep links (not the WhatsApp Business Cloud API)?
 *  1. Zero backend dependency — works offline-first (the deep link opens as
 *     soon as connectivity returns; the receipt text is built from the in-memory
 *     `TransactionItem`).
 *  2. No WhatsApp Business account approval / template approval needed.
 *  3. No per-message cost (WhatsApp Cloud API charges business-initiated
 *     conversations; a user-initiated deep-link chat is free).
 *  4. The cashier can edit the message in WhatsApp before sending — useful for
 *     adding verbal agreed discounts or hand-written notes.
 *
 * The trade-off: the customer must have WhatsApp installed on their phone and
 * the cashier's device is the one that sends (not the business account). For
 * MBUMAH HARDWARE's 5 branches this is the right trade-off — formal WhatsApp
 * Business API integration is queued for v1.3.0 once M-Pesa Daraja go-live is
 * confirmed and we have a verified business number.
 */

import type { TransactionItem, CustomerItem } from "@/lib/api";

/** A minimal store descriptor used to render the receipt header. */
export interface ReceiptStoreInfo {
  id: string;
  shortName: string;
  location?: string;
  phone?: string;
}

/** Options that influence receipt rendering. */
export interface FormatReceiptOptions {
  /** ISO date string or Date for the receipt timestamp. */
  createdAt: string | Date;
  /** Cashier display name (falls back to "Cashier"). */
  cashierName?: string;
  /** For cash sales: the note denomination received (for "Change" line). */
  cashReceived?: number;
  /** For M-Pesa sales: the customer phone used for STK push. */
  mpesaPhone?: string;
  /** Optional gift message appended at the end. */
  thankYouNote?: string;
}

/**
 * Normalize a Kenyan phone number into the international `2547XXXXXXXX` form
 * required by `wa.me`. Returns `null` if the number is not a valid Kenyan
 * mobile (Safaricom/Airtel/Telkom) number.
 *
 * Accepted inputs:
 *   - "0795191909"        → "254795191909"
 *   - "795191909"         → "254795191909"
 *   - "+254795191909"     → "254795191909"
 *   - "254795191909"      → "254795191909"
 *   - "00254795191909"    → "254795191909"  (international dialing prefix 00)
 *   - "0712 345 678"      → "254712345678"  (whitespace stripped)
 *
 * Valid Kenyan mobile prefixes (operator-agnostic):
 *   - 7XX (Safaricom, Airtel, Telkom) — 9 digits after the leading 0/254
 *   - 1XX (Faiba 4G, Sema Mobile)     — 9 digits after the leading 0/254
 */
export function normalizeKenyanPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  // Strip everything that isn't a digit.
  let digits = String(input).replace(/[^\d]/g, "");
  if (!digits) return null;

  // Strip leading international dialing prefix "00" or "000".
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Strip leading "+" (already removed by the regex, but kept for clarity).

  // Strip leading country code "254" if present (with or without a leading 0).
  if (digits.startsWith("254")) {
    digits = digits.slice(3);
  } else if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  // After stripping, we should have exactly 9 digits starting with 7 or 1.
  if (digits.length !== 9) return null;
  if (!digits.startsWith("7") && !digits.startsWith("1")) return null;

  return `254${digits}`;
}

/**
 * Pretty-print a normalized (or un-normalized) Kenyan phone for human display.
 * Returns the original input if it can't be normalized.
 *
 *   "254795191909" → "+254 795 191 909"
 *   "0795191909"   → "+254 795 191 909"
 */
export function formatKenyanPhone(input: string | null | undefined): string {
  const normalized = normalizeKenyanPhone(input);
  if (!normalized) return input ?? "";
  // Slice into 3-3-3 groups after the leading "7" or "1" kept with the first group.
  // e.g. "254795191909" → "795" "191" "909"
  const local = normalized.slice(3); // "795191909"
  const a = local.slice(0, 3);
  const b = local.slice(3, 6);
  const c = local.slice(6, 9);
  return `+254 ${a} ${b} ${c}`;
}

/**
 * Build the full multi-line WhatsApp receipt message body. Designed to look
 * clean inside WhatsApp's chat bubble (monospace would not render in WhatsApp,
 * so we use emoji + plain-text alignment with spaces — WhatsApp preserves
 * leading spaces inside a message).
 *
 * The message includes:
 *  - Store header (logo emoji + name + branch + location)
 *  - Receipt #, date, cashier, customer
 *  - Line items (name, qty x unit, line total)
 *  - Subtotal, VAT, discount, grand total
 *  - Payment method + cash/M-Pesa details + change
 *  - Thank-you footer
 */
export function formatWhatsAppReceipt(
  transaction: TransactionItem,
  store: ReceiptStoreInfo | undefined | null,
  options: FormatReceiptOptions,
): string {
  const lines: string[] = [];

  // ── Store header ────────────────────────────────────────────────────────
  lines.push("🛠️ *MBUMAH HARDWARE*");
  if (store?.shortName) lines.push(`📍 ${store.shortName} Branch`);
  if (store?.location) lines.push(`   ${store.location}`);
  if (store?.phone) lines.push(`   Tel: ${formatKenyanPhone(store.phone) || store.phone}`);
  lines.push("━━━━━━━━━━━━━━━━━━━━");

  // ── Receipt meta ────────────────────────────────────────────────────────
  lines.push(`🧾 Receipt: *${transaction.receiptNumber}*`);
  const dateStr =
    typeof options.createdAt === "string"
      ? new Date(options.createdAt).toLocaleString("en-KE", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Africa/Nairobi",
        })
      : options.createdAt.toLocaleString("en-KE", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Africa/Nairobi",
        });
  lines.push(`📅 ${dateStr}`);
  lines.push(`👤 Cashier: ${options.cashierName || "Cashier"}`);
  const customerName = transaction.customer?.name || (transaction as { customerName?: string }).customerName || "Walk-in";
  lines.push(`🧍 Customer: ${customerName}`);
  lines.push("━━━━━━━━━━━━━━━━━━━━");

  // ── Line items ──────────────────────────────────────────────────────────
  lines.push("🛒 *Items*");
  const items = transaction.items ?? [];
  for (const item of items) {
    // Cap product name at 28 chars to keep single-line layout.
    const name =
      item.productName.length > 28
        ? `${item.productName.slice(0, 27)}…`
        : item.productName;
    const qtyUnit = `${item.quantity} ${item.unitType}`;
    const total = formatKESCompact(item.lineTotal);
    lines.push(`• ${name}`);
    lines.push(`   ${qtyUnit} × ${formatKESCompact(item.pricePerUnit)} = ${total}`);
  }
  lines.push("━━━━━━━━━━━━━━━━━━━━");

  // ── Totals ──────────────────────────────────────────────────────────────
  lines.push("💵 *Payment Summary*");
  lines.push(`Subtotal: ${formatKESCompact(transaction.subtotal)}`);
  lines.push(`VAT (16%): ${formatKESCompact(transaction.taxAmount)}`);
  if (transaction.discountAmount > 0) {
    lines.push(`Discount: -${formatKESCompact(transaction.discountAmount)}`);
  }
  lines.push(`*TOTAL: ${formatKESCompact(transaction.totalAmount)}*`);
  lines.push("━━━━━━━━━━━━━━━━━━━━");

  // ── Payment details ─────────────────────────────────────────────────────
  const pm = transaction.paymentMethod?.toUpperCase() ?? "CASH";
  const methodLabel =
    pm === "MPESA" ? "📱 M-Pesa" : pm === "CASH" ? "💵 Cash" : pm === "DEBT" ? "🤝 On Credit" : `💳 ${pm}`;
  lines.push(`Payment: ${methodLabel}`);

  if (pm === "CASH" && options.cashReceived && options.cashReceived > 0) {
    lines.push(`Cash Received: ${formatKESCompact(options.cashReceived)}`);
    const change = options.cashReceived - transaction.totalAmount;
    if (change > 0) {
      lines.push(`*Change: ${formatKESCompact(change)}*`);
    }
  }
  if (pm === "MPESA" && options.mpesaPhone) {
    lines.push(`M-Pesa Phone: ${formatKenyanPhone(options.mpesaPhone) || options.mpesaPhone}`);
  }

  lines.push("━━━━━━━━━━━━━━━━━━━━");

  // ── Footer ──────────────────────────────────────────────────────────────
  lines.push("🙏 *Thank you for shopping with us!*");
  lines.push(options.thankYouNote || "Asante sana! Karibu tena.");
  if (store?.phone) {
    lines.push(`📞 For enquiries: ${formatKenyanPhone(store.phone) || store.phone}`);
  }
  lines.push("—");
  lines.push("_Powered by MBUMAH HARDWARE POS_");

  return lines.join("\n");
}

/**
 * Build the final `https://wa.me/<phone>?text=<encoded>` URL.
 * Returns `null` if the phone is not a valid Kenyan mobile.
 */
export function buildWhatsAppDeepLink(
  phone: string | null | undefined,
  message: string,
): string | null {
  const normalized = normalizeKenyanPhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/**
 * One-shot helper: build the deep link for a transaction receipt.
 * Returns `{ url, message, phone }` so the caller can:
 *   - open `url` in a new tab, AND
 *   - show a preview of `message` to the cashier before they confirm.
 */
export function buildReceiptDeepLink(
  transaction: TransactionItem,
  store: ReceiptStoreInfo | undefined | null,
  phone: string | null | undefined,
  options: FormatReceiptOptions,
): { url: string | null; message: string; phone: string | null } {
  const message = formatWhatsAppReceipt(transaction, store, options);
  const normalizedPhone = normalizeKenyanPhone(phone);
  const url = buildWhatsAppDeepLink(normalizedPhone, message);
  return { url, message, phone: normalizedPhone };
}

/**
 * Resolve the best customer phone to use for the receipt.
 * Priority: explicit `phone` arg → transaction.customer.phone → transaction
 * metadata (mpesaPhone) → null.
 */
export function resolveReceiptPhone(
  transaction: TransactionItem,
  customer: CustomerItem | null | undefined,
  fallbackPhone?: string | null,
): string | null {
  return (
    normalizeKenyanPhone(customer?.phone) ||
    normalizeKenyanPhone((transaction as { customerPhone?: string | null }).customerPhone) ||
    normalizeKenyanPhone(fallbackPhone) ||
    null
  );
}

// ── Internal helpers ──────────────────────────────────────────────────────

/**
 * Compact KES formatter for WhatsApp — drops the "KES" prefix (we add 💵 emoji
 * on the totals line) and uses thousands separators. Two decimal places only
 * when needed.
 *
 *   1250      → "1,250"
 *   1250.5    → "1,250.50"
 *   1250.00   → "1,250"
 *   0         → "0"
 */
function formatKESCompact(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  const rounded = Math.round(amount * 100) / 100;
  const hasFraction = rounded % 1 !== 0;
  return new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rounded);
}
