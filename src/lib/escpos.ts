// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — ESC/POS receipt builder + WebUSB thermal printing
// ─────────────────────────────────────────────────────────────────────────────
//
// v2.6.0: thermal-print receipts DIRECTLY to a USB ESC/POS printer from the
// browser (no print dialog, no 80mm PDF round-trip). Two parts:
//
//   buildReceiptEscpos(receipt, opts) — serialises a ReceiptData into raw
//     ESC/POS bytes (init → centered bold double-size header → meta lines →
//     42-column item rows → bold totals → payment → eTIMS notice → optional
//     QR → footer → partial cut). Text is ASCII-sanitised (KES amounts are
//     plain "KES 1,234.00" — no encoding surprises on cheap thermal heads).
//
//   printReceiptViaUsb(bytes) — WebUSB: requestDevice (printer classCode 7,
//     with a fallback to previously-paired devices) → open → claimInterface
//     → transferOut → close. No `any`, no new deps — minimal structural
//     types are defined here because @types/w3c-web-usb is not installed.
//
// Browser support: Chrome/Edge (and Chromium kiosks — the typical POS setup).
// hasUsbPrinting() gates the UI so Firefox/Safari just never see the button.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReceiptData } from './types';

// ── Minimal structural WebUSB types (no `any`, no new dependency) ───────────

interface UsbEndpointLike {
  readonly direction: 'in' | 'out';
  readonly endpointNumber: number;
  readonly type?: 'bulk' | 'interrupt' | 'isochronous' | string;
}

interface UsbAlternateLike {
  readonly alternateSetting?: number;
  readonly interfaceClass?: number;
  readonly endpoints?: readonly UsbEndpointLike[];
}

interface UsbInterfaceLike {
  readonly interfaceNumber: number;
  readonly alternate?: UsbAlternateLike;
  readonly alternates?: readonly UsbAlternateLike[];
}

interface UsbConfigurationLike {
  readonly configurationValue?: number;
  readonly interfaces?: readonly UsbInterfaceLike[];
}

interface UsbDeviceLike {
  readonly productName?: string | null;
  readonly manufacturerName?: string | null;
  readonly opened?: boolean;
  readonly configuration?: UsbConfigurationLike;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration?(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<{
    readonly bytesWritten: number;
    readonly status?: 'ok' | 'stall' | 'babble' | string;
  }>;
}

interface UsbLike {
  requestDevice(options: {
    filters: ReadonlyArray<{ classCode?: number; vendorId?: number; productId?: number }>;
  }): Promise<UsbDeviceLike>;
  getDevices(): Promise<readonly UsbDeviceLike[]>;
}

/** Navigator with the (Chromium-only) WebUSB API — feature-detected, never assumed. */
type NavigatorWithUsb = Navigator & { readonly usb?: UsbLike };

/** ESC/POS printer device class (USB Class 7 = Printer). */
const USB_PRINTER_CLASS = 7;
/** 80mm thermal heads accept ~32KB per transfer; chunk well below that. */
const TRANSFER_CHUNK_BYTES = 8192;

// ── ESC/POS command primitives ──────────────────────────────────────────────

const ESC = 0x1b;
const GS = 0x1d;

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

const CMD_INIT = bytes(ESC, 0x40); // ESC @ — initialize printer
const CMD_ALIGN_CENTER = bytes(ESC, 0x61, 0x01); // ESC a 1
const CMD_ALIGN_LEFT = bytes(ESC, 0x61, 0x00); // ESC a 0
const CMD_BOLD_ON = bytes(ESC, 0x45, 0x01); // ESC E 1
const CMD_BOLD_OFF = bytes(ESC, 0x45, 0x00); // ESC E 0
const CMD_SIZE_DOUBLE = bytes(GS, 0x21, 0x11); // GS ! 0x11 — double width + height
const CMD_SIZE_NORMAL = bytes(GS, 0x21, 0x00); // GS ! 0
const CMD_FEED_LINES = (n: number): Uint8Array => bytes(ESC, 0x64, n); // ESC d n
/** GS V B 0 — partial cut (leaves the ticket holding; safer on cheap cutters). */
const CMD_PARTIAL_CUT = bytes(GS, 0x56, 0x42, 0x00);

/** Receipt width for an 80mm head in 12×24 font = 42 columns. */
const COLUMNS = 42;

const encoder = new TextEncoder();

/** Strip everything outside printable ASCII — cheap thermal heads choke on UTF-8. */
function asciiSafe(text: string): string {
  return text.replace(/[^\x20-\x7E]/g, '');
}

const textBytes = (text: string): Uint8Array => encoder.encode(asciiSafe(text));
const textLine = (text: string): Uint8Array => encoder.encode(`${asciiSafe(text)}\n`);

/** Truncate (never ellipsize — heads don't have the glyph) to a column count. */
function truncate(text: string, max: number): string {
  const safe = asciiSafe(text);
  return safe.length > max ? safe.slice(0, max) : safe;
}

/** Plain KES money — formatKES uses "Ksh …" + non-breaking spaces; keep ASCII. */
function money(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return safe.toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Build a QR block using the ESC/POS "GS ( k" QR-code command set:
 *   fn 65 (model), fn 67 (module size), fn 69 (error correction), fn 80
 *   (store data), fn 81 (print). Data must be ASCII-safe — QR payload here is
 *   the receipt verification URL.
 */
function qrBlock(text: string): Uint8Array[] {
  const data = textBytes(text);
  const len = data.length + 3; // pH + cn fn + m … payload length for fn 80/81
  const pL = len & 0xff;
  const pH = (len >> 8) & 0xff;
  return [
    bytes(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00), // model 2
    bytes(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06), // module size 6
    bytes(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31), // error correction M
    bytes(GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30), // store data header
    data,
    bytes(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30), // print
  ];
}

/**
 * One item row: `name ................ qty x price` wrapped within 42
 * columns. Long names wrap onto a continuation line indented under the
 * leader column so alignment is never broken.
 */
function itemRowLines(name: string, quantity: number, price: number): Uint8Array[] {
  const qty = Number.isFinite(quantity) ? quantity : 0;
  const qtyLabel = Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(3)));
  const right = `${qtyLabel} x ${money(price)}`;
  const rightWidth = right.length;
  const nameMax = Math.max(8, COLUMNS - rightWidth - 3);

  const lines: Uint8Array[] = [];
  const safeName = asciiSafe(name);
  if (safeName.length <= nameMax) {
    const dots = '.'.repeat(Math.max(1, COLUMNS - safeName.length - rightWidth));
    lines.push(textLine(`${safeName} ${dots} ${right}`));
  } else {
    // Wrap the name in nameMax chunks; dots + price only on the LAST chunk.
    let remaining = safeName;
    const chunks: string[] = [];
    while (remaining.length > nameMax) {
      chunks.push(remaining.slice(0, nameMax));
      remaining = remaining.slice(nameMax);
    }
    chunks.push(remaining);
    for (const chunk of chunks) {
      if (chunk === chunks[chunks.length - 1]) {
        const dots = '.'.repeat(Math.max(1, COLUMNS - chunk.length - rightWidth));
        lines.push(textLine(`${chunk} ${dots} ${right}`));
      } else {
        lines.push(textLine(chunk));
      }
    }
  }
  return lines;
}

/** Summary row (subtotal/VAT/total) with a dots leader inside 42 columns. */
function summaryRow(label: string, amount: number): Uint8Array {
  const amountLabel = money(amount);
  const labelSafe = truncate(label, COLUMNS - amountLabel.length - 2);
  const dots = '.'.repeat(Math.max(1, COLUMNS - labelSafe.length - amountLabel.length - 1));
  return textLine(`${labelSafe} ${dots} ${amountLabel}`);
}

export interface EscposReceiptOptions {
  /** QR payload (e.g. the digital-receipt URL) — omit to skip the QR block. */
  qrText?: string;
  /** eTIMS pipeline status — 'PENDING' prints a KRA notice on the receipt. */
  etimsStatus?: string | null;
}

/**
 * Serialise a ReceiptData into raw ESC/POS bytes for an 80mm thermal printer.
 * Pure & synchronous — the returned Uint8Array is handed to
 * printReceiptViaUsb (or any transport: USB, serial, Bluetooth SPP later).
 */
export function buildReceiptEscpos(
  receipt: ReceiptData,
  opts?: EscposReceiptOptions,
): Uint8Array {
  const chunks: Uint8Array[] = [];

  const push = (...arrs: Uint8Array[]): void => {
    chunks.push(...arrs);
  };
  const line = (text: string): void => {
    chunks.push(textLine(text));
  };
  const centeredLine = (text: string): void => {
    chunks.push(CMD_ALIGN_CENTER, textLine(text), CMD_ALIGN_LEFT);
  };

  // ── Init ──
  push(CMD_INIT, CMD_ALIGN_LEFT, CMD_BOLD_OFF, CMD_SIZE_NORMAL);

  // ── Header: centered bold double-size store name ──
  push(CMD_ALIGN_CENTER, CMD_BOLD_ON, CMD_SIZE_DOUBLE);
  line(truncate(receipt.storeName || 'MBUMAH HARDWARE', 20));
  push(CMD_SIZE_NORMAL, CMD_BOLD_OFF);
  if (receipt.storeLocation) line(truncate(receipt.storeLocation, COLUMNS));
  if (receipt.storePhone) line(`Tel: ${truncate(receipt.storePhone, COLUMNS - 5)}`);
  push(CMD_ALIGN_LEFT);

  // ── Meta: receipt number / date / cashier / customer ──
  line('-'.repeat(COLUMNS));
  line(`Receipt: ${truncate(receipt.receiptNumber, COLUMNS - 9)}`);
  line(`Date: ${truncate(receipt.date, COLUMNS - 6)}`);
  line(`Cashier: ${truncate(receipt.cashier, COLUMNS - 9)}`);
  if (receipt.customer) {
    line(`Customer: ${truncate(receipt.customer, COLUMNS - 10)}`);
  }
  line('-'.repeat(COLUMNS));

  // ── Item rows (42 columns) ──
  for (const item of receipt.items ?? []) {
    push(...itemRowLines(item.name, item.quantity, item.pricePerUnit));
  }
  line('-'.repeat(COLUMNS));

  // ── Totals — bold block ──
  push(CMD_BOLD_ON);
  chunks.push(summaryRow('Subtotal', receipt.subtotal));
  if (receipt.taxAmount > 0) {
    chunks.push(summaryRow('VAT (incl.)', receipt.taxAmount));
  }
  if (receipt.discountAmount > 0) {
    chunks.push(summaryRow('Discount', -Math.abs(receipt.discountAmount)));
  }
  chunks.push(summaryRow('TOTAL', receipt.total));
  push(CMD_BOLD_OFF);
  line('-'.repeat(COLUMNS));

  // ── Payment ──
  line(`Payment: ${truncate(receipt.paymentMethod, COLUMNS - 9)}`);
  if (receipt.mpesaReceipt) {
    line(`M-Pesa Ref: ${truncate(receipt.mpesaReceipt, COLUMNS - 12)}`);
  }

  // ── eTIMS / KRA notice ──
  if (opts?.etimsStatus === 'PENDING') {
    centeredLine('*** PENDING KRA SUBMISSION ***');
  }

  // ── Optional QR (digital receipt verification) ──
  if (opts?.qrText) {
    push(...qrBlock(opts.qrText));
    centeredLine('Scan for digital receipt');
  }

  // ── Footer + cut ──
  line('');
  if (receipt.footer) {
    centeredLine(truncate(receipt.footer, COLUMNS));
  }
  centeredLine('Asante sana!');
  line('');
  push(CMD_FEED_LINES(3), CMD_PARTIAL_CUT);

  // ── Concatenate into one buffer ──
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// ── WebUSB transport ────────────────────────────────────────────────────────

export function hasUsbPrinting(): boolean {
  if (typeof navigator === 'undefined') return false;
  return typeof (navigator as NavigatorWithUsb).usb?.requestDevice === 'function';
}

export interface UsbPrintResult {
  ok: boolean;
  deviceName?: string;
  error?: string;
}

/** Human-readable messages for the WebUSB failure modes cashiers actually hit. */
function friendlyUsbError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);
  if (name === 'NotFoundError' || /no.*selected|device not found/i.test(message)) {
    return 'No thermal printer was selected. Plug in the USB printer and try again.';
  }
  if (name === 'SecurityError') {
    return 'USB access was denied by the browser. Use a Chromium browser (Chrome/Edge) on the till.';
  }
  if (name === 'NotAllowedError' || /denied|not allowed/i.test(message)) {
    return 'USB permission was denied. Allow access to the printer and try again.';
  }
  if (name === 'InvalidStateError') {
    return 'The printer is busy or already open in another tab. Close other tabs and retry.';
  }
  return message || 'Could not send the receipt to the thermal printer.';
}

async function findOutEndpoint(device: UsbDeviceLike): Promise<number> {
  const config = device.configuration;
  const interfaces = config?.interfaces ?? [];
  for (const iface of interfaces) {
    const candidates: readonly UsbAlternateLike[] = iface.alternates ?? (iface.alternate ? [iface.alternate] : []);
    for (const alt of candidates) {
      const out = (alt.endpoints ?? []).find((ep) => ep.direction === 'out');
      if (out) return out.endpointNumber;
    }
  }
  throw new Error('The printer has no USB OUT endpoint — it may not be an ESC/POS printer.');
}

/**
 * Send raw ESC/POS bytes to a USB thermal printer.
 *
 * Flow: prefer requestDevice({ filters: [{ classCode: 7 }] }) so the user can
 * pick the printer; if the chooser is dismissed/no device is chosen, fall
 * back to previously-paired printers via getDevices(). Then
 * open → claimInterface(0) → transferOut (chunked) → close.
 */
export async function printReceiptViaUsb(payload: Uint8Array): Promise<UsbPrintResult> {
  const usb = typeof navigator !== 'undefined' ? (navigator as NavigatorWithUsb).usb : undefined;
  if (!usb || typeof usb.requestDevice !== 'function') {
    return { ok: false, error: 'WebUSB is not available in this browser. Use Chrome or Edge on the till.' };
  }

  let device: UsbDeviceLike | undefined;
  try {
    device = await usb.requestDevice({ filters: [{ classCode: USB_PRINTER_CLASS }] });
  } catch (err) {
    // Chooser dismissed or blocked — try a previously-paired printer.
    try {
      const paired = await usb.getDevices();
      device = paired[0];
    } catch {
      device = undefined;
    }
    if (!device) {
      return { ok: false, error: friendlyUsbError(err) };
    }
  }

  const deviceName = device.productName || device.manufacturerName || 'USB thermal printer';

  try {
    await device.open();
    try {
      const configuration = device.configuration;
      if (configuration?.configurationValue !== undefined && device.selectConfiguration) {
        await device.selectConfiguration(configuration.configurationValue);
      }
      await device.claimInterface(0);
      const endpoint = await findOutEndpoint(device);

      // Chunked transferOut — some USB stacks cap single transfers. The copy
      // into a fresh ArrayBuffer-backed view keeps the BufferSource contract
      // under TS 5.9's stricter TypedArray generics (≤8KB per copy).
      for (let offset = 0; offset < payload.length; offset += TRANSFER_CHUNK_BYTES) {
        const view = payload.subarray(offset, Math.min(offset + TRANSFER_CHUNK_BYTES, payload.length));
        const chunk = new Uint8Array(view.byteLength);
        chunk.set(view);
        await device.transferOut(endpoint, chunk);
      }
    } finally {
      await device.close().catch(() => {
        // Never mask a successful print with a close() failure.
      });
    }
    return { ok: true, deviceName };
  } catch (err) {
    return { ok: false, deviceName, error: friendlyUsbError(err) };
  }
}
