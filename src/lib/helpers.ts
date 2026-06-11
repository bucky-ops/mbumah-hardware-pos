/**
 * MBUMAH HARDWARE POS - Receipt Number Generator
 * Format: MBM-YYYYMMDD-XXXXX
 */

export function generateReceiptNumber(): string {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
  return `MBM-${dateStr}-${random}`;
}

/**
 * Generate Journal Entry Number
 * Format: JE-YYYYMMDD-XXXXX
 */
export function generateJournalEntryNumber(): string {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
  return `JE-${dateStr}-${random}`;
}

/**
 * Generate SKU code
 * Format: MBM-CAT-XXXX
 */
export function generateSKU(categoryCode: string = 'GEN'): string {
  const random = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
  return `MBM-${categoryCode.toUpperCase()}-${random}`;
}

/**
 * Format KES currency
 */
export function formatKES(amount: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Calculate debt aging bucket
 */
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

/**
 * Calculate late rental fees
 */
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

/**
 * Calculate line total for a cart item
 */
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
