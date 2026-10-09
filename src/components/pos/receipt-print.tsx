'use client';

/**
 * EnhancedReceiptPrint - enhanced receipt dialog for MBUMAH HARDWARE POS.
 *
 * 2026-09 RECEIPT OVERHAUL: the branded, colored, QR-coded receipt markup
 * now lives in ONE shared component - <ReceiptDocument /> (see
 * src/components/receipt-print.tsx) - used by the checkout receipt modal,
 * the transaction-history viewer and this enhanced dialog. The Download
 * button runs the real PDF pipeline (html2canvas-pro -> jsPDF, see
 * src/lib/receipt-pdf.ts) instead of the old no-op window.print().
 *
 * v2.14.0 receipt-rendering spec alignment:
 *   - Action bar is a 2-column grid (auto-fit >= 720px), no fixed widths,
 *     no truncated labels at 320px (see .receipt-actions in globals.css).
 *   - Grand Total / Tendered / Change render in a PINNED strip outside the
 *     scrollable body (visible without scrolling at every width).
 *   - Share actions (Copy / WhatsApp / SMS) come from the shared
 *     ReceiptShareButtons (phone prompt when the customer has no phone on
 *     file, toast confirmations); the share text is the ONE shared builder
 *     (src/lib/receipt-share-text.ts) - the old duplicate is gone.
 *   - Primary CTA (New Sale) fill #C2410C with white text.
 *
 * This file keeps its richer props (M-Pesa reference, gift card, voucher,
 * auto-print) for callers that need them.
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ResponsiveDialog } from '@/components/ui/responsive-dialog';
import {
  Printer,
  Download,
  ShoppingCart,
  PartyPopper,
  Loader2,
  Usb,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime, type TransactionItem } from '@/lib/api';
import { STORE_LIST, COMPANY } from '@/lib/store-info';
import { toNum } from '@/lib/utils/financialMath';
import { RECEIPT_CONTENT_ID, generateReceiptPdf, buildReceiptFileName, printReceiptElement } from '@/lib/receipt-pdf';
import { ReceiptDocument, ReceiptTotalsStrip } from '@/components/receipt-print';
import { ReceiptShareButtons } from '@/components/receipt-share-buttons';
import { buildReceiptQrPayload } from '@/lib/receipt-qr';
import { buildReceiptEscpos, printReceiptViaUsb, hasUsbPrinting } from '@/lib/escpos';
import type { ReceiptData } from '@/lib/types';

// Props

export interface EnhancedReceiptProps {
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
  /** Current store ID - to look up branch info */
  storeId: string;
  /** Called when user clicks "New Sale" */
  onNewSale: () => void;
  /** Whether to auto-print on dialog open */
  autoPrint?: boolean;
  /** Whether to use monospace font (for thermal printers) */
  thermalMode?: boolean;
}

// Component

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
  const autoPrintTriggered = useRef(false);

  // v2.6.0: WebUSB ESC/POS thermal printing is Chromium-only - gate the
  // button so Firefox/Safari users never see a dead control.
  const [usbAvailable] = useState(() => hasUsbPrinting());

  const store = STORE_LIST.find((s) => s.id === storeId);

  // Auto-print on dialog open
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
    return undefined;
  }, [open, autoPrint, transaction]);

  // Handlers

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

  const shareTextOpts = useCallback(
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

  const handleNewSale = useCallback(() => {
    onOpenChange(false);
    onNewSale();
  }, [onOpenChange, onNewSale]);

  /**
   * v2.6.0 THERMAL PRINT (USB): serialise the receipt to raw ESC/POS bytes
   * and send them straight to a USB printer - NO print dialog, NO paper-size
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
        toast.success(`Sent to thermal printer (no print dialog)${result.deviceName ? ` - ${result.deviceName}` : ''}.`);
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
      pinned={
        <ReceiptTotalsStrip transaction={transaction} cashReceived={cashReceived} />
      }
      footer={
        // v2.14.0 action bar: 2-col grid (auto-fit >= 720px), no fixed
        // widths, labels never truncate at 320px.
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
          {usbAvailable && (
            <Button
              variant="outline"
              onClick={handleThermalPrint}
              disabled={isThermalPrinting}
              aria-label="Print receipt directly to a USB thermal printer without a print dialog"
              title="Send to USB thermal printer (ESC/POS, no print dialog)"
              className="h-9 w-full px-2 text-xs sm:px-3 sm:text-sm text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
            >
              {isThermalPrinting ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Usb className="h-4 w-4 shrink-0" />
              )}
              <span className="min-w-0">{isThermalPrinting ? 'Sending…' : 'Thermal USB'}</span>
            </Button>
          )}
          <ReceiptShareButtons
            transaction={transaction}
            store={store}
            buildOpts={shareTextOpts}
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
        Sale completed successfully. Receipt {transaction.receiptNumber}.
      </p>
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

// Standalone Receipt Card (for embedding in other views)

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
export { ReceiptPrintPreview } from '@/components/receipt-print';
