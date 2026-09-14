import type { ReceiptData } from "@/lib/types";

/**
 * Pure-TS ESC/POS receipt encoder (Task 3.1) — 80 mm thermal, 42 columns.
 *
 * NO DOM, NO Intl: all column arithmetic runs on plain string padding and
 * toFixed(2) money strings so the encoder behaves byte-identically in the
 * browser, a worker, or a Node-side bridge.
 *
 * Command set used (Epson ESC/POS reference):
 *   ESC @        initialize printer
 *   ESC t n      select code table (n=0 → CP437)
 *   ESC a n      justification (0 left, 1 center, 2 right)
 *   ESC ! n      print mode (n=0x08 → emphasis/bold; 0x00 → normal)
 *   GS  ! n      character size (0x11 → double width + double height)
 *   GS  ( k …    QR code: model, module size, error correction, store, print
 *   GS  V 66 n   partial cut (feed n units then cut)
 */

export const RECEIPT_WIDTH = 42;

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// ── CP437 text encoding ──────────────────────────────────────────────────────
// ESC/POS printers default to CP437, not UTF-8. Bytes 0x00–0x7F are identical
// to ASCII; higher code points are remapped through the table below, with
// unmapped characters replaced by "?" instead of silently corrupting columns.

const CP437_HIGH =
  "\u00C7\u00FC\u00E9\u00E2\u00E4\u00E0\u00E5\u00E7\u00EA\u00EB\u00E8\u00EF\u00EE\u00EC\u00C4\u00C5" +
  "\u00C9\u00E6\u00C6\u00F4\u00F6\u00F2\u00FB\u00F9\u00FF\u00D6\u00DC\u00A2\u00A3\u00A5\u20A7\u0192" +
  "\u00E1\u00ED\u00F3\u00FA\u00F1\u00D1\u00AA\u00BA\u00BF\u2310\u00AC\u00BD\u00BC\u00A1\u00AB\u00BB" +
  "\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255D\u255C\u255B\u2510" +
  "\u2514\u2534\u252C\u251C\u2500\u253C\u255E\u255F\u255A\u2554\u2569\u2566\u2560\u2550\u256C\u2567" +
  "\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256B\u256A\u2518\u250C\u2588\u2584\u258C\u2590\u2580" +
  "\u03B1\u00DF\u0393\u03C0\u03A3\u03C3\u00B5\u03C4\u03A6\u0398\u03A9\u03B4\u221E\u03C6\u03B5\u2229" +
  "\u2261\u00B1\u2265\u2264\u2320\u2321\u00F7\u2248\u00B0\u2219\u00B7\u221A\u207F\u00B2\u25A0\u00A0";

function cp437Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0x3f;
    if (code < 0x7f) {
      out.push(code);
      continue;
    }
    const idx = CP437_HIGH.indexOf(ch);
    out.push(idx >= 0 ? 0x80 + idx : 0x3f); // "?" fallback keeps columns intact
  }
  return new Uint8Array(out);
}

// ── byte plumbing ────────────────────────────────────────────────────────────

function concat(...chunks: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function bytesOf(text: string): Uint8Array {
  return cp437Bytes(text);
}

function line(text = ""): Uint8Array {
  return concat(bytesOf(text), new Uint8Array([LF]));
}

function raw(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

// ── column math (plain string padding — no Intl anywhere) ────────────────────

function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

function padRight(text: string, width: number): string {
  return text.length >= width ? truncate(text, width) : text + " ".repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

function center(text: string, width: number): string {
  if (text.length >= width) return truncate(text, width);
  const left = Math.floor((width - text.length) / 2);
  return " ".repeat(left) + text;
}

/** Fixed 2dp money string — toFixed keeps byte-length deterministic. */
function money(n: number): string {
  return n.toFixed(2);
}

/** Compact qty: integers bare, fractions up to 3dp with trailing zeros trimmed. */
function qtyText(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** ISO timestamp → "YYYY-MM-DD HH:MM:SS" without Intl. */
function timestampText(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

function dashes(): Uint8Array {
  return line("-".repeat(RECEIPT_WIDTH));
}

function align(mode: "left" | "center"): Uint8Array {
  return raw(ESC, 0x61, mode === "center" ? 0x01 : 0x00);
}

function emphasis(on: boolean): Uint8Array {
  return raw(ESC, 0x21, on ? 0x08 : 0x00);
}

function doubleSize(on: boolean): Uint8Array {
  return raw(GS, 0x21, on ? 0x11 : 0x00);
}

/** "LABEL ...... VALUE" row on the 42-column grid. */
function labelRow(label: string, value: string): Uint8Array {
  return line(padRight(label, RECEIPT_WIDTH - value.length) + value);
}

// ── eTIMS QR (GS ( k, model 2) ───────────────────────────────────────────────

/**
 * QR command implementing the Epson "GS ( k" model-2 sequence:
 *   model  : GS ( k pL pH cn fn n1 n2  → [29,40,107, 4,0, 49,65,50,0]  (cn=49, fn='A', model '2')
 *   size   : GS ( k pL pH cn fn n      → [29,40,107, 3,0, 49,67,6]     (fn='C', module size 6)
 *   error  : GS ( k pL pH cn fn n      → [29,40,107, 3,0, 49,69,49]    (fn='E', corr level 'L'=49)
 *   store  : GS ( k pL pH cn fn m data → pL/pH = (len(data)+3) as 2 LE bytes (fn='P')
 *   print  : GS ( k pL pH cn fn m n    → [29,40,107, 3,0, 49,81,48,49] (fn='Q')
 */
export function qrCommand(data: string): Uint8Array {
  const dataBytes = bytesOf(data);
  const storeLen = dataBytes.length + 3;
  const pL = storeLen & 0xff;
  const pH = (storeLen >> 8) & 0xff; // little-endian, per spec "data len LE 2 bytes"
  return concat(
    raw(GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0), // model: cn 49, fn 'A'(65), model '2'(50)
    raw(GS, 0x28, 0x6b, 3, 0, 49, 67, 6), //     size:  fn 'C'(67), module 6
    raw(GS, 0x28, 0x6b, 3, 0, 49, 69, 49), //    error correction level 49 ('L')
    raw(GS, 0x28, 0x6b, pL, pH, 49, 80, 48), // store: fn 'P'(80), m '0'(48)
    dataBytes,
    raw(GS, 0x28, 0x6b, 3, 0, 49, 81, 48, 49) // print: fn 'Q'(81), m 48, n 49
  );
}

// ── receipt builder ──────────────────────────────────────────────────────────

export function buildReceiptEscPos(receipt: ReceiptData): Uint8Array {
  const chunks: Uint8Array[] = [];

  // Init + CP437 code table, header block centered.
  chunks.push(raw(ESC, 0x40)); // ESC @ — initialize
  chunks.push(raw(ESC, 0x74, 0x00)); // ESC t 0 — CP437
  chunks.push(align("center"));

  chunks.push(emphasis(true));
  chunks.push(line("MBUMAH HARDWARE"));
  chunks.push(emphasis(false));

  chunks.push(line(receipt.branchName));
  if (receipt.branchLocation) chunks.push(line(receipt.branchLocation));

  // KRA eTIMS statutory block.
  chunks.push(line(`KRA PIN: ${receipt.kraPin}`));
  if (receipt.buyerPin) chunks.push(line(`BUYER PIN: ${receipt.buyerPin}`));
  chunks.push(line(`INVOICE: ${receipt.invoiceNumber}`));
  chunks.push(line(`CU-SN: ${receipt.cuSerial}`));
  chunks.push(line(`TAX CAT: ${receipt.taxCategories}`));
  chunks.push(line(`HS: ${truncate(receipt.hsCodesSummary, RECEIPT_WIDTH)}`));
  chunks.push(line(timestampText(receipt.createdAt)));
  chunks.push(line(`Cashier: ${receipt.cashier}`));
  if (receipt.customerName) chunks.push(line(`Customer: ${truncate(receipt.customerName, 32)}`));

  chunks.push(align("left"));
  chunks.push(dashes());

  // Items — 2 lines each: description (≤24 cols, eTIMS exempt marker " [A]"),
  // then qty×price left + line total right-aligned.
  const exemptMarker = receipt.taxCategories.includes("A") ? " [A]" : "";
  for (const item of receipt.lines) {
    chunks.push(line(truncate(item.description, 24) + exemptMarker));
    const left = ` ${qtyText(item.qty)}${item.uom} x ${money(item.unitPrice)}`;
    const right = money(item.lineNet);
    chunks.push(line(padRight(left, RECEIPT_WIDTH - right.length) + right));
  }

  chunks.push(dashes());

  // Totals block.
  chunks.push(labelRow("SUBTOTAL", money(receipt.grossSubtotal)));
  chunks.push(labelRow("DISCOUNT", money(receipt.discount)));
  chunks.push(labelRow(receipt.vatInclusive ? "VAT 16% (INCL)" : "VAT 16%", money(receipt.vat)));

  // TOTAL in double-height + double-width (GS ! 0x11). Double-width glyphs
  // halve the printable columns → the row must fit in RECEIPT_WIDTH / 2 chars.
  const halfWidth = Math.floor(RECEIPT_WIDTH / 2);
  const totalStr = `KES ${money(receipt.total)}`;
  const totalLine =
    totalStr.length >= halfWidth
      ? totalStr
      : padRight("TOTAL", halfWidth - totalStr.length) + totalStr;
  chunks.push(doubleSize(true));
  chunks.push(line(totalLine));
  chunks.push(doubleSize(false));

  // Payment lines with transaction references.
  for (const payment of receipt.payments) {
    chunks.push(labelRow(payment.method, money(payment.amount)));
    if (payment.reference) {
      chunks.push(line(`  REF: ${truncate(payment.reference, RECEIPT_WIDTH - 7)}`));
    }
  }
  chunks.push(
    receipt.balance > 0
      ? labelRow("BALANCE DUE", money(receipt.balance))
      : labelRow("CHANGE", money(receipt.balance))
  );

  // eTIMS QR payload, centered.
  const qrData = `TX:${receipt.ref}|TOTAL:${receipt.total.toFixed(2)}|DATE:${receipt.createdAt}`;
  chunks.push(align("center"));
  chunks.push(qrCommand(qrData));

  // Footer + paper feed + partial cut (GS V 66 0).
  chunks.push(line(""));
  chunks.push(line(center("This receipt is eTIMS compliant (Tax Invoice)", RECEIPT_WIDTH)));
  chunks.push(line(""));
  chunks.push(new Uint8Array([LF, LF, LF, LF])); // feed 4 lines before the cut
  chunks.push(raw(GS, 0x56, 66, 0)); // GS V 66 0 — feed 0 units, partial cut

  return concat(...chunks);
}

/** Base64 for embedding in JSON IPC (e.g. WS print agent payloads). */
export function escPosToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
