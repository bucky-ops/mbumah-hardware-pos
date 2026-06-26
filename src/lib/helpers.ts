// Receipt & reference generators, formatting, calculations

export function generateReceiptNumber(): string {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
  return `MBM-${dateStr}-${random}`;
}

// Format: JE-YYYYMMDD-XXXXX
export function generateJournalEntryNumber(): string {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
  return `JE-${dateStr}-${random}`;
}

// Format: MBM-CAT-XXXX
export function generateSKU(categoryCode: string = 'GEN'): string {
  const random = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
  return `MBM-${categoryCode.toUpperCase()}-${random}`;
}

export function formatKES(amount: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a date as a readable string (e.g. "26 Jun 2026").
 * Accepts Date, ISO string, or timestamp. Returns '—' for null/undefined.
 * Used by PDF report generation (export-pdf route) and other server-side
 * formatting where the api.ts formatDateTime (client-side) isn't available.
 */
export function formatDate(date: Date | string | number | null | undefined): string {
  if (date === null || date === undefined) return '—';
  const d = typeof date === 'object' ? date : new Date(date);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function calculateAgingBucket(dueDate: Date): string {
  const now = new Date();
  const due = new Date(dueDate);
  const diffMs = now.getTime() - due.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'CURRENT';
  if (diffDays <= 30) return 'DAYS_30';
  if (diffDays <= 60) return 'DAYS_60';
  return 'DAYS_90_PLUS';
}

export function calculateLateFee(
  ratePerDay: number,
  expectedReturnDate: Date,
  actualReturnDate: Date = new Date()
): number {
  const expected = new Date(expectedReturnDate);
  const actual = new Date(actualReturnDate);
  const diffMs = actual.getTime() - expected.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  return diffDays * ratePerDay;
}

// Format: GC-XXXX-XXXX-XXXX
export function generateGiftCardCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars: I, O, 0, 1
  const segments = 3;
  const segmentLength = 4;
  const parts: string[] = [];
  for (let s = 0; s < segments; s++) {
    let seg = '';
    for (let i = 0; i < segmentLength; i++) {
      seg += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    parts.push(seg);
  }
  return `GC-${parts.join('-')}`;
}

export function calculateLineTotal(
  pricePerUnit: number,
  quantity: number,
  discountPercent: number = 0,
  taxRate: number = 16
): { subtotal: number; discount: number; tax: number; total: number } {
  const subtotal = pricePerUnit * quantity;
  const discount = subtotal * (discountPercent / 100);
  const taxable = subtotal - discount;
  const tax = taxable * (taxRate / 100);
  const total = taxable + tax;
  return { subtotal, discount, tax, total };
}
