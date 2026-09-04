'use client';

/**
 * receipt-pdf — robust client-side receipt PDF generation & printing.
 *
 * WHY THIS EXISTS (incident: "Download Receipt" button did nothing / blank PDF):
 *   1. The old Download handler just called window.print() (or was disabled
 *      outright) — no PDF was ever produced.
 *   2. html2canvas (classic) cannot parse Tailwind v4's oklch() colors and
 *      throws "unsupported color function", producing a blank/broken canvas.
 *      We use html2canvas-pro, an API-compatible fork with oklch/lab support.
 *   3. Print isolation relied on a `.receipt-printable-wrapper` class that
 *      never existed in the dialog DOM, so @media print rules hid the entire
 *      dialog — the printed page came out blank. Printing now clones the
 *      receipt node into a dedicated #print-root container, and the print CSS
 *      shows ONLY that container (see globals.css).
 *
 * Pipeline (generateReceiptPdf):
 *   element → await fonts.ready → await <img> decode → html2canvas-pro
 *   (scale 2, white background) → jsPDF 80mm-wide page with dynamic height
 *   (thermal-receipt proportions) → pdf.save(`Receipt-<no>.pdf`).
 */

import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';

/** The printable receipt node carries this id (see ReceiptDocument). */
export const RECEIPT_CONTENT_ID = 'receipt-content';

/** Hidden container that hosts the receipt clone during window.print(). */
export const PRINT_ROOT_ID = 'print-root';

export interface GenerateReceiptPdfOptions {
  /** DOM id of the receipt node. Defaults to RECEIPT_CONTENT_ID. */
  elementId?: string;
  /** Output filename without extension. Defaults to `Receipt-<receiptNumber>`. */
  fileName?: string;
  /** Canvas render scale (2 = retina-quality). */
  scale?: number;
}

/**
 * Wait until every <img> inside `el` has finished loading (or errored) so the
 * canvas capture never misses the logo / QR images.
 */
async function waitForImages(el: HTMLElement, timeoutMs = 5000): Promise<void> {
  const imgs = Array.from(el.querySelectorAll('img'));
  await Promise.race([
    Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) return resolve();
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
          }),
      ),
    ),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/** Wait for web fonts so the capture uses the final glyphs. */
async function waitForFonts(timeoutMs = 3000): Promise<void> {
  try {
    await Promise.race([
      document.fonts?.ready ?? Promise.resolve(),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // Fonts are best-effort — capture proceeds with whatever is loaded.
  }
}

/**
 * Generate and download a PDF of the receipt element.
 * Throws on any failure — callers own the user-facing error UX
 * (console.error('[RECEIPT_DOWNLOAD_ERROR]') + toast/alert).
 */
export async function generateReceiptPdf(
  opts: GenerateReceiptPdfOptions = {},
): Promise<void> {
  const { elementId = RECEIPT_CONTENT_ID, fileName, scale = 2 } = opts;

  const receiptElement = document.getElementById(elementId);
  if (!receiptElement) {
    throw new Error(
      `Receipt DOM element #${elementId} not found — open the receipt dialog first.`,
    );
  }

  // Phase 1.3 — async fonts & images must be settled BEFORE capture.
  await waitForFonts();
  await waitForImages(receiptElement);

  const canvas = await html2canvas(receiptElement, {
    scale,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
  });

  const imgData = canvas.toDataURL('image/png');

  // Dynamic 80mm-wide thermal receipt page (height follows content).
  const widthMm = 80;
  const heightMm = Math.max(40, (canvas.height * widthMm) / canvas.width);

  const pdf = new jsPDF({
    orientation: heightMm > widthMm ? 'portrait' : 'landscape',
    unit: 'mm',
    format: [widthMm, heightMm],
  });
  pdf.addImage(imgData, 'PNG', 0, 0, widthMm, heightMm, undefined, 'FAST');

  pdf.save(fileName ? `${fileName}.pdf` : 'receipt.pdf');
}

/**
 * Build the canonical download filename for a receipt.
 * `Receipt-<receiptNumber || id>.pdf` — falls back defensively when the
 * transaction object is partially populated (offline sync edges).
 */
export function buildReceiptFileName(receiptNumber?: string | null, id?: string | null): string {
  const base = receiptNumber || id || 'transaction';
  return `Receipt-${base.replace(/[^a-zA-Z0-9._-]+/g, '-')}`;
}

/**
 * Print the receipt node via a print-root clone (see module docblock for why
 * the old pure-CSS approach printed blank pages). Canvases (the QR code)
 * cannot be cloneNode'd with their pixels — each is serialised to a
 * same-size <img> in the clone.
 */
export function printReceiptElement(elementId = RECEIPT_CONTENT_ID): void {
  const source = document.getElementById(elementId);
  if (!source) {
    throw new Error(`Receipt DOM element #${elementId} not found — open the receipt dialog first.`);
  }

  let printRoot = document.getElementById(PRINT_ROOT_ID);
  if (!printRoot) {
    printRoot = document.createElement('div');
    printRoot.id = PRINT_ROOT_ID;
    document.body.appendChild(printRoot);
  }
  printRoot.innerHTML = '';

  const clone = source.cloneNode(true) as HTMLElement;

  // Replace <canvas> nodes (QR code) with pixel-identical <img> — cloneNode
  // does NOT copy canvas bitmaps.
  const srcCanvases = source.querySelectorAll('canvas');
  const dstCanvases = clone.querySelectorAll('canvas');
  srcCanvases.forEach((canvas, i) => {
    const dst = dstCanvases[i];
    if (!dst) return;
    const img = document.createElement('img');
    try {
      img.src = canvas.toDataURL('image/png');
    } catch {
      // Tainted canvas (shouldn't happen — QR is local): leave blank.
    }
    img.width = canvas.width;
    img.height = canvas.height;
    img.style.width = canvas.style.width || `${canvas.width}px`;
    img.style.height = canvas.style.height || `${canvas.height}px`;
    img.setAttribute('aria-label', 'Receipt QR code');
    dst.replaceWith(img);
  });

  printRoot.appendChild(clone);

  const cleanup = () => {
    if (printRoot) printRoot.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // Safety valve: some engines fire afterprint unreliably for user-cancelled
  // dialogs — never leave the clone mounted for long.
  setTimeout(cleanup, 60_000);

  window.print();
}
