'use client';

/**
 * ReceiptPrintPreview — Professional receipt preview dialog for MBUMAH HARDWARE POS.
 *
 * Shows a formatted receipt after checkout with Print, Download PDF,
 * New Sale, and Share via WhatsApp actions. Includes print-specific CSS
 * so window.print() produces a clean, paper-ready receipt.
 */

import React from 'react';
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
} from 'lucide-react';
import Image from 'next/image';
import { formatKES, formatDateTime, type TransactionItem, type SaleItemDetail } from '@/lib/api';
import { STORE_LIST, COMPANY } from '@/lib/store-info';
import { safeMap } from '@/lib/app-config';

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

/** Build a plain-text version of the receipt for WhatsApp sharing */
function buildReceiptText(tx: TransactionItem, store: ReturnType<typeof STORE_LIST.find>): string {
  const lines: string[] = [];
  const divider = '─'.repeat(32);

  lines.push('        MBUMAH HARDWARE');
  lines.push(`  ${store?.shortName || 'Juja Main Branch'}`);
  lines.push(`  ${store?.location || ''}`);
  lines.push(`  Tel: ${store?.phone || COMPANY.phone}`);
  lines.push(divider);
  lines.push(`Receipt #: ${tx.receiptNumber}`);
  lines.push(`Date: ${formatDateTime(tx.createdAt)}`);
  lines.push(`Cashier: ${tx.cashier?.name || 'N/A'}`);
  lines.push(`Customer: ${tx.customer?.name || 'Walk-in'}`);
  lines.push(divider);

  if (tx.items?.length) {
    lines.push('Item                Qty   Total');
    for (const item of tx.items) {
      const name = item.productName.length > 18
        ? item.productName.slice(0, 18) + '…'
        : item.productName.padEnd(19);
      const qty = String(item.quantity).padStart(3);
      const total = formatKES(item.lineTotal).padStart(10);
      lines.push(`${name}${qty}${total}`);
    }
  }

  lines.push(divider);
  lines.push(`Subtotal:        ${formatKES(tx.subtotal).padStart(14)}`);
  lines.push(`VAT (16%):       ${formatKES(tx.taxAmount).padStart(14)}`);
  if (tx.discountAmount > 0) {
    lines.push(`Discount:       -${formatKES(tx.discountAmount).padStart(14)}`);
  }
  lines.push(`TOTAL:           ${formatKES(tx.totalAmount).padStart(14)}`);
  lines.push(divider);
  lines.push(`Payment: ${tx.paymentMethod}`);
  lines.push('');
  lines.push('Thank you for shopping at');
  lines.push('MBUMAH HARDWARE!');
  lines.push('Asante sana!');
  lines.push('Goods sold are not refundable.');

  return lines.join('\n');
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ReceiptPrintPreview({
  open,
  onOpenChange,
  transaction,
  cashReceived = 0,
  mpesaPhone = '',
  storeId,
  onNewSale,
}: ReceiptPrintPreviewProps) {
  if (!transaction) return null;

  const store = STORE_LIST.find((s) => s.id === storeId);
  const change = transaction.paymentMethod === 'CASH' && cashReceived > 0
    ? cashReceived - transaction.totalAmount
    : 0;

  // ── Handlers ──

  const handlePrint = () => {
    window.print();
  };

  const handleShareWhatsApp = () => {
    const text = buildReceiptText(transaction, store);
    const encoded = encodeURIComponent(text);
    const url = `https://wa.me/?text=${encoded}`;
    window.open(url, '_blank', 'noopener');
  };

  const handleNewSale = () => {
    onOpenChange(false);
    onNewSale();
  };

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
          <Button variant="outline" onClick={handlePrint} className="flex-1 min-w-[100px]">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          <Button variant="outline" className="flex-1 min-w-[100px]" disabled>
            <Download className="mr-2 h-4 w-4" />
            Download PDF
          </Button>
          <Button
            variant="outline"
            onClick={handleShareWhatsApp}
            className="flex-1 min-w-[100px] text-green-700 dark:text-green-400 border-green-300 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-950/30"
          >
            <Share2 className="mr-2 h-4 w-4" />
            WhatsApp
          </Button>
          <Button
            onClick={handleNewSale}
            className="flex-1 min-w-[100px] bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            New Sale
          </Button>
        </div>
      }
    >
      {/* ─── Receipt Content (printable) ─── */}
      <div className="receipt-printable space-y-3 text-sm" id="receipt-print-preview">
        {/* Store Header */}
        <div className="text-center space-y-1">
          {/* Logo + Store Name */}
          <div className="flex items-center justify-center gap-2">
            <Image
              src={COMPANY.logoPath}
              alt="MBUMAH HARDWARE logo"
              width={40}
              height={40}
              className="object-contain"
            />
            <div>
              <h2 className="text-lg font-extrabold tracking-wide leading-tight">MBUMAH HARDWARE</h2>
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
          <p className="text-xs font-semibold text-primary mt-1">
            Thank you for shopping with us!
          </p>
        </div>

        <Separator />

        {/* Receipt Meta */}
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

        {/* Line Items */}
        <div className="space-y-1">
          <div className="grid grid-cols-12 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-b pb-1">
            <span className="col-span-5">Item</span>
            <span className="col-span-2 text-center">Qty</span>
            <span className="col-span-2 text-center">Price</span>
            <span className="col-span-3 text-right">Total</span>
          </div>
          {safeMap<SaleItemDetail, React.ReactElement>(transaction.items, (item) => (
            <div key={item.id} className="grid grid-cols-12 text-xs py-0.5">
              <span className="col-span-5 break-words pr-1">{item.productName}</span>
              <span className="col-span-2 text-center">{item.quantity}</span>
              <span className="col-span-2 text-center">{formatKES(item.pricePerUnit ?? 0)}</span>
              <span className="col-span-3 text-right font-medium">{formatKES(item.lineTotal)}</span>
            </div>
          ))}
        </div>

        <Separator />

        {/* Totals */}
        <div className="space-y-1 text-xs">
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
          <div className="flex justify-between font-bold text-base">
            <span>TOTAL</span>
            <span className="text-primary">{formatKES(transaction.totalAmount)}</span>
          </div>
        </div>

        <Separator />

        {/* Payment Details */}
        <div className="space-y-1 text-xs">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Payment Method</span>
            <PaymentMethodBadge method={transaction.paymentMethod} />
          </div>
          {transaction.paymentMethod === 'CASH' && cashReceived > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cash Received</span>
                <span>{formatKES(cashReceived)}</span>
              </div>
              {change > 0 && (
                <div className="flex justify-between text-green-600 dark:text-green-400 font-semibold">
                  <span>Change</span>
                  <span>{formatKES(change)}</span>
                </div>
              )}
            </>
          )}
          {transaction.paymentMethod === 'MPESA' && mpesaPhone && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">M-Pesa Phone</span>
              <span>{mpesaPhone}</span>
            </div>
          )}
        </div>

        <Separator />

        {/* Footer */}
        <div className="text-center space-y-2">
          <p className="font-semibold text-xs">Thank you for shopping at MBUMAH HARDWARE!</p>
          <p className="text-[10px] text-muted-foreground italic">Asante sana!</p>
          <p className="text-[10px] text-muted-foreground font-medium">
            Goods sold are not refundable
          </p>
          {/* Kenyan flag accent bar */}
          <KenyanFlagBar />
        </div>
      </div>
    </ResponsiveDialog>
  );
}
