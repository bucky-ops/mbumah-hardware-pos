'use client';

/**
 * MBUMAH HARDWARE POS - Receipt generation, preview, print & PDF export.
 *
 * INCIDENT FIXES (2026-09 - "blank receipts / dead Download button"):
 *   1. BLANK PRINT - the old @media print rules hid every direct child of
 *      [role="dialog"] except a `.receipt-printable-wrapper` class that did
 *      not exist anywhere in the DOM, so the whole dialog (receipt included)
 *      collapsed to display:none and the printer received a blank page.
 *      Printing now goes through printReceiptElement() which clones the
 *      receipt into #print-root; globals.css shows ONLY that container.
 *   2. DEAD DOWNLOAD - the Download button was disabled / merely called
 *      window.print(). It now runs generateReceiptPdf()
 *      (html2canvas-pro -> jsPDF, 80mm dynamic-height page) with full
 *      try/catch + [RECEIPT_DOWNLOAD_ERROR] console logging + toast.
 *   3. PLACEHOLDER QR - the dashed "QrCode icon" box is replaced by a real,
 *      scannable QR code encoding the verification payload
 *      `TX:<receiptNumber>|Date:<createdAt>|Total:<totalAmount>`.
 *   4. html2canvas (classic) cannot parse Tailwind v4 oklch() colors -
 *      html2canvas-pro (API-compatible fork) is used instead, otherwise the
 *      PDF canvas comes out blank/broken.
 *
 * v2.14.0 RECEIPT-RENDERING SPEC (applies to every receipt surface):
 *   - Money cells never wrap (nowrap + tabular-nums + right alignment) and
 *     the items table uses a fixed 38/18/22/22 column grid; below 480px the
 *     per-line "Ksh" prefix is dropped and the currency is stated once in
 *     the column headers (CSS-driven, see globals.css).
 *   - Units render abbreviated lowercase on screen ("1 pc", "1 bag") and as
 *     full words in print/PDF (CSS swap + .receipt-capture-mode).
 *   - Action buttons use a 2-column grid (auto-fit >= 720px), no fixed
 *     widths, no truncation at 320px.
 *   - Grand Total / Cash Tendered / Change also render in a pinned strip
 *     OUTSIDE the dialog's scrollable body, visible without scrolling.
 *   - The items region caps at 45vh with a bottom scroll-fade affordance.
 *   - Primary CTA fill #C2410C (white text); focus rings are
 *     :focus-visible-only via the shared Button component.
 *   - A11y: Radix provides role="dialog"/aria-modal/focus-trap/ESC/restore;
 *     the scroll region is tabindex=0 + aria-labelled, the success message
 *     is role="status", column headers carry scope="col".
 *
 * Component layout:
 *   ReceiptDocument      - the printable, branded receipt (colored, QR).
 *   ReceiptPrintPreview  - ResponsiveDialog wrapper with Print / Download
 *                          PDF / Copy / WhatsApp / SMS / New Sale actions.
 *   ReceiptTotalsStrip   - the pinned, always-visible totals summary.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getCachedVatRate } from '@/lib/vat-rate-cache';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import {
  Printer,
  Download,
  ShoppingCart,
  PartyPopper,
  Banknote,
  Smartphone,
  Wallet,
  CreditCard,
  Gift,
  CheckCircle2,
  Loader2,
  Percent,
  ScanLine,
} from 'lucide-react';
import Image from 'next/image';
import { QRCodeCanvas } from 'qrcode.react';
import { toast } from 'sonner';
import {
  formatDateTime,
  type TransactionItem,
  type SaleItemDetail,
} from '@/lib/api';
import { STORE_LIST, COMPANY } from '@/lib/store-info';
import Decimal from 'decimal.js';
import { toDec, toNum, max0, changeDue as changeDueOf } from '@/lib/utils/financialMath';
import { safeMap } from '@/lib/app-config';
import {
  RECEIPT_CONTENT_ID,
  generateReceiptPdf,
  buildReceiptFileName,
  printReceiptElement,
} from '@/lib/receipt-pdf';
import {
  RECEIPT_TABLE_COL_WIDTHS,
  abbreviateUnit,
  formatReceiptQuantity,
  fullUnitLabel,
  splitKES,
} from '@/lib/receipt-format';
import { buildReceiptQrPayload } from '@/lib/receipt-qr';
import { ReceiptShareButtons } from '@/components/receipt-share-buttons';

// Props

export interface ReceiptPrintPreviewProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback to toggle the dialog */
  onOpenChange: (open: boolean) => void;
  /** The completed transaction data */
  transaction: TransactionItem | null;
  /** Cash amount received (for CASH payments - to show change) */
  cashReceived?: number;
  /** M-Pesa phone used (for MPESA payments) */
  mpesaPhone?: string;
  /** Current store ID - to look up branch info */
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
  /**
   * v2.8.0: admin-controlled VAT rate (percent) used for the VAT label and
   * the taxable-value derivation. Defaults to the cached admin rate / 16.
   */
  vatRatePercent?: number;
  className?: string;
}

// Helpers

/** Payment status -> colored pill ("PAID" emerald, "PARTIAL" amber, ...). */
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

/** Payment method -> icon + colored pill (M-PESA, CASH, DEBT, SPLIT, GIFT_CARD). */
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

/** Kenyan flag accent bar - 4 horizontal stripes (black, red, green, white) */
function KenyanFlagBar() {
  return (
    // data-print-keep: the one brand accent that survives the black-on-white
    // print neutralization (see the @media print block in globals.css).
    <div className="flex h-2 w-full overflow-hidden rounded-sm" aria-hidden="true" data-print-keep>
      <div className="flex-1 bg-black" />
      <div className="flex-1 bg-red-600" />
      <div className="flex-1 bg-green-600" />
      <div className="flex-1 bg-white border-t border-b border-gray-300" />
    </div>
  );
}

/**
 * v2.14.0 money cell: NEVER wraps (nowrap + tabular-nums + right align via
 * the .receipt-money class) and carries the currency as a separate span so
 * the per-line "Ksh" prefix can be dropped below 480px by CSS while the
 * column headers state it once.
 */
function Money({
  amount,
  className,
}: {
  amount: number | string | null | undefined;
  className?: string;
}) {
  const { currency, value } = splitKES(amount);
  return (
    <span className={`receipt-money ${className || ''}`}>
      {currency ? <span className="receipt-currency">{currency} </span> : null}
      <span>{value}</span>
    </span>
  );
}

/**
 * v2.14.0 unit-aware quantity: abbreviated lowercase on screen ("2.5 bag"),
 * full word in print/PDF ("2.5 kilogram") - the swap is pure CSS so the same
 * DOM serves both media (globals.css + .receipt-capture-mode).
 */
function QtyWithUnit({ item }: { item: SaleItemDetail }) {
  const qty = formatReceiptQuantity(toNum(item.quantity));
  const abbr = abbreviateUnit(item.unitType);
  const full = fullUnitLabel(item.unitType);
  return (
    <span className="receipt-qty whitespace-nowrap">
      {qty}
      {abbr ? <span className="receipt-unit-abbr"> {abbr}</span> : null}
      {full ? <span className="receipt-unit-full"> {full}</span> : null}
    </span>
  );
}

/**
 * FINANCIAL MATH AUDIT (shared by the in-card totals and the pinned strip):
 * change = max(0, cash rendered - total), Decimal-exact. Server-persisted
 * `changeDue` (audit spec §4) is authoritative when present; the
 * client-passed tender is the fallback for live prints.
 */
export function computeReceiptTotals(transaction: TransactionItem, cashReceived = 0) {
  const serverCashTendered = transaction.cashTendered != null ? toNum(transaction.cashTendered) : 0;
  const serverChangeDue = transaction.changeDue != null ? toNum(transaction.changeDue) : null;
  const effectiveCash = serverCashTendered > 0 ? serverCashTendered : cashReceived;
  const change = transaction.paymentMethod === 'CASH'
    ? (serverChangeDue ?? changeDueOf(effectiveCash, toNum(transaction.totalAmount)))
    : 0;
  return { effectiveCash, change, total: toNum(transaction.totalAmount) };
}

/**
 * v2.14.0 PINNED TOTALS STRIP - Grand Total (+ Tendered / Change for cash)
 * rendered OUTSIDE the dialog's scrollable body so the numbers that matter
 * are visible without scrolling at any viewport width.
 */
export function ReceiptTotalsStrip({
  transaction,
  cashReceived = 0,
}: {
  transaction: TransactionItem;
  cashReceived?: number;
}) {
  const { effectiveCash, change, total } = computeReceiptTotals(transaction, cashReceived);
  const isCash = transaction.paymentMethod === 'CASH';
  return (
    <div className="space-y-1" data-testid="receipt-totals-strip">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-bold uppercase tracking-widest">Grand Total</span>
        <Money amount={total} className="text-base font-extrabold tracking-tight" />
      </div>
      {isCash && effectiveCash > 0 && (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">Cash Tendered</span>
          <Money amount={effectiveCash} className="font-medium" />
        </div>
      )}
      {isCash && change > 0 && (
        <div className="flex items-center justify-between gap-3 rounded bg-emerald-50 px-1.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Change Due
          </span>
          <Money amount={change} />
        </div>
      )}
    </div>
  );
}

/** Bottom scroll-fade + a11y-labelled scroll region for the items table. */
function ReceiptItemsRegion({ transaction }: { transaction: TransactionItem }) {
  const itemsScrollRef = useRef<HTMLDivElement | null>(null);
  const [showFade, setShowFade] = useState(false);

  const updateFade = useCallback(() => {
    const el = itemsScrollRef.current;
    if (!el) return;
    setShowFade(el.scrollHeight - el.clientHeight - el.scrollTop > 4);
  }, []);

  useEffect(() => {
    updateFade();
    const el = itemsScrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateFade);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateFade, transaction.items]);

  const itemCount = transaction.items?.length ?? 0;

  return (
    <div className="receipt-items-region relative">
      <div
        ref={itemsScrollRef}
        onScroll={updateFade}
        tabIndex={0}
        role="region"
        aria-label={`Receipt line items${itemCount ? ` (${itemCount})` : ''} - scrollable`}
        className="receipt-items-scroll max-h-[45vh] overflow-y-auto"
      >
        <table className="w-full table-fixed border-collapse text-xs">
          <colgroup>
            <col style={{ width: `${RECEIPT_TABLE_COL_WIDTHS.item}%` }} />
            <col style={{ width: `${RECEIPT_TABLE_COL_WIDTHS.qty}%` }} />
            <col style={{ width: `${RECEIPT_TABLE_COL_WIDTHS.price}%` }} />
            <col style={{ width: `${RECEIPT_TABLE_COL_WIDTHS.total}%` }} />
          </colgroup>
          <thead>
            <tr className="border-b-2 border-border bg-muted/60 text-[9px] uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-1 py-1.5 text-left font-bold">Item</th>
              <th scope="col" className="px-1 py-1.5 text-center font-bold">Qty</th>
              <th scope="col" className="px-1 py-1.5 text-right font-bold">
                Price<span className="receipt-currency-header"> (Ksh)</span>
              </th>
              <th scope="col" className="px-1 py-1.5 text-right font-bold">
                Total<span className="receipt-currency-header"> (Ksh)</span>
              </th>
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
                <td className="receipt-qty-cell px-1 py-1.5 text-center align-top">
                  <QtyWithUnit item={item} />
                </td>
                <td className="px-1 py-1.5 text-right align-top">
                  <Money amount={item.pricePerUnit ?? 0} />
                </td>
                <td className="px-1 py-1.5 text-right align-top font-medium">
                  <Money amount={item.lineTotal} />
                </td>
              </tr>
            ))}
            {itemCount === 0 && (
              <tr>
                <td colSpan={4} className="px-1 py-3 text-center text-muted-foreground">
                  No line items recorded
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* More-content affordance - hidden once scrolled to the bottom. */}
      <div
        className="receipt-items-fade"
        aria-hidden="true"
        style={{ opacity: showFade ? 1 : 0 }}
      />
    </div>
  );
}

// ReceiptDocument - the branded, printable receipt

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
  vatRatePercent,
  className,
}: ReceiptDocumentProps) {
  const store = STORE_LIST.find((s) => s.id === storeId);
  // v2.8.0: rate comes from the admin setting (cached) unless overridden.
  const effectiveVatRatePercent = vatRatePercent ?? getCachedVatRate();

  const { effectiveCash, change } = computeReceiptTotals(transaction, cashReceived);

  // VAT breakdown - mode-agnostic and Decimal-exact. For every stored
  // transaction (legacy VAT-exclusive AND current VAT-inclusive pricing)
  // `totalAmount − taxAmount` is the NET (VAT-exclusive) revenue, and
  // taxAmount / rate recovers the standard-rated net value; whatever net
  // remains is exempt / zero-rated (mirrors the eTIMS classification).
  // v2.8.0: the rate is the admin-controlled setting (NOT hardcoded 16%).
  const vatRate = effectiveVatRatePercent > 0 ? effectiveVatRatePercent / 100 : 0;
  const netRevenue = max0(toDec(transaction.totalAmount).minus(toDec(transaction.taxAmount)));
  const taxableAmount = toDec(transaction.taxAmount).gt(0) && vatRate > 0
    ? toDec(transaction.taxAmount).div(vatRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : new Decimal(0);
  const exemptAmount = max0(netRevenue.minus(taxableAmount)).toNumber();

  const qrPayload = buildReceiptQrPayload(transaction);

  return (
    <div
      id={RECEIPT_CONTENT_ID}
      className={`receipt-printable overflow-hidden rounded-xl border border-border bg-white text-foreground shadow-sm ${className || ''}`}
    >
      {/* --- Branded Header Banner --- */}
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
          <p className="font-semibold">{store?.name || 'MBUMAH HARDWARE - Juja Main'}</p>
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

      {/* --- Status strip --- */}
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

      {/* --- Receipt body --- */}
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

        {/* Itemized table - fixed 38/18/22/22 grid, scroll-capped with a
            bottom fade, fully a11y-labelled (v2.14.0 receipt spec). */}
        <ReceiptItemsRegion transaction={transaction} />

        <Separator />

        {/* Financial breakdown */}
        <div className="space-y-1 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Subtotal</span>
            <Money amount={transaction.subtotal} />
          </div>

          {/* Discount - highlighted red/orange when applied */}
          {transaction.discountAmount > 0 && (
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1 rounded bg-orange-100 px-1.5 py-px text-[10px] font-bold text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
                <Percent className="h-2.5 w-2.5" />
                Discount Applied
              </span>
              <Money
                amount={transaction.discountAmount}
                className="font-semibold text-red-600 dark:text-red-400"
              />
            </div>
          )}

          {/* Voucher */}
          {voucherCode && voucherAmount > 0 && (
            <div className="flex justify-between gap-3">
              <span className="inline-flex items-center gap-1 text-purple-700 dark:text-purple-300">
                <Gift className="h-3 w-3" />
                Voucher ({voucherCode})
              </span>
              <Money
                amount={voucherAmount}
                className="font-semibold text-purple-700 dark:text-purple-300"
              />
            </div>
          )}

          {/* VAT / tax breakdown */}
          {taxableAmount.gt(0) && (
            <div className="flex justify-between gap-3 text-[10px] text-muted-foreground">
              <span className="pl-2">Taxable Value (excl. VAT)</span>
              <Money amount={taxableAmount.toNumber()} />
            </div>
          )}
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">VAT ({effectiveVatRatePercent}% incl.)</span>
            <Money amount={transaction.taxAmount} />
          </div>
          {exemptAmount > 0 && (
            <div className="flex justify-between gap-3 text-[10px] text-muted-foreground">
              <span className="pl-2">Exempt / Zero-rated</span>
              <Money amount={exemptAmount} />
            </div>
          )}

          {/* Grand total banner */}
          <div className="mt-1.5 flex items-center justify-between gap-3 rounded-lg bg-primary px-2.5 py-2 text-primary-foreground">
            <span className="text-[11px] font-bold uppercase tracking-widest">Grand Total</span>
            <Money amount={transaction.totalAmount} className="text-lg font-extrabold tracking-tight" />
          </div>

          {/* Tendered / change - FINANCIAL MATH AUDIT: prefers the
              server-persisted cashTendered/changeDue fields (spec §4). */}
          {transaction.paymentMethod === 'CASH' && effectiveCash > 0 && (
            <>
              <div className="flex justify-between gap-3 pt-0.5">
                <span className="text-muted-foreground">Cash Tendered</span>
                <Money amount={effectiveCash} className="font-medium" />
              </div>
              {change > 0 && (
                <div className="-mx-1 flex items-center justify-between gap-3 rounded bg-emerald-50 px-1.5 py-1 font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Change Due
                  </span>
                  <Money amount={change} />
                </div>
              )}
            </>
          )}

          {transaction.paymentMethod === 'SPLIT' && cashReceived > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Cash Portion</span>
              <Money amount={cashReceived} />
            </div>
          )}
        </div>

        {/* Payment reference details */}
        {(mpesaPhone || mpesaReference || (giftCardCode && giftCardAmount > 0)) && (
          <>
            <Separator />
            <div className="space-y-1 text-xs">
              {transaction.paymentMethod === 'MPESA' && mpesaPhone && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">M-Pesa Phone</span>
                  <span className="font-mono">{mpesaPhone}</span>
                </div>
              )}
              {transaction.paymentMethod === 'MPESA' && mpesaReference && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">M-Pesa Ref</span>
                  <span className="font-mono font-semibold text-green-600 dark:text-green-400">
                    {mpesaReference}
                  </span>
                </div>
              )}
              {giftCardCode && giftCardAmount > 0 && (
                <div className="-mx-1 flex justify-between gap-3 rounded bg-purple-50 px-1.5 py-1 dark:bg-purple-950/20">
                  <span className="inline-flex items-center gap-1 text-purple-700 dark:text-purple-300">
                    <Gift className="h-3 w-3" />
                    Gift Card ({giftCardCode})
                  </span>
                  <Money
                    amount={giftCardAmount}
                    className="font-medium text-purple-700 dark:text-purple-300"
                  />
                </div>
              )}
            </div>
          </>
        )}

        <Separator />

        {/* --- QR verification footer --- */}
        <div className="flex flex-col items-center gap-1.5 py-1" data-print-keep>
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

        {/* --- Footer --- */}
        <div className="space-y-1.5 text-center">
          <p className="text-xs font-bold">Thank you for your business!</p>
          <p className="text-[10px] italic text-muted-foreground">Asante sana! 🇰🇪</p>
          <p className="text-[9px] font-medium text-muted-foreground">
            Goods once sold are not returnable unless per our returns policy -
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

// ReceiptPrintPreview - dialog wrapper with actions

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

  // Real PDF export: html2canvas-pro capture -> jsPDF 80mm page download.
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
      // v2.14.0 PINNED TOTALS: Grand Total / Tendered / Change live OUTSIDE
      // the scrollable body - visible without scrolling at every width.
      pinned={<ReceiptTotalsStrip transaction={transaction} cashReceived={cashReceived} />}
      footer={
        // v2.14.0 action bar: 2-col grid (auto-fit >= 720px), no fixed
        // widths, no truncation at 320px - see .receipt-actions CSS.
        <div className="receipt-actions no-print w-full">
          <Button
            variant="outline"
            onClick={handleDownloadPDF}
            disabled={isDownloading}
            aria-label="Download receipt as PDF"
            className="h-9 w-full px-2 text-xs sm:px-3 sm:text-sm border-primary/40 text-primary hover:bg-primary/10"
          >
            {isDownloading ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <Download className="h-4 w-4 shrink-0" />
            )}
            <span className="min-w-0">{isDownloading ? 'Preparing…' : 'Download PDF'}</span>
          </Button>
          <Button
            variant="outline"
            onClick={handlePrint}
            disabled={isPrinting}
            aria-label="Print receipt"
            className="h-9 w-full px-2 text-xs sm:px-3 sm:text-sm"
          >
            <Printer className="h-4 w-4 shrink-0" />
            <span className="min-w-0">{isPrinting ? 'Printing…' : 'Print'}</span>
          </Button>
          <ReceiptShareButtons
            transaction={transaction}
            store={store}
            buildOpts={() => ({ cashReceived })}
          />
          <Button
            onClick={handleNewSale}
            aria-label="Start a new sale"
            className="h-9 w-full px-2 text-xs sm:px-3 sm:text-sm bg-[#C2410C] text-white hover:bg-[#9A3412]"
          >
            <ShoppingCart className="h-4 w-4 shrink-0" />
            <span className="min-w-0">New Sale</span>
          </Button>
        </div>
      }
    >
      {/* Screen-reader success announcement (visible header text stays). */}
      <p role="status" className="sr-only">
        Sale completed successfully. Receipt {transaction.receiptNumber} for{' '}
        {splitKES(transaction.totalAmount).value} shillings.
      </p>
      <ReceiptDocument
        transaction={transaction}
        storeId={storeId}
        cashReceived={cashReceived}
        mpesaPhone={mpesaPhone}
      />
    </ResponsiveDialog>
  );
}
