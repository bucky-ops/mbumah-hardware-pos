/**
 * document-print — shared branding kit for PRINTED business documents.
 *
 * Task 35-b: every printed business document (invoices, quotations, proformas,
 * credit notes, delivery notes, rental receipts) must be branded, detailed and
 * attractive, with a scannable QR code, the company logo and a thank-you note.
 * The POS receipt (src/components/receipt-print.tsx) already does this via a
 * React component — this module covers the raw-HTML print windows.
 *
 * CLIENT + SERVER SAFE: no 'use client', no DOM access at import time (all
 * `window` touches are guarded). The server route /api/reports/export-pdf
 * reuses `buildDocumentQrDataUrl` for statement QRs (base64 data URI, so the
 * printed HTML stays fully self-contained / offline-capable).
 *
 * QR PAYLOAD FORMATS
 * ──────────────────
 * • Transaction receipts (kind === 'RECEIPT')     → `<origin>/r/<receiptNumber>`
 *   (public digital-receipt page, same as receipt-qr.ts).
 * • ALL other documents → self-contained verify string, because there is no
 *   public page for these docs — the QR must carry the verification data:
 *   `MBUMAH|<KIND>|<docNumber>|Total:<total>|Date:<date>`
 */

import QRCode from 'qrcode';
import { COMPANY, STORE_LIST } from '@/lib/store-info';

// ─── HTML escaping ──────────────────────────────────────────────────────────

/** Escape a string for safe inclusion in raw HTML (shared implementation). */
export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── QR helpers ─────────────────────────────────────────────────────────────

export interface DocumentQrOptions {
  /** Truthful total to embed in the verify string (already formatted). */
  total?: string;
  /** Document date (already formatted). */
  date?: string;
}

/**
 * Builds the QR payload for a document.
 * Transaction receipts link to the public receipt page; every other document
 * carries its own verification data (see module header).
 */
export function buildDocumentQrPayload(
  kind: string,
  docNumber: string,
  opts?: DocumentQrOptions,
): string {
  const normalizedKind = String(kind || 'DOCUMENT').trim().toUpperCase();
  if (normalizedKind === 'RECEIPT' && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/r/${encodeURIComponent(docNumber)}`;
  }
  return [
    'MBUMAH',
    normalizedKind,
    docNumber,
    `Total:${opts?.total ?? '—'}`,
    `Date:${opts?.date ?? ''}`,
  ].join('|');
}

/**
 * Renders a payload to a PNG data-URI QR code (isomorphic — works in the
 * browser print window and on the server for statement HTML).
 */
export async function buildDocumentQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { width: 240, margin: 1, errorCorrectionLevel: 'M' });
}

// ─── Store identity ─────────────────────────────────────────────────────────

export interface DocumentStoreIdentity {
  storeName: string;
  storeLines: string[];
  taxPin?: string;
}

/**
 * Store identity for document headers — resolved from STORE_LIST by storeId,
 * falling back to company-wide fields (never a hardcoded branch).
 */
export function resolveDocumentStore(storeId: string | null | undefined): DocumentStoreIdentity {
  const store = storeId ? STORE_LIST.find((s) => s.id === storeId) : undefined;
  if (store) {
    const lines = [store.location, `Tel: ${store.phone}`];
    if (store.email) lines.push(store.email);
    return { storeName: store.name, storeLines: lines, taxPin: store.taxPin };
  }
  return {
    storeName: COMPANY.legalName,
    storeLines: [COMPANY.tagline, `Tel: ${COMPANY.phone}`, COMPANY.email, COMPANY.website],
  };
}

/** Absolute logo URL for print windows ('' on the server — callers skip it). */
export function getDocumentLogoSrc(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${COMPANY.logoPath}`;
  }
  return '';
}

// ─── Branded document builder ───────────────────────────────────────────────

export interface BrandedDocumentOptions {
  /** e.g. "INVOICE" / "QUOTATION" / "PROFORMA INVOICE" / "CREDIT NOTE". */
  docTypeLabel: string;
  /** Accent hex for the header band, table head and highlights (no blue/indigo). */
  accentColor: string;
  docNumber: string;
  /** Absolute logo URL (caller passes `${window.location.origin}/logo.png`). */
  logoSrc?: string;
  storeName: string;
  /** Location / phone / email lines shown under the store name. */
  storeLines: string[];
  taxPin?: string;
  /** Issued / due / status rows shown in the header band. */
  metaRows: { label: string; value: string }[];
  /** "BILL TO" body (escaped HTML built by the caller). */
  billToHtml: string;
  /** Full items <table> including thead/tbody (escaped HTML built by the caller). */
  itemsTableHtml: string;
  /** Totals block — `<div class="totals"><table>…<tr class="grand">…` . */
  totalsHtml: string;
  /** Optional notes / terms / extra sections between totals and signatures. */
  extraSectionsHtml?: string;
  /** Two signature line captions, e.g. ["Authorised Signature", "Customer Acceptance"]. */
  signatureLabels?: [string, string];
  /** QR data-URI (from buildDocumentQrDataUrl). Rendered when non-empty. */
  qrDataUrl: string;
  qrCaption?: string;
  /** Optional extra line above the generated-by footer. */
  footerNote?: string;
}

const THANKS_POLICY_LINE =
  'Please retain this document — returns are accepted within 14 days with the original receipt. Warranted goods per manufacturer terms.';

/**
 * Builds a COMPLETE standalone branded HTML document (inline <style>, print
 * CSS with @page margin 12mm and exact color printing). Everything the caller
 * passes is escaped here or must already be escaped by the caller.
 */
export function buildBrandedDocumentHtml(opts: BrandedDocumentOptions): string {
  const accent = opts.accentColor || '#ea580c';
  const generatedAt = `${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })} (EAT)`;

  const logoHtml = opts.logoSrc
    ? `<span class="logo-box"><img src="${escapeHtml(opts.logoSrc)}" alt="Company logo" /></span>`
    : '';
  const storeLinesHtml = (opts.storeLines || [])
    .filter(Boolean)
    .map((line) => `<div class="store-line">${escapeHtml(line)}</div>`)
    .join('');
  const taxPinHtml = opts.taxPin
    ? `<div class="store-line">KRA PIN: ${escapeHtml(opts.taxPin)}</div>`
    : '';
  const metaRowsHtml = (opts.metaRows || [])
    .filter((row) => row && row.label)
    .map(
      (row) =>
        `<div class="meta-row"><span class="meta-label">${escapeHtml(row.label)}:</span> ${escapeHtml(
          row.value ?? '',
        )}</div>`,
    )
    .join('');
  const signaturesHtml = opts.signatureLabels?.length
    ? `<div class="signatures">${opts.signatureLabels
        .map((label) => `<div><div class="sig-line">${escapeHtml(label)}</div></div>`)
        .join('')}</div>`
    : '';
  const qrCardHtml = opts.qrDataUrl
    ? `<div class="qr-card">
        <img src="${escapeHtml(opts.qrDataUrl)}" alt="Verification QR code" />
        <div class="qr-caption">${escapeHtml(opts.qrCaption || 'Scan to verify this document')}</div>
        <div class="qr-doc">${escapeHtml(opts.docNumber)}</div>
      </div>`
    : '';
  const extraHtml = opts.extraSectionsHtml || '';
  const footerNoteHtml = opts.footerNote
    ? `<div class="footer-note">${escapeHtml(opts.footerNote)}</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(opts.docTypeLabel)} ${escapeHtml(opts.docNumber)} — MBUMAH HARDWARE</title>
  <style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { margin: 12mm; }
    body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, Helvetica, sans-serif; color: #1f2937; background: #fff; margin: 0; padding: 18px; font-size: 13px; }
    .doc-band { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; border-radius: 12px; padding: 18px 22px; color: #fff; background: ${accent}; }
    .doc-band .brand { display: flex; align-items: center; gap: 14px; }
    .logo-box { background: #fff; border-radius: 10px; padding: 6px 8px; display: inline-block; }
    .logo-box img { display: block; max-width: 78px; max-height: 78px; }
    .store-name { font-size: 21px; font-weight: 800; letter-spacing: .4px; line-height: 1.15; }
    .store-branch { font-size: 13px; font-weight: 600; opacity: .95; margin-top: 1px; }
    .store-line { font-size: 11px; opacity: .9; line-height: 1.55; }
    .doc-meta { text-align: right; min-width: 210px; }
    .doc-type { display: inline-block; background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.6); border-radius: 999px; padding: 3px 14px; font-size: 12px; font-weight: 800; letter-spacing: 1.4px; }
    .doc-number { font-family: 'Courier New', monospace; font-weight: 700; font-size: 15px; margin-top: 7px; letter-spacing: .5px; }
    .meta-row { font-size: 11.5px; opacity: .96; margin-top: 2px; }
    .meta-label { opacity: .82; }
    .section-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; margin: 18px 0 6px; }
    .billto { font-size: 13px; line-height: 1.55; }
    .billto .who { font-weight: 700; font-size: 14px; }
    .muted { color: #6b7280; font-size: 12px; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0 4px; }
    table.items th { background: ${accent}; color: #fff; text-align: left; padding: 8px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; border: 1px solid ${accent}; }
    table.items td { padding: 7px 10px; border: 1px solid #e5e7eb; font-size: 12px; vertical-align: top; }
    table.items tbody tr:nth-child(even) td { background: #f8fafc; }
    .totals { display: flex; justify-content: flex-end; margin-top: 10px; }
    .totals table { width: 320px; margin: 0; }
    .totals td { border: none; padding: 4px 10px; font-size: 12.5px; }
    .totals .grand td { border-top: 2px solid #111827; font-weight: 800; font-size: 14.5px; padding-top: 8px; }
    .note-block { margin-top: 12px; font-size: 12px; line-height: 1.55; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 46px; }
    .sig-line { border-top: 1px solid #9ca3af; margin-top: 30px; padding-top: 5px; text-align: center; font-size: 11px; color: #6b7280; }
    .qr-card { width: 250px; margin: 26px auto 0; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; text-align: center; }
    .qr-card img { width: 110px; height: 110px; display: block; margin: 0 auto; }
    .qr-caption { font-size: 11px; font-weight: 600; color: #374151; margin-top: 8px; }
    .qr-doc { font-family: 'Courier New', monospace; font-size: 11px; color: #6b7280; margin-top: 2px; word-break: break-all; }
    .thanks { text-align: center; margin-top: 24px; border-top: 1px dashed #d1d5db; padding-top: 16px; }
    .thanks-big { font-size: 16px; font-weight: 800; color: #111827; }
    .thanks-asante { font-style: italic; font-size: 13.5px; margin-top: 3px; color: ${accent}; }
    .thanks-policy { font-size: 10.5px; color: #9ca3af; margin-top: 7px; }
    .doc-footer { margin-top: 22px; border-top: 1px solid #e5e7eb; padding-top: 10px; text-align: center; font-size: 10.5px; color: #9ca3af; }
    .footer-note { margin-bottom: 4px; }
    @media print {
      body { padding: 0; }
      .doc-band { border-radius: 0; }
      table.items thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="doc-band">
    <div class="brand">
      ${logoHtml}
      <div>
        <div class="store-name">${escapeHtml(COMPANY.legalName)}</div>
        <div class="store-branch">${escapeHtml(opts.storeName)}</div>
        ${storeLinesHtml}
        ${taxPinHtml}
      </div>
    </div>
    <div class="doc-meta">
      <span class="doc-type">${escapeHtml(opts.docTypeLabel)}</span>
      <div class="doc-number">${escapeHtml(opts.docNumber)}</div>
      ${metaRowsHtml}
    </div>
  </div>

  <div class="section-label">Bill To</div>
  <div class="billto">${opts.billToHtml}</div>

  ${opts.itemsTableHtml}
  ${opts.totalsHtml}
  ${extraHtml}

  ${signaturesHtml}
  ${qrCardHtml}

  <div class="thanks">
    <div class="thanks-big">Thank you for your business!</div>
    <div class="thanks-asante">Asante sana! 🇰🇪</div>
    <div class="thanks-policy">${escapeHtml(THANKS_POLICY_LINE)}</div>
  </div>

  <div class="doc-footer">
    ${footerNoteHtml}
    <div>Generated by MBUMAH HARDWARE POS &amp; ERP · ${escapeHtml(generatedAt)}</div>
  </div>
</body>
</html>`;
}

// ─── Print window ───────────────────────────────────────────────────────────

/**
 * Opens a print window and prints a complete HTML document.
 * Returns false when the pop-up is blocked (caller shows the toast).
 * `windowSize` defaults to a full-page 820×920 window; narrow thermal-style
 * receipts pass { width: 400, height: 640 }.
 */
export function printHtmlDocument(
  html: string,
  title: string,
  windowSize?: { width: number; height: number },
): boolean {
  if (typeof window === 'undefined') return false;
  const size = windowSize || { width: 820, height: 920 };
  const printWindow = window.open('', '_blank', `width=${size.width},height=${size.height}`);
  if (!printWindow) return false;
  // The built documents already carry their own <title>; inject one only when
  // the caller passes a bare fragment so the window/print job is labelled.
  const withTitle = /<title[\s>]/i.test(html)
    ? html
    : html.replace(/<head([^>]*)>/i, `<head$1><title>${escapeHtml(title)}</title>`);
  printWindow.document.write(withTitle);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
  return true;
}
