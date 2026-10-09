'use client';

/**
 * document-pdf - A4 PDF download for branded business documents (v2.8.0).
 *
 * CLIENT REQUEST: "Add Download PDF option on all invoices and on Delivery
 * invoices/notes." Those documents are built as standalone branded HTML
 * strings (document-print.buildBrandedDocumentHtml) and printed via a popup
 * window - there was no DOM node to canvas-capture and no PDF path at all.
 *
 * Pipeline (generateDocumentPdf):
 *   branded HTML → extract <style> + <body> → mount offscreen A4-width
 *   container → fonts/imgs settle → html2canvas-pro (oklch-safe, same fork
 *   as receipt-pdf) → jsPDF A4 with multi-page slicing → pdf.save().
 *
 * The branded documents carry their own inline styles, so the offscreen
 * mount renders pixel-identically to the print window.
 */

import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';

/** A4 portrait geometry @96dpi: 210mm → 794px wide, 297mm → 1123px high. */
const A4_WIDTH_PX = 794;

/** Extract the <style>…</style> block from a full HTML document string. */
function extractStyle(html: string): string {
  const match = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  return match ? match[1] : '';
}

/** Extract the <body>…</body> inner HTML from a full HTML document string. */
function extractBody(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[1] : html;
}

/** Wait until every <img> inside `el` has finished loading (or errored). */
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
    // Fonts are best-effort - capture proceeds with whatever is loaded.
  }
}

export interface GenerateDocumentPdfOptions {
  /** Complete branded HTML document (from buildBrandedDocumentHtml). */
  html: string;
  /** Output filename without extension. */
  fileName: string;
  /** Canvas render scale (2 = retina-quality). */
  scale?: number;
}

/**
 * Generate and download an A4 PDF of a branded business document.
 * Throws on any failure - callers own the user-facing error UX.
 */
export async function generateDocumentPdf(
  opts: GenerateDocumentPdfOptions,
): Promise<void> {
  const { html, fileName, scale = 2 } = opts;
  if (typeof window === 'undefined') {
    throw new Error('PDF generation is browser-only.');
  }

  // 1. Mount an offscreen A4-width container carrying the document's own CSS.
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'top:0',
    `width:${A4_WIDTH_PX}px`,
    'background:#ffffff',
    'z-index:-1',
  ].join(';');
  // The branded doc styles target plain tags/classes - scope them under the
  // host by injecting the extracted <style> verbatim plus a body reset.
  const style = extractStyle(html);
  const body = extractBody(html);
  host.innerHTML = `<style>${style}</style><div class="pdf-doc-root">${body}</div>`;
  // Neutralise the doc's own body padding inside the capture root.
  const root = host.querySelector('.pdf-doc-root') as HTMLElement;
  root.style.padding = '18px';
  root.style.background = '#ffffff';
  document.body.appendChild(host);

  try {
    // 2. Let fonts and images settle so nothing captures blank.
    await waitForFonts();
    await waitForImages(root);

    // 3. Capture at A4 width.
    const canvas = await html2canvas(root, {
      scale,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: A4_WIDTH_PX,
    });

    // 4. jsPDF A4 portrait, slicing the tall capture across pages.
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();   // 210mm
    const pageH = pdf.internal.pageSize.getHeight();  // 297mm
    const pxPerMm = canvas.width / pageW;
    const pageHeightPx = Math.floor(pageH * pxPerMm);
    const totalPages = Math.max(1, Math.ceil(canvas.height / pageHeightPx));

    for (let page = 0; page < totalPages; page += 1) {
      const sliceTop = page * pageHeightPx;
      const sliceHeight = Math.min(pageHeightPx, canvas.height - sliceTop);
      if (sliceHeight <= 0) break;

      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = sliceHeight;
      const ctx = sliceCanvas.getContext('2d');
      if (!ctx) throw new Error('Could not create 2D context for PDF slicing.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(
        canvas,
        0,
        sliceTop,
        canvas.width,
        sliceHeight,
        0,
        0,
        canvas.width,
        sliceHeight,
      );

      if (page > 0) pdf.addPage();
      pdf.addImage(
        sliceCanvas.toDataURL('image/jpeg', 0.95),
        'JPEG',
        0,
        0,
        pageW,
        (sliceHeight / pxPerMm),
        undefined,
        'FAST',
      );
    }

    pdf.save(`${fileName}.pdf`);
  } finally {
    host.remove();
  }
}

/** Canonical download filename for a document, e.g. `Invoice-INV-2026-0001`. */
export function buildDocumentFileName(docLabel: string, docNumber: string): string {
  const clean = `${docLabel}-${docNumber}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
  return clean;
}
