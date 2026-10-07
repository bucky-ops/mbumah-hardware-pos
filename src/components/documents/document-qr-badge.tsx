'use client';

// ─────────────────────────────────────────────────────────────────────────────
// DocumentQrBadge — on-screen scannable QR for business documents (v2.8.0)
// ─────────────────────────────────────────────────────────────────────────────
//
// SCANNING FIX (client request): the receipt modal has always shown a LIVE
// scannable QR on screen, but the invoice / quotation / proforma / credit
// note / delivery-note view dialogs only embedded a QR inside the PRINT
// window — on screen there was "nothing displaying like the other one".
// This badge renders the SAME payload as the printed document
// (buildDocumentQrPayload) as a real, phone-scannable QR next to the doc
// details, with a one-tap copy fallback.
// ─────────────────────────────────────────────────────────────────────────────

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
  size?: number;
  className?: string;
}

export function DocumentQrBadge({
  kind,
  docNumber,
  total,
  date,
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
      /* clipboard unavailable — non-fatal */
    }
  };

  return (
    <div className={`flex flex-col items-center gap-1.5 ${className}`}>
      <div className="bg-white p-1.5 rounded-lg border shadow-sm">
        <QRCodeCanvas
          value={payload}
          size={size}
          level="M"
          includeMargin={false}
          bgColor="#ffffff"
          fgColor="#1c1917"
        />
      </div>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <ScanLine className="h-3 w-3" aria-hidden="true" />
        <span>Scan to verify</span>
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
