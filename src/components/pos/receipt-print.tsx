'use client';

/**
 * EnhancedReceiptPrint — Professional receipt component for MBUMAH HARDWARE POS.
 *
 * Features:
 *  - Professional receipt layout with company logo area
 *  - Itemized table with quantities, unit prices, and subtotals
 *  - Tax breakdown (VAT 16%)
 *  - Payment method details with icons
 *  - M-Pesa transaction reference (if applicable)
 *  - Gift card/voucher redemption details
 *  - Change amount display
 *  - Footer with "Thank you for shopping at MBUMAH HARDWARE"
 *  - Barcode/QR code area placeholder
 *  - Auto-print capability using window.print() with @media print CSS
 *  - Thermal receipt format (80mm width) for POS printers
 *  - Monospace font option for thermal printers
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
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
  QrCode,
  CheckCircle2,
  Copy,
  Check,
} from 'lucide-react';
import Image from 'next/image';
import { formatKES, formatDateTime, type TransactionItem, type SaleItemDetail } from '@/lib/api';
import { STORE_LIST, COMPANY, type StoreInfo } from '@/lib/store-info';
import { safeMap } from '@/lib/app-config';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface EnhancedReceiptProps {
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
  /** M-Pesa receipt/transaction reference from Safaricom */
  mpesaReference?: string;
  /** Gift card code used in the transaction */
  giftCardCode?: string;
  /** Gift card amount redeemed */
  giftCardAmount?: number;
  /** Voucher code used */
  voucherCode?: string;
  /** Voucher discount amount */
  voucherAmount?: number;
  /** Current store ID — to look up branch info */
  storeId: string;
  /** Called when user clicks "New Sale" */
  onNewSale: () => void;
  /** Whether to auto-print on dialog open */
  autoPrint?: boolean;
  /** Whether to use monospace font (for thermal printers) */
  thermalMode?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Payment method → icon + label */
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
      className={`text-[10px] font-semibold ${colorMap[method] || ''}`}
    >
      {iconMap[method] || null}
      {method}
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

/** QR/Barcode placeholder area for receipt scanning */
function BarcodeArea({ receiptNumber }: { receiptNumber: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-2">
      <div className="border-2 border-dashed border-muted-foreground/30 rounded-md p-3 flex flex-col items-center gap-1">
        <QrCode className="h-10 w-10 text-muted-foreground/40" />
        <span className="text-[8px] text-muted-foreground font-mono tracking-wider">
          {receiptNumber}
        </span>
      </div>
      <span className="text-[8px] text-muted-foreground/60 italic">
        Scan for digital receipt
      </span>
    </div>
  );
}

/** Build a plain-text version of the receipt for WhatsApp sharing */
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

  if (tx.paymentMethod === 'CASH' && opts?.cashReceived && opts.cashReceived > 0) {
    lines.push(`Cash Received:   ${formatKES(opts.cashReceived).padStart(14)}`);
    const change = opts.cashReceived - tx.totalAmount;
    if (change > 0) {
      lines.push(`Change:          ${formatKES(change).padStart(14)}`);
    }
  }

  if (tx.paymentMethod === 'MPESA') {
    if (opts?.mpesaReference) {
      lines.push(`M-Pesa Ref: ${opts.mpesaReference}`);
    }
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

// ─── Component ──────────────────────────────────────────────────────────────

export function EnhancedReceiptPrint({
  open,
  onOpenChange,
  transaction,
  cashReceived = 0,
  mpesaPhone = '',
  mpesaReference = '',
  giftCardCode = '',
  giftCardAmount = 0,
  voucherCode = '',
  voucherAmount = 0,
  storeId,
  onNewSale,
  autoPrint = false,
  thermalMode = false,
}: EnhancedReceiptProps) {
  const [isPrinting, setIsPrinting] = useState(false);
  const [copied, setCopied] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);
  const autoPrintTriggered = useRef(false);

  const store = STORE_LIST.find((s) => s.id === storeId);

  // ── Auto-print on dialog open ──
  useEffect(() => {
    if (open && autoPrint && !autoPrintTriggered.current) {
      autoPrintTriggered.current = true;
      const timer = setTimeout(() => {
        window.print();
      }, 500);
      return () => clearTimeout(timer);
    }
    if (!open) {
      autoPrintTriggered.current = false;
    }
  }, [open, autoPrint]);

  // ── Handlers ──

  const handlePrint = useCallback(() => {
    setIsPrinting(true);
    try {
      window.print();
    } finally {
      setTimeout(() => setIsPrinting(false), 1000);
    }
  }, []);

  const handleDownloadPDF = useCallback(() => {
    // Use browser print with PDF save option
    window.print();
  }, []);

  const handleShareWhatsApp = useCallback(() => {
    if (!transaction) return;
    const text = buildReceiptText(transaction, store, {
      cashReceived,
      mpesaReference,
      giftCardCode,
      giftCardAmount,
      voucherCode,
      voucherAmount,
    });
    const encoded = encodeURIComponent(text);
    const url = `https://wa.me/?text=${encoded}`;
    window.open(url, '_blank', 'noopener');
  }, [transaction, store, cashReceived, mpesaReference, giftCardCode, giftCardAmount, voucherCode, voucherAmount]);

  const handleCopyReceipt = useCallback(() => {
    if (!transaction) return;
    const text = buildReceiptText(transaction, store, {
      cashReceived,
      mpesaReference,
      giftCardCode,
      giftCardAmount,
      voucherCode,
      voucherAmount,
    });
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
  }, [transaction, store, cashReceived, mpesaReference, giftCardCode, giftCardAmount, voucherCode, voucherAmount]);

  const handleNewSale = useCallback(() => {
    onOpenChange(false);
    onNewSale();
  }, [onOpenChange, onNewSale]);

  // ── Font class for thermal mode ──
  const fontClass = thermalMode ? 'font-mono' : '';

  // ── Early return after all hooks ──
  if (!transaction) return null;

  const change = transaction.paymentMethod === 'CASH' && cashReceived > 0
    ? cashReceived - transaction.totalAmount
    : 0;

  // Compute taxable and exempt amounts for VAT breakdown
  const vatRate = 0.16;
  const taxableAmount = transaction.taxAmount / vatRate;
  const exemptAmount = Math.max(0, transaction.subtotal - taxableAmount);

  // ── Render ──

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
      description="Sale completed successfully. Print, share, or start a new sale."
      size="sm"
      footer={
        <div className="flex flex-wrap gap-2 w-full no-print">
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
            onClick={handleDownloadPDF}
            className="flex-1 min-w-[90px]"
          >
            <Download className="mr-1.5 h-4 w-4" />
            PDF
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
      {/* ─── Receipt Content (printable) ─── */}
      <div
        className={`receipt-printable space-y-3 text-sm ${fontClass}`}
        id="receipt-print-preview"
        ref={receiptRef}
      >
        {/* ─── Store Header / Logo Area ─── */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2">
            <Image
              src={COMPANY.logoPath}
              alt="MBUMAH HARDWARE logo"
              width={44}
              height={44}
              className="object-contain"
            />
            <div>
              <h2 className="text-lg font-extrabold tracking-wide leading-tight">
                MBUMAH HARDWARE
              </h2>
              <p className="text-[10px] text-muted-foreground font-medium tracking-widest uppercase">
                {COMPANY.tagline}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground font-medium">
            {store?.shortName || 'Juja Main Branch'}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {store?.location || ''}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Tel: {store?.phone || COMPANY.phone}
          </p>
          {store?.email && (
            <p className="text-[10px] text-muted-foreground">
              Email: {store.email}
            </p>
          )}
          {store?.taxPin && (
            <p className="text-[10px] text-muted-foreground font-mono">
              PIN: {store.taxPin}
            </p>
          )}
        </div>

        <Separator />

        {/* ─── Receipt Meta ─── */}
        <div className="space-y-1 text-xs">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground shrink-0">Receipt #:</span>
            <span className="font-mono font-semibold break-all text-right">
              {transaction.receiptNumber}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground shrink-0">Date:</span>
            <span className="text-right break-words">
              {formatDateTime(transaction.createdAt)}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground shrink-0">Cashier:</span>
            <span className="text-right break-words">
              {transaction.cashier?.name || 'N/A'}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground shrink-0">Customer:</span>
            <span className="text-right break-words">
              {transaction.customer?.name || 'Walk-in'}
            </span>
          </div>
        </div>

        <Separator />

        {/* ─── Line Items Table ─── */}
        <div className="space-y-1">
          {/* Table Header */}
          <div className="grid grid-cols-12 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-b pb-1">
            <span className="col-span-5">Item</span>
            <span className="col-span-1 text-center">Qty</span>
            <span className="col-span-3 text-center">Unit Price</span>
            <span className="col-span-3 text-right">Total</span>
          </div>
          {/* Table Rows */}
          {safeMap<SaleItemDetail, React.ReactElement>(transaction.items, (item) => (
            <div key={item.id} className="grid grid-cols-12 text-xs py-0.5">
              <span className="col-span-5 break-words pr-1">{item.productName}</span>
              <span className="col-span-1 text-center">{item.quantity}</span>
              <span className="col-span-3 text-center">{formatKES(item.pricePerUnit ?? 0)}</span>
              <span className="col-span-3 text-right font-medium">{formatKES(item.lineTotal)}</span>
            </div>
          ))}
        </div>

        <Separator />

        {/* ─── Totals with Tax Breakdown ─── */}
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatKES(transaction.subtotal)}</span>
          </div>

          {/* VAT Breakdown */}
          {taxableAmount > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span className="pl-2 text-[10px]">Taxable Amount</span>
              <span className="text-[10px]">{formatKES(taxableAmount)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT (16%)</span>
            <span>{formatKES(transaction.taxAmount)}</span>
          </div>
          {exemptAmount > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span className="pl-2 text-[10px]">Exempt/Zero-rated</span>
              <span className="text-[10px]">{formatKES(exemptAmount)}</span>
            </div>
          )}

          {/* Discount */}
          {transaction.discountAmount > 0 && (
            <div className="flex justify-between text-green-600 dark:text-green-400">
              <span>Discount</span>
              <span>-{formatKES(transaction.discountAmount)}</span>
            </div>
          )}

          {/* Voucher */}
          {voucherCode && voucherAmount > 0 && (
            <div className="flex justify-between text-purple-600 dark:text-purple-400">
              <span className="flex items-center gap-1">
                <Gift className="h-3 w-3" />
                Voucher ({voucherCode})
              </span>
              <span>-{formatKES(voucherAmount)}</span>
            </div>
          )}

          <Separator />

          {/* Grand Total */}
          <div className="flex justify-between font-bold text-base">
            <span>TOTAL</span>
            <span className="text-primary">{formatKES(transaction.totalAmount)}</span>
          </div>
        </div>

        <Separator />

        {/* ─── Payment Details ─── */}
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Payment Method</span>
            <PaymentMethodBadge method={transaction.paymentMethod} />
          </div>

          {/* Cash payment details */}
          {transaction.paymentMethod === 'CASH' && cashReceived > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cash Received</span>
                <span className="font-medium">{formatKES(cashReceived)}</span>
              </div>
              {change > 0 && (
                <div className="flex justify-between text-green-600 dark:text-green-400 font-semibold bg-green-50 dark:bg-green-950/20 -mx-1 px-1 py-0.5 rounded">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Change
                  </span>
                  <span>{formatKES(change)}</span>
                </div>
              )}
            </>
          )}

          {/* M-Pesa payment details */}
          {transaction.paymentMethod === 'MPESA' && (
            <>
              {mpesaPhone && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">M-Pesa Phone</span>
                  <span className="font-mono">{mpesaPhone}</span>
                </div>
              )}
              {mpesaReference && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">M-Pesa Ref</span>
                  <span className="font-mono font-medium text-green-600 dark:text-green-400">
                    {mpesaReference}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Split payment details */}
          {transaction.paymentMethod === 'SPLIT' && cashReceived > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cash Portion</span>
              <span>{formatKES(cashReceived)}</span>
            </div>
          )}

          {/* Gift card redemption details */}
          {giftCardCode && giftCardAmount > 0 && (
            <div className="flex justify-between bg-purple-50 dark:bg-purple-950/20 -mx-1 px-1 py-0.5 rounded">
              <span className="flex items-center gap-1 text-purple-700 dark:text-purple-300">
                <Gift className="h-3 w-3" />
                Gift Card ({giftCardCode})
              </span>
              <span className="text-purple-700 dark:text-purple-300">
                -{formatKES(giftCardAmount)}
              </span>
            </div>
          )}

          {/* Voucher redemption details */}
          {voucherCode && voucherAmount > 0 && (
            <div className="flex justify-between bg-amber-50 dark:bg-amber-950/20 -mx-1 px-1 py-0.5 rounded">
              <span className="text-amber-700 dark:text-amber-300">
                Voucher ({voucherCode})
              </span>
              <span className="text-amber-700 dark:text-amber-300">
                -{formatKES(voucherAmount)}
              </span>
            </div>
          )}
        </div>

        <Separator />

        {/* ─── Barcode/QR Placeholder ─── */}
        <BarcodeArea receiptNumber={transaction.receiptNumber} />

        <Separator />

        {/* ─── Footer ─── */}
        <div className="text-center space-y-2">
          <p className="font-semibold text-xs">
            Thank you for shopping at MBUMAH HARDWARE!
          </p>
          <p className="text-[10px] text-muted-foreground italic">Asante sana!</p>
          <p className="text-[10px] text-muted-foreground font-medium">
            Goods sold are not refundable
          </p>
          {store?.taxPin && (
            <p className="text-[9px] text-muted-foreground font-mono">
              ETR Invoice — KRA PIN: {store.taxPin}
            </p>
          )}
          <KenyanFlagBar />
        </div>
      </div>
    </ResponsiveDialog>
  );
}

// ─── Standalone Receipt Card (for embedding in other views) ─────────────────

export interface ReceiptCardProps {
  transaction: TransactionItem;
  storeId: string;
  cashReceived?: number;
  thermalMode?: boolean;
}

/**
 * A standalone receipt card that can be embedded in transaction history
 * views, email previews, or printed directly without a dialog wrapper.
 */
export function ReceiptCard({
  transaction,
  storeId,
  cashReceived = 0,
  thermalMode = false,
}: ReceiptCardProps) {
  const store = STORE_LIST.find((s) => s.id === storeId);
  const change = transaction.paymentMethod === 'CASH' && cashReceived > 0
    ? cashReceived - transaction.totalAmount
    : 0;
  const fontClass = thermalMode ? 'font-mono' : '';

  return (
    <Card className="receipt-printable w-full max-w-[80mm] mx-auto">
      <CardContent className={`p-4 space-y-2 text-sm ${fontClass}`}>
        {/* Header */}
        <div className="text-center space-y-0.5">
          <h3 className="text-sm font-extrabold tracking-wide">MBUMAH HARDWARE</h3>
          <p className="text-[10px] text-muted-foreground">{store?.shortName || 'Juja Main Branch'}</p>
          <p className="text-[10px] text-muted-foreground">{store?.location || ''}</p>
        </div>

        <Separator />

        {/* Meta */}
        <div className="space-y-0.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Receipt #:</span>
            <span className="font-mono font-semibold">{transaction.receiptNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Date:</span>
            <span>{formatDateTime(transaction.createdAt)}</span>
          </div>
        </div>

        <Separator />

        {/* Items */}
        <div className="space-y-0.5">
          <div className="grid grid-cols-12 text-[9px] font-bold text-muted-foreground uppercase border-b pb-0.5">
            <span className="col-span-6">Item</span>
            <span className="col-span-2 text-center">Qty</span>
            <span className="col-span-4 text-right">Total</span>
          </div>
          {safeMap<SaleItemDetail, React.ReactElement>(transaction.items, (item) => (
            <div key={item.id} className="grid grid-cols-12 text-[11px] py-0.5">
              <span className="col-span-6 break-words pr-1">{item.productName}</span>
              <span className="col-span-2 text-center">{item.quantity}</span>
              <span className="col-span-4 text-right font-medium">{formatKES(item.lineTotal)}</span>
            </div>
          ))}
        </div>

        <Separator />

        {/* Totals */}
        <div className="space-y-0.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatKES(transaction.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">VAT (16%)</span>
            <span>{formatKES(transaction.taxAmount)}</span>
          </div>
          {transaction.discountAmount > 0 && (
            <div className="flex justify-between text-green-600 dark:text-green-400">
              <span>Discount</span>
              <span>-{formatKES(transaction.discountAmount)}</span>
            </div>
          )}
          <Separator />
          <div className="flex justify-between font-bold">
            <span>TOTAL</span>
            <span className="text-primary">{formatKES(transaction.totalAmount)}</span>
          </div>
        </div>

        {/* Change */}
        {change > 0 && (
          <div className="flex justify-between text-xs text-green-600 dark:text-green-400 font-semibold">
            <span>Change</span>
            <span>{formatKES(change)}</span>
          </div>
        )}

        <Separator />

        {/* Footer */}
        <div className="text-center space-y-1">
          <p className="text-[10px] font-semibold">Thank you for shopping at MBUMAH HARDWARE!</p>
          <KenyanFlagBar />
        </div>
      </CardContent>
    </Card>
  );
}

// Re-export the original ReceiptPrintPreview for backward compatibility
export { ReceiptPrintPreview } from '@/components/receipt-print';
