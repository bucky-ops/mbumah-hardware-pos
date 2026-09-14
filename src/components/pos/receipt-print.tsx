'use client';

/**
 * EnhancedReceiptPrint — enhanced receipt dialog for MBUMAH HARDWARE POS.
 *
 * 2026-09 RECEIPT OVERHAUL: the branded, colored, QR-coded receipt markup
 * now lives in ONE shared component — <ReceiptDocument /> (see
 * src/components/receipt-print.tsx) — used by the checkout receipt modal,
 * the transaction-history viewer and this enhanced dialog. The Download
 * button runs the real PDF pipeline (html2canvas-pro → jsPDF, see
 * src/lib/receipt-pdf.ts) instead of the old no-op window.print().
 *
 * This file keeps its richer props (M-Pesa reference, gift card, voucher,
 * auto-print, thermal monospace) for callers that need them.
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import {
  Printer,
  Download,
  ShoppingCart,
  Share2,
  PartyPopper,
  Copy,
  Check,
  Loader2,
  MessageSquare,
  Usb,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatKES, formatDateTime, openSMS, type TransactionItem } from '@/lib/api';
import { STORE_LIST, COMPANY, type StoreInfo } from '@/lib/store-info';
import { toNum, changeDue as changeDueOf } from '@/lib/utils/financialMath';
import { RECEIPT_CONTENT_ID, generateReceiptPdf, buildReceiptFileName, printReceiptElement } from '@/lib/receipt-pdf';
import { ReceiptDocument, ReceiptPrintPreview } from '@/components/receipt-print';
import { buildReceiptQrPayload } from '@/lib/receipt-qr';
import { buildReceiptEscpos, printReceiptViaUsb, hasUsbPrinting } from '@/lib/escpos';
import type { ReceiptData } from '@/lib/types';

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
    // FINANCIAL MATH AUDIT: server-persisted tender/change preferred (spec §4).
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
}: EnhancedReceiptProps) {
  const [isPrinting, setIsPrinting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isThermalPrinting, setIsThermalPrinting] = useState(false);
  const [copied, setCopied] = useState(false);
  const autoPrintTriggered = useRef(false);

  // v2.6.0: WebUSB ESC/POS thermal printing is Chromium-only — gate the
  // button so Firefox/Safari users never see a dead control.
  const [usbAvailable] = useState(() => hasUsbPrinting());

  const store = STORE_LIST.find((s) => s.id === storeId);

  // ── Auto-print on dialog open ──
  useEffect(() => {
    if (open && autoPrint && !autoPrintTriggered.current && transaction) {
      autoPrintTriggered.current = true;
      const timer = setTimeout(() => {
        try {
          printReceiptElement(RECEIPT_CONTENT_ID);
        } catch (error) {
          console.error('[RECEIPT_PRINT_ERROR]', error);
        }
      }, 500);
      return () => clearTimeout(timer);
    }
    if (!open) {
      autoPrintTriggered.current = false;
    }
  }, [open, autoPrint, transaction]);

  // ── Handlers ──

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

  const receiptTextOpts = useCallback(
    () => ({
      cashReceived,
      mpesaReference,
      giftCardCode,
      giftCardAmount,
      voucherCode,
      voucherAmount,
    }),
    [cashReceived, mpesaReference, giftCardCode, giftCardAmount, voucherCode, voucherAmount],
  );

  const handleShareWhatsApp = useCallback(() => {
    if (!transaction) return;
    const text = buildReceiptText(transaction, store, receiptTextOpts());
    const encoded = encodeURIComponent(text);
    const url = `https://wa.me/?text=${encoded}`;
    window.open(url, '_blank', 'noopener');
  }, [transaction, store, receiptTextOpts]);

  // SMS twin of handleShareWhatsApp — same richer receipt text opened as an
  // sms: deep link; empty phone => `sms:?body=…` app chooser (same UX as the
  // wa.me share).
  const handleShareSms = useCallback(() => {
    if (!transaction) return;
    const text = buildReceiptText(transaction, store, receiptTextOpts());
    openSMS('', text);
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

  /**
   * v2.6.0 THERMAL PRINT (USB): serialise the receipt to raw ESC/POS bytes
   * and send them straight to a USB printer — NO print dialog, NO paper-size
   * fight with the OS. Complements (never replaces) the window.print and PDF
   * flows, which remain the fallback for A4/email-cabin printers.
   */
  const handleThermalPrint = useCallback(async () => {
    if (!transaction) return;
    setIsThermalPrinting(true);
    try {
      const receipt: ReceiptData = {
        storeName: store?.name || 'MBUMAH HARDWARE',
        storeLocation: store?.location || '',
        storePhone: store?.phone || COMPANY.phone,
        receiptNumber: transaction.receiptNumber,
        date: formatDateTime(transaction.createdAt),
        cashier: transaction.cashier?.name || 'N/A',
        customer: transaction.customer?.name,
        items: (transaction.items ?? []).map((item) => ({
          name: item.productName,
          quantity: toNum(item.quantity),
          unitType: item.unitType,
          pricePerUnit: toNum(item.pricePerUnit),
          lineTotal: toNum(item.lineTotal),
        })),
        subtotal: toNum(transaction.subtotal),
        taxAmount: toNum(transaction.taxAmount),
        discountAmount: toNum(transaction.discountAmount),
        total: toNum(transaction.totalAmount),
        paymentMethod: transaction.paymentMethod,
        footer: 'Thank you for shopping at MBUMAH HARDWARE!',
      };
      const escposBytes = buildReceiptEscpos(receipt, {
        qrText: buildReceiptQrPayload(transaction),
        etimsStatus: transaction.etimsStatus ?? null,
      });
      const result = await printReceiptViaUsb(escposBytes);
      if (result.ok) {
        toast.success(`Sent to thermal printer (no print dialog)${result.deviceName ? ` — ${result.deviceName}` : ''}.`);
      } else {
        toast.error(result.error || 'Could not send the receipt to the thermal printer.');
      }
    } catch (error) {
      console.error('[RECEIPT_THERMAL_PRINT_ERROR]', error);
      toast.error('Could not build or send the ESC/POS receipt. Use Print or PDF instead.');
    } finally {
      setIsThermalPrinting(false);
    }
  }, [transaction, store]);

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
          {usbAvailable && (
            <Button
              variant="outline"
              onClick={handleThermalPrint}
              disabled={isThermalPrinting}
              aria-label="Print receipt directly to a USB thermal printer without a print dialog"
              title="Send to USB thermal printer (ESC/POS, no print dialog)"
              className="flex-1 min-w-[90px] text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
            >
              {isThermalPrinting ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Usb className="mr-1.5 h-4 w-4" />
              )}
              {isThermalPrinting ? 'Sending…' : 'Thermal Print (USB)'}
            </Button>
          )}
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
            variant="outline"
            onClick={handleShareSms}
            aria-label="Send receipt via SMS"
            title="Send receipt via SMS"
            className="flex-1 min-w-[90px] text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
          >
            <MessageSquare className="mr-1.5 h-4 w-4" />
            SMS
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
        mpesaReference={mpesaReference}
        giftCardCode={giftCardCode}
        giftCardAmount={giftCardAmount}
        voucherCode={voucherCode}
        voucherAmount={voucherAmount}
      />
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
 * Renders the same branded ReceiptDocument used by the receipt dialogs.
 */
export function ReceiptCard({
  transaction,
  storeId,
  cashReceived = 0,
}: ReceiptCardProps) {
  return (
    <div className="w-full max-w-[80mm] mx-auto">
      <ReceiptDocument
        transaction={transaction}
        storeId={storeId}
        cashReceived={cashReceived}
      />
    </div>
  );
}

// Re-export the canonical receipt preview for backward compatibility
export { ReceiptPrintPreview };
