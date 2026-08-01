// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — KRA eTIMS Utilities
// ─────────────────────────────────────────────────────────────────────────────
//
// Utility functions for Kenya Revenue Authority electronic Tax Invoice
// Management System (eTIMS) integration. Includes PIN validation, date
// formatting, invoice number generation, tax breakdown calculation, and
// QR code payload building.
// ─────────────────────────────────────────────────────────────────────────────

import { Decimal } from 'decimal.js';

/**
 * Format a Date as eTIMS-compliant timestamp: YYYYMMDDHHmmss
 */
export function formatEtimsDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Generate a KRA-compliant invoice number.
 * Format: STORECODE-YYYYMMDD-SEQUENCE (e.g. MBM001-20250801-000001)
 */
export function generateInvoiceNumber(
  storeCode: string,
  sequence: number,
  date: Date = new Date()
): string {
  const dateStr = formatEtimsDate(date).slice(0, 8);
  const seqStr = String(sequence).padStart(6, '0');
  return `${storeCode}-${dateStr}-${seqStr}`;
}

/**
 * Validate a KRA PIN.
 * Format: 1 letter + 9 digits + 1 letter (e.g. A001234567B)
 */
export function validateKraPin(pin: string): boolean {
  if (!pin || typeof pin !== 'string') return false;
  const cleaned = pin.trim().toUpperCase();
  return /^[A-Z]\d{9}[A-Z]$/.test(cleaned);
}

/**
 * eTIMS payment method codes
 */
export const ETIMS_PAYMENT_CODES: Record<string, string> = {
  CASH: '01',
  MPESA: '02',
  CARD: '03',
  BANK_TRANSFER: '04',
  CHEQUE: '05',
  CREDIT: '06',
  GIFT_CARD: '07',
  SPLIT: '08',
  DEBT: '06',
};

/**
 * Map internal payment method to eTIMS code
 */
export function mapPaymentMethod(method: string): string {
  return ETIMS_PAYMENT_CODES[method?.toUpperCase()] || '01';
}

/**
 * eTIMS tax type codes
 * A = VAT (16%)
 * B = Zero-rated (0%)
 * C = Exempt
 * D = Not subject to VAT
 */
export const ETIMS_TAX_TYPES = {
  A: { code: 'A', name: 'VAT 16%', rate: 0.16 },
  B: { code: 'B', name: 'Zero-rated', rate: 0 },
  C: { code: 'C', name: 'Exempt', rate: 0 },
  D: { code: 'D', name: 'Not subject to VAT', rate: 0 },
} as const;

export interface TaxBreakdownItem {
  name: string;
  quantity: number;
  pricePerUnit: number;
  taxType: keyof typeof ETIMS_TAX_TYPES;
  discount?: number;
}

export interface TaxBreakdown {
  taxableAmount: number;
  vatAmount: number;
  exemptAmount: number;
  zeroRatedAmount: number;
  totalAmount: number;
  totalDiscount: number;
}

/**
 * Calculate tax breakdown for a list of items
 */
export function calculateTaxBreakdown(items: TaxBreakdownItem[]): TaxBreakdown {
  let taxableAmount = new Decimal(0);
  let vatAmount = new Decimal(0);
  let exemptAmount = new Decimal(0);
  let zeroRatedAmount = new Decimal(0);
  let totalDiscount = new Decimal(0);

  for (const item of items) {
    const lineTotal = new Decimal(item.pricePerUnit)
      .times(item.quantity)
      .minus(item.discount || 0);
    totalDiscount = totalDiscount.plus(item.discount || 0);

    const taxConfig = ETIMS_TAX_TYPES[item.taxType] || ETIMS_TAX_TYPES.A;

    if (taxConfig.code === 'A') {
      // VAT 16%: price is tax-inclusive, extract tax
      const netAmount = lineTotal.div(new Decimal(1).plus(taxConfig.rate));
      const tax = lineTotal.minus(netAmount);
      taxableAmount = taxableAmount.plus(netAmount);
      vatAmount = vatAmount.plus(tax);
    } else if (taxConfig.code === 'B') {
      zeroRatedAmount = zeroRatedAmount.plus(lineTotal);
    } else if (taxConfig.code === 'C') {
      exemptAmount = exemptAmount.plus(lineTotal);
    }
  }

  const totalAmount = taxableAmount
    .plus(vatAmount)
    .plus(exemptAmount)
    .plus(zeroRatedAmount);

  return {
    taxableAmount: taxableAmount.toNumber(),
    vatAmount: vatAmount.toNumber(),
    exemptAmount: exemptAmount.toNumber(),
    zeroRatedAmount: zeroRatedAmount.toNumber(),
    totalAmount: totalAmount.toNumber(),
    totalDiscount: totalDiscount.toNumber(),
  };
}

/**
 * Build a KRA-compliant QR code payload string.
 * The QR code contains invoice metadata for verification.
 */
export function buildQrCodePayload(invoiceData: {
  invoiceNumber: string;
  tin: string;
  date: Date;
  totalAmount: number;
  vatAmount: number;
  customerTin?: string;
}): string {
  const fields = [
    invoiceData.invoiceNumber,
    invoiceData.tin,
    formatEtimsDate(invoiceData.date),
    invoiceData.totalAmount.toFixed(2),
    invoiceData.vatAmount.toFixed(2),
    invoiceData.customerTin || '',
  ];
  return fields.join('|');
}

/**
 * Generate a simple deterministic QR-like pattern from a string.
 * This is a visual placeholder — not a real QR code.
 * Returns a 2D array of booleans (true = dark module).
 */
export function generateQrPattern(data: string, size: number = 21): boolean[][] {
  const grid: boolean[][] = [];
  // Simple hash-based pattern generation
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
  }
  hash = Math.abs(hash);

  for (let row = 0; row < size; row++) {
    grid[row] = [];
    for (let col = 0; col < size; col++) {
      // Corner finder patterns (3x3 squares in corners)
      const inFinder =
        (row < 7 && col < 7) ||
        (row < 7 && col >= size - 7) ||
        (row >= size - 7 && col < 7);
      if (inFinder) {
        const inBorder =
          row === 0 || row === 6 || col === 0 || col === 6 ||
          row === size - 1 || col === size - 1;
        const inCenter = row >= 2 && row <= 4 && col >= 2 && col <= 4;
        grid[row][col] = inBorder || inCenter;
      } else {
        // Data area: deterministic pseudo-random
        const seed = (hash + row * size + col) % 7;
        grid[row][col] = seed < 3;
      }
    }
  }
  return grid;
}
