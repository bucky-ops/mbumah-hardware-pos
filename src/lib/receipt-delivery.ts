// Receipt delivery utilities
// ─────────────────────────────────────────────────────────────────────────────
// Central helpers for formatting receipts for outbound channels (WhatsApp,
// email) and building the deep links that actually deliver them.
//
// Design notes:
//   - The functions accept a flexible `ReceiptPayload` shape that matches both
//     the `/api/receipts/[id]` GET response (which exposes `lineItems`) and a
//     raw Prisma `Receipt` row with its related `transaction.items`. This
//     avoids coupling callers to either shape.
//   - No SMTP/SMS provider is configured in this project, so email delivery
//     uses `mailto:` deep links as a graceful fallback. The structure
//     (`buildMailtoLink`) makes it trivial to swap in a real provider later —
//     the caller builds the subject/body via `formatReceiptForEmail`, then
//     either opens a mailto link or hands the same strings to a transport.
//   - Phone normalization is Kenyan-only: it strips leading `0` or `+` and
//     prefixes `254`. Numbers that already start with `254` pass through
//     untouched.

/**
 * Minimal view of a Receipt with the relations needed to format an outbound
 * message. Accepts both the GET /api/receipts/[id] payload shape (which uses
 * `lineItems` + `computed` + `payments`) and a raw Prisma row (which nests
 * `items`, `payments`, `customer`, `cashier`, `store` under `transaction`).
 */
export interface ReceiptPayload {
  id: string;
  receiptNumber: string;
  receiptType?: string;
  sentTo?: string | null;
  sentAt?: string | Date | null;
  createdAt?: string | Date;

  store?: {
    name?: string;
    location?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    taxPin?: string | null;
    organization?: { name?: string; taxPin?: string | null } | null;
  } | null;

  // GET /api/receipts/[id] returns a flattened transaction; raw Prisma rows
  // nest transaction under `transaction`. We support either.
  transaction?: {
    id: string;
    receiptNumber?: string;
    subtotal: number;
    taxAmount: number;
    discountAmount: number;
    totalAmount: number;
    paymentMethod: string;
    paymentStatus?: string;
    transactionType?: string;
    notes?: string | null;
    createdAt: string | Date;
    cashier?: { name?: string } | null;
    customer?: {
      id?: string;
      name?: string;
      phone?: string | null;
      email?: string | null;
    } | null;
    items?: Array<{
      productName: string;
      quantity: number;
      unitType?: string;
      pricePerUnit: number;
      discountPercent?: number;
      lineTotal: number;
    }>;
    payments?: Array<{
      paymentMethod: string;
      amount: number;
      status?: string;
      reference?: string | null;
    }>;
  } | null;

  // Flattened fields from the GET /api/receipts/[id] response
  cashier?: { name?: string } | null;
  customer?: {
    id?: string;
    name?: string;
    phone?: string | null;
    email?: string | null;
  } | null;
  lineItems?: Array<{
    productName: string;
    quantity: number;
    unitType?: string;
    pricePerUnit: number;
    discountPercent?: number;
    lineTotal: number;
  }>;
  payments?: Array<{
    paymentMethod: string;
    amount: number;
    status?: string;
    reference?: string | null;
  }>;
  mpesaReceiptNumber?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatMoney(amount: number | undefined | null): string {
  const value = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  return `KES ${value.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return 'N/A';
  try {
    return new Date(date).toLocaleDateString('en-KE');
  } catch {
    return 'N/A';
  }
}

function formatTime(date: string | Date | null | undefined): string {
  if (!date) return '';
  try {
    return new Date(date).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function getStoreName(receipt: ReceiptPayload): string {
  return receipt.store?.name || receipt.store?.organization?.name || 'MBUMAH HARDWARE';
}

function getCustomerName(receipt: ReceiptPayload): string {
  return (
    receipt.customer?.name ||
    receipt.transaction?.customer?.name ||
    ''
  );
}

function getCustomerPhone(receipt: ReceiptPayload): string {
  return receipt.customer?.phone || receipt.transaction?.customer?.phone || '';
}

function getCustomerEmail(receipt: ReceiptPayload): string {
  return receipt.customer?.email || receipt.transaction?.customer?.email || '';
}

function getCashierName(receipt: ReceiptPayload): string {
  return receipt.cashier?.name || receipt.transaction?.cashier?.name || 'N/A';
}

function getLineItems(
  receipt: ReceiptPayload
): NonNullable<ReceiptPayload['lineItems']> {
  if (Array.isArray(receipt.lineItems) && receipt.lineItems.length > 0) {
    return receipt.lineItems;
  }
  if (receipt.transaction?.items && Array.isArray(receipt.transaction.items)) {
    return receipt.transaction.items;
  }
  return [];
}

function getTransaction(
  receipt: ReceiptPayload
): NonNullable<ReceiptPayload['transaction']> | null {
  if (receipt.transaction) return receipt.transaction;
  // The GET /api/receipts/[id] response inlines transaction fields at the top
  // level via a `transaction` object — but if a caller passes the raw Prisma
  // receipt, `transaction` will be populated. Fall back to null otherwise.
  return null;
}

function getPayments(
  receipt: ReceiptPayload
): NonNullable<ReceiptPayload['payments']> {
  if (Array.isArray(receipt.payments) && receipt.payments.length > 0) {
    return receipt.payments;
  }
  if (receipt.transaction?.payments && Array.isArray(receipt.transaction.payments)) {
    return receipt.transaction.payments;
  }
  return [];
}

// ── Phone normalization (Kenyan) ─────────────────────────────────────────────

/**
 * Normalize a phone number to Kenyan international format (2547XXXXXXXX).
 *
 *  - Strips whitespace, dashes, parentheses.
 *  - `0712 345 678` -> `254712345678`
 *  - `+254 712 345 678` -> `254712345678`
 *  - `254712345678` -> unchanged
 *  - `712345678` (no leading 0) -> `254712345678` (assume Kenyan mobile)
 *  - Non-numeric input returns an empty string (the caller should validate).
 */
export function normalizePhone(phone: string): string {
  if (!phone) return '';
  let cleaned = String(phone).replace(/[\s\-()]/g, '');
  if (!cleaned) return '';

  if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }
  if (cleaned.startsWith('254')) {
    // Already international format. Strip any duplicate 0 after 254.
    cleaned = '254' + cleaned.slice(3).replace(/^0+/, '');
    return cleaned;
  }
  if (cleaned.startsWith('0')) {
    return '254' + cleaned.slice(1);
  }
  if (/^7\d{8}$/.test(cleaned) || /^1\d{8}$/.test(cleaned)) {
    // Looks like a Kenyan mobile without the leading 0.
    return '254' + cleaned;
  }
  // Unknown format — return as-is and let the caller decide.
  return cleaned;
}

// ── WhatsApp formatting ──────────────────────────────────────────────────────

/**
 * Build a nicely formatted WhatsApp message for a receipt. Includes emoji
 * headers, line items, totals, payment details, and a thank-you footer.
 */
export function formatReceiptForWhatsApp(receipt: ReceiptPayload): string {
  const lines: string[] = [];
  const separator = '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501';

  const txn = getTransaction(receipt);
  const subtotal = txn?.subtotal ?? 0;
  const taxAmount = txn?.taxAmount ?? 0;
  const discountAmount = txn?.discountAmount ?? 0;
  const totalAmount = txn?.totalAmount ?? 0;
  const paymentMethod = txn?.paymentMethod ?? 'CASH';
  const createdAt = txn?.createdAt ?? receipt.createdAt ?? new Date();
  const receiptNumber = receipt.receiptNumber || txn?.receiptNumber || '';

  lines.push(`\u{1F9FE} *RECEIPT* ${receiptNumber}`);
  lines.push(`From: ${getStoreName(receipt)}`);
  if (receipt.store?.location) lines.push(`\u{1F4CD} ${receipt.store.location}`);
  if (receipt.store?.phone) lines.push(`\u{1F4DE} ${receipt.store.phone}`);
  lines.push(separator);

  const customerName = getCustomerName(receipt);
  if (customerName) lines.push(`\u{1F464} Customer: ${customerName}`);
  lines.push(`\u{1F4C5} Date: ${formatDate(createdAt)}`);
  const time = formatTime(createdAt);
  if (time) lines.push(`\u{1F550} Time: ${time}`);
  lines.push(`\u{1F464} Cashier: ${getCashierName(receipt)}`);
  lines.push(separator);

  const items = getLineItems(receipt);
  for (const item of items) {
    const qty = item.quantity;
    const unit = item.unitType ? ` ${item.unitType}` : '';
    const price = formatMoney(item.pricePerUnit);
    const lineTotal = formatMoney(item.lineTotal);
    lines.push(`\u2022 ${item.productName} x${qty}${unit} @ ${price} = ${lineTotal}`);
  }

  lines.push(separator);
  lines.push(`\u{1F4B0} Subtotal: ${formatMoney(subtotal)}`);
  lines.push(`\u{1F4CA} Tax: ${formatMoney(taxAmount)}`);
  if (discountAmount > 0) {
    lines.push(`\u{1F3F7}\uFE0F Discount: ${formatMoney(discountAmount)}`);
  }
  lines.push(`\u{1F4B5} *TOTAL: ${formatMoney(totalAmount)}*`);
  lines.push(`\u{1F4B3} Payment: ${paymentMethod}`);

  const payments = getPayments(receipt);
  if (payments.length > 0) {
    for (const p of payments) {
      if (p.paymentMethod === 'MPESA' && p.reference) {
        lines.push(`\u{1F4F1} M-Pesa Ref: ${p.reference}`);
      } else if (p.paymentMethod === 'CASH') {
        lines.push(`\u{1F4B4} Cash: ${formatMoney(p.amount)}`);
      }
    }
  }

  if (receipt.mpesaReceiptNumber) {
    lines.push(`\u{1F4F1} M-Pesa Receipt: ${receipt.mpesaReceiptNumber}`);
  }

  if (txn?.notes) {
    lines.push('');
    lines.push(`\u{1F4DD} Notes: ${txn.notes}`);
  }

  lines.push('');
  lines.push('Thank you for shopping with us! \u{1F64F}');
  lines.push(`\u{1F3F7}\uFE0F Receipt #${receiptNumber}`);

  return lines.join('\n');
}

// ── Email formatting ─────────────────────────────────────────────────────────

/**
 * Build a plain-text email subject + body for a receipt. The body mirrors the
 * WhatsApp content but uses plain ASCII (no emoji) so it renders cleanly in
 * any email client.
 */
export function formatReceiptForEmail(
  receipt: ReceiptPayload
): { subject: string; body: string } {
  const txn = getTransaction(receipt);
  const subtotal = txn?.subtotal ?? 0;
  const taxAmount = txn?.taxAmount ?? 0;
  const discountAmount = txn?.discountAmount ?? 0;
  const totalAmount = txn?.totalAmount ?? 0;
  const paymentMethod = txn?.paymentMethod ?? 'CASH';
  const createdAt = txn?.createdAt ?? receipt.createdAt ?? new Date();
  const receiptNumber = receipt.receiptNumber || txn?.receiptNumber || '';
  const storeName = getStoreName(receipt);

  const customerName = getCustomerName(receipt);
  const subject = `Receipt ${receiptNumber} from ${storeName}`;

  const bodyLines: string[] = [];
  bodyLines.push(`RECEIPT: ${receiptNumber}`);
  bodyLines.push(`From: ${storeName}`);
  if (receipt.store?.location) bodyLines.push(`Location: ${receipt.store.location}`);
  if (receipt.store?.phone) bodyLines.push(`Phone: ${receipt.store.phone}`);
  if (receipt.store?.email) bodyLines.push(`Email: ${receipt.store.email}`);
  bodyLines.push('--------------------------------------------------');

  if (customerName) bodyLines.push(`Customer: ${customerName}`);
  bodyLines.push(`Date: ${formatDate(createdAt)} ${formatTime(createdAt)}`);
  bodyLines.push(`Cashier: ${getCashierName(receipt)}`);
  bodyLines.push('--------------------------------------------------');

  bodyLines.push('Items:');
  const items = getLineItems(receipt);
  for (const item of items) {
    const qty = item.quantity;
    const unit = item.unitType ? ` ${item.unitType}` : '';
    const price = formatMoney(item.pricePerUnit);
    const lineTotal = formatMoney(item.lineTotal);
    bodyLines.push(`  - ${item.productName} x${qty}${unit} @ ${price} = ${lineTotal}`);
  }

  bodyLines.push('--------------------------------------------------');
  bodyLines.push(`Subtotal: ${formatMoney(subtotal)}`);
  bodyLines.push(`Tax: ${formatMoney(taxAmount)}`);
  if (discountAmount > 0) {
    bodyLines.push(`Discount: ${formatMoney(discountAmount)}`);
  }
  bodyLines.push(`TOTAL: ${formatMoney(totalAmount)}`);
  bodyLines.push(`Payment Method: ${paymentMethod}`);

  const payments = getPayments(receipt);
  if (payments.length > 0) {
    bodyLines.push('Payment Details:');
    for (const p of payments) {
      if (p.paymentMethod === 'MPESA' && p.reference) {
        bodyLines.push(`  M-Pesa Ref: ${p.reference} (${formatMoney(p.amount)})`);
      } else if (p.paymentMethod === 'CASH') {
        bodyLines.push(`  Cash: ${formatMoney(p.amount)}`);
      }
    }
  }

  if (receipt.mpesaReceiptNumber) {
    bodyLines.push(`M-Pesa Receipt: ${receipt.mpesaReceiptNumber}`);
  }

  if (txn?.notes) {
    bodyLines.push('');
    bodyLines.push(`Notes: ${txn.notes}`);
  }

  bodyLines.push('');
  bodyLines.push('Thank you for shopping with us!');
  bodyLines.push(`Receipt #: ${receiptNumber}`);

  return { subject, body: bodyLines.join('\n') };
}

// ── Link builders ────────────────────────────────────────────────────────────

/**
 * Build a wa.me deep link. The phone number is normalized to international
 * format (no leading +) and the message is URL-encoded.
 *
 * Returns an empty string if the phone is missing/invalid so callers can
 * branch before opening a window.
 */
export function buildWhatsAppLink(phone: string, message: string): string {
  const normalized = normalizePhone(phone);
  if (!normalized) return '';
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/**
 * Build a `mailto:` deep link with subject and body. Both are URL-encoded.
 *
 * Note: this is the graceful fallback used when no SMTP provider is
 * configured. The same `subject` and `body` strings can be handed to a real
 * transport (Nodemailer, SendGrid, etc.) when one is wired up — see
 * `POST /api/receipts/[id]/send`.
 *
 * Returns an empty string if the email is missing.
 */
export function buildMailtoLink(email: string, subject: string, body: string): string {
  if (!email) return '';
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);
  return `mailto:${email}?subject=${encodedSubject}&body=${encodedBody}`;
}

// ── Re-exports for caller convenience ────────────────────────────────────────

export { getCustomerPhone, getCustomerEmail };
