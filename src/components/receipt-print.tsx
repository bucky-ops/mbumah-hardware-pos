'use client';

/**
 * MBUMAH HARDWARE POS — Receipt generation, preview, print & PDF export.
 *
 * INCIDENT FIXES (2026-09 — "blank receipts / dead Download button"):
 *   1. BLANK PRINT — the old @media print rules hid every direct child of
 *      [role="dialog"] except a `.receipt-printable-wrapper` class that did
 *      not exist anywhere in the DOM, so the whole dialog (receipt included)
 *      collapsed to display:none and the printer received a blank page.
 *      Printing now goes through printReceiptElement() which clones the
 *      receipt into #print-root; globals.css shows ONLY that container.
 *   2. DEAD DOWNLOAD — the Download button was disabled / merely called
 *      window.print(). It now runs generateReceiptPdf()
 *      (html2canvas-pro → jsPDF, 80mm dynamic-height page) with full
 *      try/catch + [RECEIPT_DOWNLOAD_ERROR] console logging + toast.
 *   3. PLACEHOLDER QR — the dashed "QrCode icon" box is replaced by a real,
 *      scannable QR code encoding the verification payload
 *      `TX:<receiptNumber>|Date:<createdAt>|Total:<totalAmount>`.
 *   4. html2canvas (classic) cannot parse Tailwind v4 oklch() colors —
 *      html2canvas-pro (API-compatible fork) is used instead, otherwise the
 *      PDF canvas comes out blank/broken.
 *
 * Component layout:
 *   ReceiptDocument      — the printable, branded receipt (colored, QR).
 *   ReceiptPrintPreview  — ResponsiveDialog wrapper with Print / Download
 *                          PDF / Copy / WhatsApp / New Sale actions.
 */

import React, { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import {
  Printer,
  Download,
  ShoppingCart,
  Share2,
  Banknote,
  Smartphone,
  Wallet,
  CreditCard,
  Gift,
  PartyPopper,
  CheckCircle2,
  Copy,
  Check,
  Loader2,
  Percent,
  ScanLine,
} from 'lucide-react';
import Image from 'next/image';
import { QRCodeCanvas } from 'qrcode.react';
import { toast } from 'sonner';
import {
  formatKES,
  formatDateTime,
  type TransactionItem,
  type SaleItemDetail,
} from '@/lib/api';
import { STORE_LIST, COMPANY, type StoreInfo } from '@/lib/store-info';
import Decimal from 'decimal.js';
import { toDec, toNum, max0, changeDue as changeDueOf } from '@/lib/utils/financialMath';
import { safeMap } from '@/lib/app-config';
import {
  RECEIPT_CONTENT_ID,
  generateReceiptPdf,
  buildReceiptFileName,
  printReceiptElement,
} from '@/lib/receipt-pdf';
import { buildReceiptQrPayload } from '@/lib/receipt-qr';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ReceiptPrintPreviewProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback to toggle the dialog */
  onOpenChange: (open: boolean) => void;
  /** The completed transaction data */
  transaction: TransactionItem | null;
  /** Cash amount received (for CASH payments — to show change) */
  cashReceived?: number;
  /** M-Pesa phone used (for MPESA payments) */
  mpesaPhone?: string;
  /** Current store ID — to look up branch info */
  storeId: string;
  /** Called when user clicks "New Sale" */
  onNewSale: () => void;
}

export interface ReceiptDocumentProps {
  transaction: TransactionItem;
  storeId: string;
  cashReceived?: number;
  mpesaPhone?: string;
  mpesaReference?: string;
  giftCardCode?: string;
  giftCardAmount?: number;
  voucherCode?: string;
  voucherAmount?: number;
  className?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Fractional quantities stay exact: 2.5 → "2.5", 3 → "3" (never 2.50). */
function formatQuantity(qty: number): string {
  if (!Number.isFinite(qty)) return String(qty);
  return Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(3)));
}

/** Unit suffix shown next to the quantity ("2.5 m", "0.5 kg"). */
function formatQuantityWithUnit(item: SaleItemDetail): string {
  const unit = (item.unitType || '').trim();
  const bare = formatQuantity(item.quantity);
  // "EA" (each) / "UNIT" add no information on paper — print the bare count.
  if (!unit || /^(ea|unit|pcs?)$/i.test(unit)) return bare;
  return `${bare} ${unit}`;
}

/** Payment status → colored pill ("PAID" emerald, "PARTIAL" amber, …). */
function PaymentStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PAID: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    COMPLETED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    PARTIAL: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    PENDING: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  };
  return (
    <Badge variant="secondary" className={`text-[10px] font-bold uppercase tracking-wide ${map[status] || 'bg-muted text-muted-foreground'}`}>
      <CheckCircle2 className="h-3 w-3 mr-1" />
      {status}
    </Badge>
  );
}

/** Payment method → icon + colored pill (M-PESA, CASH, DEBT, SPLIT, GIFT_CARD). */
function PaymentMethodBadge({ method }: { method: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    CASH: <Banknote className="h-3 w-3 mr-1" />,
    MPESA: <Smartphone className="h-3 w-3 mr-1" />,
    DEBT: <Wallet className="h-3 w-3 mr-1" />,
    SPLIT: <CreditCard className="h-3 w-3 mr-1" />,
    GIFT_CARD: <Gift className="h-3 w-3 mr-1" />,
  };

  const colorMap: Record<string, string> = {
    CASH: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    MPESA: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    DEBT: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    SPLIT: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
    GIFT_CARD: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  };

  return (
    <Badge
      variant="secondary"
      className={`text-[10px] font-semibold ${colorMap[method] || 'bg-muted text-muted-foreground'}`}
    >
      {iconMap[method] || null}
      {method === 'GIFT_CARD' ? 'GIFT CARD' : method}
    </Badge>
  );
}

/** Kenyan flag accent bar — 4 horizontal stripes (black, red, green, white) */
function KenyanFlagBar() {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-sm" aria-hidden="true">
      <div className="flex-1 bg-black" />
      <div className="flex-1 bg-red-600" />
      <div className="flex-1 bg-green-600" />
      <div className="flex-1 bg-white border-t border-b border-gray-300" />
    </div>
  );
}

/** Build a plain-text version of the receipt for WhatsApp sharing / copying */
function buildReceiptText(
  tx: TransactionItem,
  store: StoreInfo | undefined,
  opts?: {
    cashReceived?: number;
    mpesaReference?: string;
    giftCardCode?: string;
    giftCardAmount?: number;
    voucherCode?: string;
    voucherAmount?: number;
  },
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
  lines.push(`VAT (16%):       ${formatKES(tx.taxAmount).padStart(14)}`);
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

// ─── ReceiptDocument — the branded, printable receipt ───────────────────────

export function ReceiptDocument({
  transaction,
  storeId,
  cashReceived = 0,
  mpesaPhone = '',
  mpesaReference = '',
  giftCardCode = '',
  giftCardAmount = 0,
  voucherCode = '',
  voucherAmount = 0,
  className,
}: ReceiptDocumentProps) {
  const store = STORE_LIST.find((s) => s.id === storeId);

  // FINANCIAL MATH AUDIT: change = max(0, cash rendered − total), Decimal-
  // exact. Server-persisted `changeDue` (audit spec §4) is authoritative
  // when present; the client-passed tender is the fallback for live prints.
  const serverCashTendered = transaction.cashTendered != null ? toNum(transaction.cashTendered) : 0;
  const serverChangeDue = transaction.changeDue != null ? toNum(transaction.changeDue) : null;
  const effectiveCash = serverCashTendered > 0 ? serverCashTendered : cashReceived;
  const change = transaction.paymentMethod === 'CASH'
    ? (serverChangeDue ?? changeDueOf(effectiveCash, toNum(transaction.totalAmount)))
    : 0;

  // VAT breakdown — mode-agnostic and Decimal-exact. For every stored
  // transaction (legacy VAT-exclusive AND current VAT-inclusive pricing)
  // `totalAmount − taxAmount` is the NET (VAT-exclusive) revenue, and
  // taxAmount / 0.16 recovers the standard-rated net value; whatever net
  // remains is exempt / zero-rated (mirrors the eTIMS classification).
  const VAT_RATE = 0.16;
  const netRevenue = max0(toDec(transaction.totalAmount).minus(toDec(transaction.taxAmount)));
  const taxableAmount = toDec(transaction.taxAmount).gt(0)
    ? toDec(transaction.taxAmount).div(VAT_RATE).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : new Decimal(0);
  const exemptAmount = max0(netRevenue.minus(taxableAmount)).toNumber();

  const qrPayload = buildReceiptQrPayload(transaction);

  return (
    <div
      id={RECEIPT_CONTENT_ID}
      className={`receipt-printable overflow-hidden rounded-xl border border-border bg-white text-foreground shadow-sm ${className || ''}`}
    >
      {/* ─── Branded Header Banner ─── */}
      <div className="bg-primary px-4 py-4 text-primary-foreground">
        <div className="flex items-center justify-center gap-2.5">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/95 p-1">
            <Image
              src={COMPANY.logoPath}
              alt="MBUMAH HARDWARE logo"
              width={40}
              height={40}
              loading="eager"
              className="object-contain"
            />
          </span>
          <div className="text-center">
            <h2 className="text-base font-extrabold leading-tight tracking-wide">
              MBUMAH HARDWARE
            </h2>
            <p className="text-[9px] font-medium uppercase tracking-[0.18em] opacity-90">
              & Building Materials
            </p>
          </div>
        </div>
        <div className="mt-2.5 space-y-0.5 text-center text-[10px] leading-snug opacity-95">
          <p className="font-semibold">{store?.name || 'MBUMAH HARDWARE — Juja Main'}</p>
          <p>{store?.location || COMPANY.tagline}</p>
          <p>
            Tel: {store?.phone || COMPANY.phone}
            {store?.email ? ` · ${store.email}` : ''}
          </p>
          {store?.taxPin && (
            <p className="font-mono tracking-wide">KRA PIN: {store.taxPin}</p>
          )}
        </div>
      </div>

      {/* ─── Status strip ─── */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b bg-muted/40 px-3 py-2">
        <PaymentStatusBadge status={transaction.paymentStatus || 'PAID'} />
        <div className="flex items-center gap-1.5">
          {transaction.isOffline && (
            <Badge variant="secondary" className="bg-amber-100 text-[10px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              OFFLINE SYNC
            </Badge>
          )}
          <PaymentMethodBadge method={transaction.paymentMethod} />
        </div>
      </div>

      {/* ─── Receipt body ─── */}
      <div className="space-y-3 px-3.5 py-3 text-sm">
        {/* Meta block */}
        <div className="space-y-1 text-xs">
          <div className="flex justify-between gap-2">
            <span className="shrink-0 text-muted-foreground">Receipt #:</span>
            <span className="break-all text-right font-mono font-semibold">
              {transaction.receiptNumber}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="shrink-0 text-muted-foreground">Date &amp; Time:</span>
            <span className="break-words text-right">
              {formatDateTime(transaction.createdAt)}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="shrink-0 text-muted-foreground">Cashier:</span>
            <span className="break-words text-right">
              {transaction.cashier?.name || 'N/A'}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="shrink-0 text-muted-foreground">Customer:</span>
            <span className="break-words text-right">
              {transaction.customer?.name || 'Walk-in'}
            </span>
          </div>
        </div>

        <Separator />

        {/* Itemized table — striped rows, fractional quantities supported */}
        <div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-border bg-muted/60 text-[9px] uppercase tracking-wider text-muted-foreground">
                <th className="px-1 py-1.5 text-left font-bold">Item</th>
                <th className="px-1 py-1.5 text-center font-bold">Qty</th>
                <th className="px-1 py-1.5 text-right font-bold">Unit Price</th>
                <th className="px-1 py-1.5 text-right font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              {safeMap<SaleItemDetail, React.ReactElement>(transaction.items, (item, idx) => (
                <tr
                  key={item.id}
                  className={`border-b border-border/40 ${idx % 2 === 1 ? 'bg-muted/40' : ''}`}
                >
                  <td className="px-1 py-1.5 align-top">
                    <span className="block break-words font-medium leading-snug">
                      {item.productName}
                    </span>
                    {item.discountPercent > 0 && (
                      <span className="mt-0.5 inline-flex items-center gap-0.5 rounded bg-orange-100 px-1 py-px text-[9px] font-semibold text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
                        <Percent className="h-2.5 w-2.5" />
                        {item.discountPercent}% off
                      </span>
                    )}
                  </td>
                  <td className="px-1 py-1.5 text-center align-top whitespace-nowrap">
                    {formatQuantityWithUnit(item)}
                  </td>
                  <td className="px-1 py-1.5 text-right align-top whitespace-nowrap">
                    {formatKES(item.pricePerUnit ?? 0)}
                  </td>
                  <td className="px-1 py-1.5 text-right align-top font-medium">
                    {formatKES(item.lineTotal)}
                  </td>
                </tr>
              ))}
              {(!transaction.items || transaction.items.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-1 py-3 text-center text-muted-foreground">
                    No line items recorded
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Separator />

        {/* Financial breakdown */}
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatKES(transaction.subtotal)}</span>
          </div>

          {/* Discount — highlighted red/orange when applied */}
          {transaction.discountAmount > 0 && (
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1 rounded bg-orange-100 px-1.5 py-px text-[10px] font-bold text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
                <Percent className="h-2.5 w-2.5" />
                Discount Applied
              </span>
              <span className="font-semibold text-red-600 dark:text-red-400">
                −{formatKES(transaction.discountAmount)}
              </span>
            </div>
          )}

          {/* Voucher */}
          {voucherCode && voucherAmount > 0 && (
            <div className="flex justify-between">
              <span className="inline-flex items-center gap-1 text-purple-700 dark:text-purple-300">
                <Gift className="h-3 w-3" />
                Voucher ({voucherCode})
              </span>
              <span className="font-semibold text-purple-700 dark:text-purple-300">
                −{formatKES(voucherAmount)}
              </span>
            </div>
          )}

          {/* VAT / tax breakdown */}
          {taxableAmount.gt(0) && (
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span className="pl-2">Taxable Value (excl. VAT)</span>
              <span>{formatKES(taxableAmount.toNumber())}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT (16%)</span>
            <span>{formatKES(transaction.taxAmount)}</span>
          </div>
          {exemptAmount > 0 && (
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span className="pl-2">Exempt / Zero-rated</span>
              <span>{formatKES(exemptAmount)}</span>
            </div>
          )}

          {/* Grand total banner */}
          <div className="mt-1.5 flex items-center justify-between rounded-lg bg-primary px-2.5 py-2 text-primary-foreground">
            <span className="text-[11px] font-bold uppercase tracking-widest">Grand Total</span>
            <span className="text-lg font-extrabold tracking-tight">
              {formatKES(transaction.totalAmount)}
            </span>
          </div>

          {/* Tendered / change — FINANCIAL MATH AUDIT: prefers the
              server-persisted cashTendered/changeDue fields (spec §4). */}
          {transaction.paymentMethod === 'CASH' && effectiveCash > 0 && (
            <>
              <div className="flex justify-between pt-0.5">
                <span className="text-muted-foreground">Cash Tendered</span>
                <span className="font-medium">{formatKES(effectiveCash)}</span>
              </div>
              {change > 0 && (
                <div className="-mx-1 flex items-center justify-between rounded bg-emerald-50 px-1.5 py-1 font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Change Due
                  </span>
                  <span>{formatKES(change)}</span>
                </div>
              )}
            </>
          )}

          {transaction.paymentMethod === 'SPLIT' && cashReceived > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cash Portion</span>
              <span>{formatKES(cashReceived)}</span>
            </div>
          )}
        </div>

        {/* Payment reference details */}
        {(mpesaPhone || mpesaReference || (giftCardCode && giftCardAmount > 0)) && (
          <>
            <Separator />
            <div className="space-y-1 text-xs">
              {transaction.paymentMethod === 'MPESA' && mpesaPhone && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">M-Pesa Phone</span>
                  <span className="font-mono">{mpesaPhone}</span>
                </div>
              )}
              {transaction.paymentMethod === 'MPESA' && mpesaReference && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">M-Pesa Ref</span>
                  <span className="font-mono font-semibold text-green-600 dark:text-green-400">
                    {mpesaReference}
                  </span>
                </div>
              )}
              {giftCardCode && giftCardAmount > 0 && (
                <div className="-mx-1 flex justify-between rounded bg-purple-50 px-1.5 py-1 dark:bg-purple-950/20">
                  <span className="inline-flex items-center gap-1 text-purple-700 dark:text-purple-300">
                    <Gift className="h-3 w-3" />
                    Gift Card ({giftCardCode})
                  </span>
                  <span className="font-medium text-purple-700 dark:text-purple-300">
                    −{formatKES(giftCardAmount)}
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        <Separator />

        {/* ─── QR verification footer ─── */}
        <div className="flex flex-col items-center gap-1.5 py-1">
          <div className="rounded-lg border-2 border-border bg-white p-2">
            <QRCodeCanvas
              value={qrPayload}
              size={120}
              level="M"
              marginSize={1}
              bgColor="#FFFFFF"
              fgColor="#000000"
              title={`Verification QR for receipt ${transaction.receiptNumber}`}
              style={{ width: 96, height: 96, display: 'block' }}
            />
          </div>
          <p className="inline-flex items-center gap-1 text-[10px] font-semibold">
            <ScanLine className="h-3 w-3 text-primary" />
            Scan for your digital receipt
          </p>
          <p className="font-mono text-[9px] tracking-wider text-muted-foreground">
            {transaction.receiptNumber}
          </p>
        </div>

        <Separator />

        {/* ─── Footer ─── */}
        <div className="space-y-1.5 text-center">
          <p className="text-xs font-bold">Thank you for your business!</p>
          <p className="text-[10px] italic text-muted-foreground">Asante sana! 🇰🇪</p>
          <p className="text-[9px] font-medium text-muted-foreground">
            Goods once sold are not returnable unless per our returns policy —
            present this receipt.
          </p>
          {store?.taxPin && (
            <p className="font-mono text-[9px] text-muted-foreground">
              ETR Invoice · KRA PIN: {store.taxPin}
            </p>
          )}
          <KenyanFlagBar />
        </div>
      </div>
    </div>
  );
}

// ─── ReceiptPrintPreview — dialog wrapper with actions ──────────────────────

export function ReceiptPrintPreview({
  open,
  onOpenChange,
  transaction,
  cashReceived = 0,
  mpesaPhone = '',
  storeId,
  onNewSale,
}: ReceiptPrintPreviewProps) {
  const [isPrinting, setIsPrinting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  const store = STORE_LIST.find((s) => s.id === storeId);

  // Reveal print state only while the print dialog is actually up.
  const handlePrint = useCallback(() => {
    if (!transaction) return;
    setIsPrinting(true);
    try {
      printReceiptElement(RECEIPT_CONTENT_ID);
    } catch (error) {
      console.error('[RECEIPT_PRINT_ERROR]', error);
      toast.error('Failed to open the print dialog. Please try again.');
    } finally {
      setTimeout(() => setIsPrinting(false), 1000);
    }
  }, [transaction]);

  // Real PDF export: html2canvas-pro capture → jsPDF 80mm page download.
  const handleDownloadPDF = useCallback(async () => {
    if (!transaction) return;
    setIsDownloading(true);
    try {
      await generateReceiptPdf({
        elementId: RECEIPT_CONTENT_ID,
        fileName: buildReceiptFileName(transaction.receiptNumber, transaction.id),
      });
      toast.success('Receipt PDF downloaded.');
    } catch (error) {
      console.error('[RECEIPT_DOWNLOAD_ERROR]', error);
      toast.error('Failed to download receipt. Please try again or use Print to PDF.');
    } finally {
      setIsDownloading(false);
    }
  }, [transaction]);

  // Text-share options: the lightweight preview only knows cashReceived (the
  // gift-card/voucher/M-Pesa-reference fields belong to EnhancedReceiptPrint,
  // which builds its own richer text).
  const receiptTextOpts = () => ({ cashReceived });

  const handleShareWhatsApp = useCallback(() => {
    if (!transaction) return;
    const text = buildReceiptText(transaction, store, receiptTextOpts());
    const encoded = encodeURIComponent(text);
    const url = `https://wa.me/?text=${encoded}`;
    window.open(url, '_blank', 'noopener');
  }, [transaction, store, receiptTextOpts]);

  const handleCopyReceipt = useCallback(() => {
    if (!transaction) return;
    const text = buildReceiptText(transaction, store, receiptTextOpts());
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [transaction, store, receiptTextOpts]);

  const handleNewSale = useCallback(() => {
    onOpenChange(false);
    onNewSale();
  }, [onOpenChange, onNewSale]);

  if (!transaction) return null;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2 justify-center">
          <PartyPopper className="h-5 w-5 text-primary" />
          Receipt Preview
        </span>
      }
      description="Sale completed successfully. Download, print, share, or start a new sale."
      size="sm"
      footer={
        <div className="flex flex-wrap gap-2 w-full no-print">
          <Button
            variant="outline"
            onClick={handleDownloadPDF}
            disabled={isDownloading}
            className="flex-1 min-w-[100px] border-primary/40 text-primary hover:bg-primary/10"
          >
            {isDownloading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            {isDownloading ? 'Preparing…' : 'Download PDF'}
          </Button>
          <Button
            variant="outline"
            onClick={handlePrint}
            disabled={isPrinting}
            className="flex-1 min-w-[90px]"
          >
            <Printer className="mr-1.5 h-4 w-4" />
            {isPrinting ? 'Printing...' : 'Print'}
          </Button>
          <Button
            variant="outline"
            onClick={handleCopyReceipt}
            className="flex-1 min-w-[90px]"
          >
            {copied ? <Check className="mr-1.5 h-4 w-4 text-green-500" /> : <Copy className="mr-1.5 h-4 w-4" />}
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <Button
            variant="outline"
            onClick={handleShareWhatsApp}
            className="flex-1 min-w-[90px] text-green-700 dark:text-green-400 border-green-300 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-950/30"
          >
            <Share2 className="mr-1.5 h-4 w-4" />
            WhatsApp
          </Button>
          <Button
            onClick={handleNewSale}
            className="flex-1 min-w-[90px] bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
          >
            <ShoppingCart className="mr-1.5 h-4 w-4" />
            New Sale
          </Button>
        </div>
      }
    >
      <ReceiptDocument
        transaction={transaction}
        storeId={storeId}
        cashReceived={cashReceived}
        mpesaPhone={mpesaPhone}
      />
    </ResponsiveDialog>
  );
}
