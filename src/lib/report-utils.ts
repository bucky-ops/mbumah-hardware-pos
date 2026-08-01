// Report-generation utilities shared between the server-side report API
// routes (which use these helpers to build CSV responses) and the client-side
// report-generator component (which uses `downloadCSV` to save a CSV from a
// fetched blob).
//
// CSV escaping follows RFC 4180:
//   • Wrap a field in double quotes if it contains a comma, double-quote,
//     or newline.
//   • Escape an embedded double-quote by doubling it ("").
//   • Rows are separated by CRLF (\r\n) for maximum spreadsheet compat
//     (Excel on Windows expects CRLF; macOS Numbers and Google Sheets
//     accept either).
//
// All helpers are pure (no I/O) and safe to call from both server and
// client components. `downloadCSV` is browser-only and no-ops on the server.

// ── CSV primitives ──────────────────────────────────────────────────────────

/**
 * Escape a single value for inclusion in a CSV cell per RFC 4180.
 * Numbers, booleans, null/undefined, and strings are all accepted.
 */
export function escapeCSVCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert an array of rows (each row is an array of cell values) and an
 * optional header row into a single CSV string.
 */
export function toCSV(header: string[], rows: unknown[][]): string {
  const lines = [header.map(escapeCSVCell).join(','), ...rows.map((r) => r.map(escapeCSVCell).join(','))];
  return lines.join('\r\n');
}

// ── Date formatting ────────────────────────────────────────────────────────

/**
 * Format a date for report headers: "Monday, January 1, 2025".
 * Accepts a Date, ISO string, or any value Date() can parse.
 */
export function formatReportDate(date: string | Date | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format a date as YYYY-MM-DD for use in filenames and CSV date cells.
 */
export function formatISODate(date: string | Date | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

/**
 * Format a number for CSV — rounds to 2 dp, uses `.` as the decimal
 * separator, and strips trailing zeros for cleaner output (1.50 → 1.5).
 * Null/NaN → empty string.
 */
export function formatNumber(value: number | null | undefined | string): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return '';
  return n.toFixed(2).replace(/\.?0+$/, '') || '0';
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface SalesSummaryData {
  period: { startDate: string; endDate: string };
  store?: { id: string; name: string };
  totals: {
    revenue: number;
    transactions: number;
    avgOrderValue: number;
    taxCollected: number;
    totalDiscount: number;
    costOfGoods: number;
    grossProfit: number;
    profitMargin: number;
  };
  comparison?: {
    previousRevenue: number;
    revenueChange: number;
    revenueChangePercent: number | null;
    previousTransactions: number;
    transactionsChange: number;
  };
  paymentBreakdown: Array<{
    method: string;
    count: number;
    amount: number;
    percent: number;
  }>;
  topProducts: Array<{
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
    revenue: number;
    cost: number;
    profit: number;
  }>;
  hourlyDistribution: Array<{
    hour: number;
    label: string;
    transactionCount: number;
    revenue: number;
  }>;
}

export interface DailyReportData {
  date: string;
  store?: { id: string; name: string };
  sales: {
    totalRevenue: number;
    totalSubtotal: number;
    totalTax: number;
    totalDiscount: number;
    transactionCount: number;
    avgTransactionValue: number;
  };
  returns: {
    count: number;
    totalRefunded: number;
  };
  voided: {
    count: number;
    totalVoided: number;
  };
  taxCollected: number;
  paymentBreakdown: Array<{
    method: string;
    count: number;
    amount: number;
  }>;
  cashierBreakdown?: Array<{
    cashierId: string;
    cashierName: string;
    transactionCount: number;
    revenue: number;
  }>;
}

export interface ReportTransaction {
  subtotal?: number | string;
  taxAmount?: number | string;
  discountAmount?: number | string;
  totalAmount?: number | string;
  paymentMethod?: string;
  transactionType?: string;
}

// ── CSV builders ────────────────────────────────────────────────────────────

/**
 * Build a multi-section CSV for a sales-summary report. Includes:
 *   • Store + period header
 *   • Totals block (revenue, transactions, AOV, tax, discount, profit)
 *   • Comparison vs previous period (if present)
 *   • Payment-method breakdown
 *   • Top-10 products
 *   • Hourly sales distribution
 *
 * Each section is separated by a blank line and starts with a section title
 * in its own row so the CSV is human-readable when opened in a spreadsheet.
 */
export function generateSalesCSV(data: SalesSummaryData): string {
  const sections: string[] = [];

  // ── Header ──
  sections.push(toCSV(
    ['MBUMAH HARDWARE POS — Sales Summary Report'],
    [[]],
  ));
  sections.push(toCSV(
    ['Store', data.store?.name || 'All Stores'],
    [[]],
  ));
  sections.push(toCSV(
    ['Period Start', 'Period End'],
    [[formatReportDate(data.period.startDate), formatReportDate(data.period.endDate)]],
  ));

  // ── Totals ──
  sections.push('');
  sections.push('Summary Totals');
  sections.push(toCSV(
    ['Metric', 'Value'],
    [
      ['Total Revenue', formatNumber(data.totals.revenue)],
      ['Transactions', data.totals.transactions],
      ['Avg Order Value', formatNumber(data.totals.avgOrderValue)],
      ['Tax Collected', formatNumber(data.totals.taxCollected)],
      ['Total Discount', formatNumber(data.totals.totalDiscount)],
      ['Cost of Goods', formatNumber(data.totals.costOfGoods)],
      ['Gross Profit', formatNumber(data.totals.grossProfit)],
      ['Profit Margin (%)', formatNumber(data.totals.profitMargin)],
    ],
  ));

  // ── Comparison ──
  if (data.comparison) {
    sections.push('');
    sections.push('Comparison vs Previous Period');
    sections.push(toCSV(
      ['Metric', 'Current', 'Previous', 'Change', 'Change (%)'],
      [
        [
          'Revenue',
          formatNumber(data.totals.revenue),
          formatNumber(data.comparison.previousRevenue),
          formatNumber(data.comparison.revenueChange),
          data.comparison.revenueChangePercent === null
            ? ''
            : formatNumber(data.comparison.revenueChangePercent),
        ],
        [
          'Transactions',
          data.totals.transactions,
          data.comparison.previousTransactions,
          data.comparison.transactionsChange,
          '',
        ],
      ],
    ));
  }

  // ── Payment breakdown ──
  sections.push('');
  sections.push('Payment Method Breakdown');
  sections.push(toCSV(
    ['Method', 'Count', 'Amount', 'Percent (%)'],
    data.paymentBreakdown.map((p) => [
      p.method,
      p.count,
      formatNumber(p.amount),
      formatNumber(p.percent),
    ]),
  ));

  // ── Top products ──
  sections.push('');
  sections.push('Top 10 Products');
  sections.push(toCSV(
    ['Rank', 'Product', 'SKU', 'Quantity Sold', 'Revenue', 'Cost', 'Profit'],
    data.topProducts.map((p, i) => [
      i + 1,
      p.productName,
      p.sku,
      formatNumber(p.quantity),
      formatNumber(p.revenue),
      formatNumber(p.cost),
      formatNumber(p.profit),
    ]),
  ));

  // ── Hourly distribution ──
  sections.push('');
  sections.push('Hourly Sales Distribution');
  sections.push(toCSV(
    ['Hour', 'Transactions', 'Revenue'],
    data.hourlyDistribution.map((h) => [h.label, h.transactionCount, formatNumber(h.revenue)]),
  ));

  return sections.join('\r\n');
}

/**
 * Build a daily end-of-day reconciliation CSV. Compact single-table format
 * suitable for accountant reconciliation:
 *   • Date + store header
 *   • Sales / returns / voids block
 *   • Tax collected
 *   • Payment-method breakdown
 *   • Optional cashier breakdown
 */
export function generateDailyReportCSV(data: DailyReportData): string {
  const sections: string[] = [];

  sections.push('MBUMAH HARDWARE POS — End-of-Day Reconciliation');
  sections.push(`Date: ${formatReportDate(data.date)}`);
  sections.push(`Store: ${data.store?.name || 'All Stores'}`);
  sections.push('');

  sections.push('Daily Totals');
  sections.push(toCSV(
    ['Metric', 'Value'],
    [
      ['Gross Sales (Subtotal)', formatNumber(data.sales.totalSubtotal)],
      ['Total Tax Collected', formatNumber(data.taxCollected)],
      ['Total Discounts', formatNumber(data.sales.totalDiscount)],
      ['Net Revenue', formatNumber(data.sales.totalRevenue)],
      ['Transaction Count', data.sales.transactionCount],
      ['Avg Transaction Value', formatNumber(data.sales.avgTransactionValue)],
      ['', ''],
      ['Returns — Count', data.returns.count],
      ['Returns — Refunded', formatNumber(data.returns.totalRefunded)],
      ['Voided — Count', data.voided.count],
      ['Voided — Amount', formatNumber(data.voided.totalVoided)],
    ],
  ));

  sections.push('');
  sections.push('Payment Method Breakdown');
  sections.push(toCSV(
    ['Method', 'Count', 'Amount'],
    data.paymentBreakdown.map((p) => [p.method, p.count, formatNumber(p.amount)]),
  ));

  if (data.cashierBreakdown && data.cashierBreakdown.length > 0) {
    sections.push('');
    sections.push('Cashier Breakdown');
    sections.push(toCSV(
      ['Cashier', 'Transactions', 'Revenue'],
      data.cashierBreakdown.map((c) => [c.cashierName, c.transactionCount, formatNumber(c.revenue)]),
    ));
  }

  return sections.join('\r\n');
}

// ── Totals calculator ───────────────────────────────────────────────────────

/**
 * Sum revenue, tax, and discounts across a list of transactions. Accepts
 * both number and Decimal-string fields (Prisma SQLite returns Decimal as
 * Decimal.js objects whose .toString() is safe to parseFloat). Returns
 * NaN-free numbers (defaults to 0 when no transactions).
 */
export function calculateReportTotals(transactions: ReportTransaction[]): {
  revenue: number;
  tax: number;
  discount: number;
  transactionCount: number;
} {
  let revenue = 0;
  let tax = 0;
  let discount = 0;

  for (const tx of transactions) {
    const total = typeof tx.totalAmount === 'number' ? tx.totalAmount : parseFloat(String(tx.totalAmount || 0));
    const taxAmt = typeof tx.taxAmount === 'number' ? tx.taxAmount : parseFloat(String(tx.taxAmount || 0));
    const disc = typeof tx.discountAmount === 'number' ? tx.discountAmount : parseFloat(String(tx.discountAmount || 0));

    if (Number.isFinite(total)) revenue += total;
    if (Number.isFinite(taxAmt)) tax += taxAmt;
    if (Number.isFinite(disc)) discount += disc;
  }

  return {
    revenue,
    tax,
    discount,
    transactionCount: transactions.length,
  };
}

// ── Browser download helper ─────────────────────────────────────────────────

/**
 * Trigger a browser download of a CSV string as a `.csv` file. No-ops on
 * the server (no `window` / `document`).
 *
 * Attaches a BOM ("\uFEFF") to the start of the file so Excel auto-detects
 * UTF-8 encoding (prevents the "–" character and accented letters from
 * showing as mojibake in Excel on Windows).
 */
export function downloadCSV(csvString: string, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const safeName = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = safeName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  // Cleanup: remove the link and revoke the object URL after a tick so the
  // browser has time to initiate the download.
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}
