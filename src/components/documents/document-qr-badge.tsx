'use client';

// DocumentQrBadge - on-screen scannable QR for business documents (v2.8.0,
// upgraded v2.10.0)
//
// SCANNING FIX (v2.8.0, client request): the receipt modal has always shown a
// LIVE scannable QR on screen, but the invoice / quotation / proforma / credit
// note / delivery-note view dialogs only embedded a QR inside the PRINT
// window - on screen there was "nothing displaying like the other one".
// This badge renders the SAME payload as the printed document
// (buildDocumentQrPayload) as a real, phone-scannable QR next to the doc
// details, with a one-tap copy fallback.
//
// v2.10.0: the payload for the five business documents (+ receipts and
// delivery notes) is now the URL of the public DIGITAL RECEIPT page
// (/r/<docNumber>), and the QR itself is a BUTTON - tapping it (or the
// "View receipt" button next to it) opens the DigitalReceiptViewer with
// scroll + autofit. The badge is shrink-0 so it can never be clipped or
// squeezed out of its row, and the whole thing is a comfortable 44px+ touch
// target.

import { useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Copy, Check, ScanLine } from 'lucide-react';
import { buildDocumentQrPayload } from '@/lib/document-print';

interface DocumentQrBadgeProps {
  /** Document kind, e.g. 'INVOICE' / 'DELIVERY_NOTE' / 'RECEIPT'. */
  kind: string;
  /** Document number, e.g. INV-2026-0001. */
  docNumber: string;
  /** Truthful total string for the verify payload, e.g. "Ksh 1,234.00". */
  total?: string;
  /** Document date string for the verify payload. */
  date?: string;
  /**
   * Called when the QR itself is tapped - opens the digital receipt viewer.
   * When provided, a "Tap to view" hint appears under the QR.
   */
  onView?: () => void;
  size?: number;
  className?: string;
}

export function DocumentQrBadge({
  kind,
  docNumber,
  total,
  date,
  onView,
  size = 96,
  className = '',
}: DocumentQrBadgeProps) {
  const [copied, setCopied] = useState(false);
  const payload = buildDocumentQrPayload(kind, docNumber, { total, date });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable - non-fatal */
    }
  };

  const qr = (
    <QRCodeCanvas
      value={payload}
      size={size}
      level="M"
      includeMargin={false}
      bgColor="#ffffff"
      fgColor="#1c1917"
    />
  );

  return (
    <div className={`flex shrink-0 flex-col items-center gap-1.5 ${className}`}>
      {onView ? (
        <button
          type="button"
          onClick={onView}
          title={`View the digital receipt for ${docNumber}`}
          aria-label={`View the digital receipt for ${docNumber}`}
          className="block rounded-lg bg-white p-1.5 shadow-sm border transition-all hover:shadow-md hover:ring-2 hover:ring-emerald-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 cursor-pointer"
        >
          {qr}
        </button>
      ) : (
        <div className="rounded-lg bg-white p-1.5 shadow-sm border">{qr}</div>
      )}
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <ScanLine className="h-3 w-3" aria-hidden="true" />
        <span>{onView ? 'Tap to view' : 'Scan to verify'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors"
          aria-label="Copy verification code"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-600" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
    </div>
  );
}
