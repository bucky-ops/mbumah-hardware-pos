/**
 * receipt-share-text - the ONE builder for the plain-text receipt shared via
 * Copy / WhatsApp / SMS across every receipt dialog.
 *
 * v2.14.0 share-text spec: the text MUST include store name, receipt number,
 * date and grand total - all four are unconditional lines below, so a
 * partially-populated transaction can never produce a share message without
 * them.
 *
 * Previously this builder was duplicated (byte-identical) in
 * src/components/receipt-print.tsx and src/components/pos/receipt-print.tsx;
 * both now import this module so the surfaces can never drift apart again.
 * Output format is intentionally UNCHANGED (customer-facing contract).
 */

import { formatKES } from '@/lib/utils/financialMath';
import { formatDateTime, type TransactionItem } from '@/lib/api';
import { COMPANY, type StoreInfo } from '@/lib/store-info';
import { toNum, changeDue as changeDueOf } from '@/lib/utils/financialMath';

export interface ReceiptShareTextOptions {
  cashReceived?: number;
  mpesaReference?: string;
  giftCardCode?: string;
  giftCardAmount?: number;
  voucherCode?: string;
  voucherAmount?: number;
}

export function buildReceiptText(
  tx: TransactionItem,
  store: StoreInfo | undefined,
  opts?: ReceiptShareTextOptions,
): string {
  const lines: string[] = [];
  const divider = '─'.repeat(32);

  lines.push('        MBUMAH HARDWARE');
  lines.push(`  ${store?.shortName || 'Juja Main Branch'}`);
  lines.push(`  ${store?.location || ''}`);
  lines.push(`  Tel: ${store?.phone || COMPANY.phone}`);
  if (store?.email) lines.push(`  Email: ${store.email}`);
  lines.push(divider);
  lines.push(`Receipt #: ${tx.receiptNumber}`);
  lines.push(`Date: ${formatDateTime(tx.createdAt)}`);
  lines.push(`Cashier: ${tx.cashier?.name || 'N/A'}`);
  lines.push(`Customer: ${tx.customer?.name || 'Walk-in'}`);
  lines.push(divider);

  if (tx.items?.length) {
    lines.push('Item              Qty  Price   Total');
    for (const item of tx.items) {
      const name = item.productName.length > 16
        ? item.productName.slice(0, 16) + '…'
        : item.productName.padEnd(17);
      const qty = String(item.quantity).padStart(3);
      const price = formatKES(item.pricePerUnit ?? 0).padStart(7);
      const total = formatKES(item.lineTotal).padStart(8);
      lines.push(`${name}${qty}${price}${total}`);
    }
  }

  lines.push(divider);
  lines.push(`Subtotal:        ${formatKES(tx.subtotal).padStart(14)}`);
  // v2.8.0: label no longer hardcodes 16% - the amount is the stored, correct
  // tax component whatever the admin rate was at sale time.
  lines.push(`VAT:             ${formatKES(tx.taxAmount).padStart(14)}`);
  if (tx.discountAmount > 0) {
    lines.push(`Discount:       -${formatKES(tx.discountAmount).padStart(14)}`);
  }
  if (opts?.voucherCode && opts.voucherAmount && opts.voucherAmount > 0) {
    lines.push(`Voucher (${opts.voucherCode}): -${formatKES(opts.voucherAmount).padStart(10)}`);
  }
  lines.push(`TOTAL:           ${formatKES(tx.totalAmount).padStart(14)}`);
  lines.push(divider);
  lines.push(`Payment: ${tx.paymentMethod}`);

  if (tx.paymentMethod === 'CASH') {
    // FINANCIAL MATH AUDIT: prefer server-persisted tender/change (spec §4);
    // change = max(0, cash rendered − total), Decimal-exact.
    const tendered = tx.cashTendered != null ? toNum(tx.cashTendered) : opts?.cashReceived ?? 0;
    const change = tx.changeDue != null
      ? toNum(tx.changeDue)
      : changeDueOf(tendered, toNum(tx.totalAmount));
    if (tendered > 0) {
      lines.push(`Cash Tendered:  ${formatKES(tendered).padStart(14)}`);
    }
    if (change > 0) {
      lines.push(`Change:          ${formatKES(change).padStart(14)}`);
    }
  }

  if (tx.paymentMethod === 'MPESA' && opts?.mpesaReference) {
    lines.push(`M-Pesa Ref: ${opts.mpesaReference}`);
  }

  if (opts?.giftCardCode && opts?.giftCardAmount && opts.giftCardAmount > 0) {
    lines.push(`Gift Card: ${opts.giftCardCode}`);
    lines.push(`Redeemed:  ${formatKES(opts.giftCardAmount)}`);
  }

  lines.push('');
  lines.push('Thank you for shopping at');
  lines.push('MBUMAH HARDWARE!');
  lines.push('Asante sana!');
  lines.push('Goods sold are not refundable.');

  return lines.join('\n');
}
