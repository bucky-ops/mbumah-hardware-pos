// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Export Utilities
// ─────────────────────────────────────────────────────────────────────────────
//
// Browser-safe export utilities for CSV and PDF generation.
// No server-side file system access — all operations use the browser's
// download API and window.print().
//
// Functions:
//   1. exportToCSV(data, filename)     — Export any data array to CSV
//   2. exportToPDF(title, content)     — Generate a PDF receipt via browser print
//   3. exportTransactions(transactions) — Export transaction history to CSV
//   4. exportInventory(products)       — Export product inventory to CSV
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape a CSV field value for safe inclusion in a CSV file.
 * Handles commas, double quotes, and newlines per RFC 4180.
 */
function escapeCSVField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // If the field contains a comma, double quote, or newline, wrap in quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    // Double any existing double quotes
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert a row object to a CSV line string.
 */
function objectToCSVRow(obj: Record<string, unknown>, headers: string[]): string {
  return headers
    .map((header) => escapeCSVField(obj[header]))
    .join(',');
}

/**
 * Format a number as KES currency string for CSV export.
 */
function formatKESForCSV(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '';
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a date for CSV export (ISO 8601 for easy parsing).
 */
function formatDateForCSV(date: string | Date | null | undefined): string {
  if (!date) return '';
  try {
    return new Date(date).toISOString();
  } catch {
    return String(date);
  }
}

// ─── Core CSV Export ─────────────────────────────────────────────────────────

/**
 * Export any data array to a CSV file and trigger a browser download.
 *
 * @param data - Array of objects to export
 * @param filename - Name for the downloaded file (with or without .csv extension)
 * @param options - Optional configuration for column selection and ordering
 *
 * @example
 *   exportToCSV(products, 'inventory', {
 *     headers: ['name', 'sku', 'pricePerUnit', 'quantityInStock'],
 *     headerLabels: { name: 'Product Name', sku: 'SKU', pricePerUnit: 'Price', quantityInStock: 'Stock' },
 *   });
 */
export function exportToCSV(
  data: Record<string, unknown>[],
  filename: string,
  options?: {
    /** Explicit column order. If omitted, uses keys from the first object. */
    headers?: string[];
    /** Human-readable labels for headers. Maps header key → display label. */
    headerLabels?: Record<string, string>;
  },
): void {
  if (!data || data.length === 0) {
    console.warn('[exportToCSV] No data to export.');
    return;
  }

  // Determine headers
  const headers = options?.headers || Object.keys(data[0]);
  const headerLabels = options?.headerLabels || {};

  // Build CSV content
  const headerRow = headers
    .map((h) => escapeCSVField(headerLabels[h] || h))
    .join(',');

  const dataRows = data.map((row) => objectToCSVRow(row, headers));

  const csvContent = [headerRow, ...dataRows].join('\n');

  // Trigger download
  downloadFile(
    csvContent,
    filename.endsWith('.csv') ? filename : `${filename}.csv`,
    'text/csv;charset=utf-8;',
  );
}

// ─── PDF Export (Browser Print) ──────────────────────────────────────────────

/**
 * Generate a simple PDF receipt using the browser's print dialog.
 * Opens a new window with formatted content and triggers print.
 *
 * @param title - Document title (shown in print dialog)
 * @param content - HTML content string for the document body
 *
 * @example
 *   exportToPDF('Receipt-001', receiptHTML);
 */
export function exportToPDF(title: string, content: string): void {
  const printWindow = window.open('', '_blank', 'width=400,height=600');
  if (!printWindow) {
    console.error('[exportToPDF] Could not open print window. Pop-ups may be blocked.');
    return;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHTML(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      line-height: 1.5;
      color: #000;
      background: #fff;
      padding: 8mm;
      max-width: 80mm;
      margin: 0 auto;
    }
    h1 { font-size: 14px; text-align: center; margin-bottom: 4px; }
    h2 { font-size: 12px; text-align: center; margin-bottom: 8px; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; }
    .bold { font-weight: bold; }
    .center { text-align: center; }
    .right { text-align: right; }
    @page { size: 80mm auto; margin: 0; }
    @media print {
      body { padding: 2mm; }
    }
  </style>
</head>
<body>
  ${content}
  <script>
    // Auto-print after content loads
    window.onload = function() {
      setTimeout(function() { window.print(); }, 300);
    };
  </script>
</body>
</html>`;

  printWindow.document.write(html);
  printWindow.document.close();
}

/**
 * Generate a receipt HTML string for PDF export.
 */
export function generateReceiptHTML(receiptData: {
  storeName: string;
  storeLocation: string;
  storePhone: string;
  receiptNumber: string;
  date: string;
  cashier: string;
  customer: string;
  items: Array<{ name: string; quantity: number; pricePerUnit: number; lineTotal: number }>;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  paymentMethod: string;
  mpesaReference?: string;
  cashReceived?: number;
}): string {
  const d = receiptData;
  const change = d.paymentMethod === 'CASH' && d.cashReceived && d.cashReceived > 0
    ? d.cashReceived - d.totalAmount
    : 0;

  const itemRows = d.items.map((item) => `
    <div class="row">
      <span>${escapeHTML(item.name)}</span>
      <span>${item.quantity} x ${formatKESForCSV(item.pricePerUnit)} = ${formatKESForCSV(item.lineTotal)}</span>
    </div>
  `).join('');

  return `
    <h1>MBUMAH HARDWARE</h1>
    <h2>${escapeHTML(d.storeName)}</h2>
    <div class="center">${escapeHTML(d.storeLocation)}</div>
    <div class="center">Tel: ${escapeHTML(d.storePhone)}</div>
    <div class="divider"></div>
    <div class="row"><span>Receipt #:</span><span class="bold">${escapeHTML(d.receiptNumber)}</span></div>
    <div class="row"><span>Date:</span><span>${escapeHTML(d.date)}</span></div>
    <div class="row"><span>Cashier:</span><span>${escapeHTML(d.cashier)}</span></div>
    <div class="row"><span>Customer:</span><span>${escapeHTML(d.customer)}</span></div>
    <div class="divider"></div>
    ${itemRows}
    <div class="divider"></div>
    <div class="row"><span>Subtotal:</span><span>${formatKESForCSV(d.subtotal)}</span></div>
    <div class="row"><span>VAT (16%):</span><span>${formatKESForCSV(d.taxAmount)}</span></div>
    ${d.discountAmount > 0 ? `<div class="row"><span>Discount:</span><span>-${formatKESForCSV(d.discountAmount)}</span></div>` : ''}
    <div class="divider"></div>
    <div class="row bold"><span>TOTAL:</span><span>${formatKESForCSV(d.totalAmount)}</span></div>
    <div class="divider"></div>
    <div class="row"><span>Payment:</span><span>${escapeHTML(d.paymentMethod)}</span></div>
    ${d.mpesaReference ? `<div class="row"><span>M-Pesa Ref:</span><span>${escapeHTML(d.mpesaReference)}</span></div>` : ''}
    ${change > 0 ? `<div class="row"><span>Change:</span><span>${formatKESForCSV(change)}</span></div>` : ''}
    <div class="divider"></div>
    <div class="center bold">Thank you for shopping at MBUMAH HARDWARE!</div>
    <div class="center">Asante sana!</div>
    <div class="center">Goods sold are not refundable</div>
  `;
}

// ─── Transaction Export ──────────────────────────────────────────────────────

/**
 * Export transaction history to a CSV file.
 *
 * @param transactions - Array of transaction objects from the API
 *
 * @example
 *   const txns = await transactionsApi.list({ storeId: 'store_juja_main' });
 *   exportTransactions(txns.data || []);
 */
export function exportTransactions(
  transactions: Array<{
    id?: string;
    receiptNumber?: string;
    createdAt?: string;
    customer?: { name?: string } | null;
    cashier?: { name?: string } | null;
    paymentMethod?: string;
    paymentStatus?: string;
    subtotal?: number;
    taxAmount?: number;
    discountAmount?: number;
    totalAmount?: number;
    items?: Array<{ productName?: string; quantity?: number; pricePerUnit?: number; lineTotal?: number }>;
    notes?: string | null;
  }>,
): void {
  const rows = transactions.map((tx) => ({
    receiptNumber: tx.receiptNumber || '',
    date: formatDateForCSV(tx.createdAt),
    customer: tx.customer?.name || 'Walk-in',
    cashier: tx.cashier?.name || '',
    paymentMethod: tx.paymentMethod || '',
    paymentStatus: tx.paymentStatus || '',
    subtotal: formatKESForCSV(tx.subtotal),
    taxAmount: formatKESForCSV(tx.taxAmount),
    discountAmount: formatKESForCSV(tx.discountAmount),
    totalAmount: formatKESForCSV(tx.totalAmount),
    itemCount: String(tx.items?.length || 0),
    notes: tx.notes || '',
  }));

  const timestamp = new Date().toISOString().split('T')[0];
  exportToCSV(rows, `transactions_${timestamp}`, {
    headers: [
      'receiptNumber', 'date', 'customer', 'cashier',
      'paymentMethod', 'paymentStatus', 'subtotal', 'taxAmount',
      'discountAmount', 'totalAmount', 'itemCount', 'notes',
    ],
    headerLabels: {
      receiptNumber: 'Receipt #',
      date: 'Date',
      customer: 'Customer',
      cashier: 'Cashier',
      paymentMethod: 'Payment Method',
      paymentStatus: 'Payment Status',
      subtotal: 'Subtotal',
      taxAmount: 'VAT (16%)',
      discountAmount: 'Discount',
      totalAmount: 'Total',
      itemCount: 'Items',
      notes: 'Notes',
    },
  });
}

// ─── Inventory Export ────────────────────────────────────────────────────────

/**
 * Export product inventory to a CSV file.
 *
 * @param products - Array of product objects from the API
 *
 * @example
 *   const prods = await productsApi.list({ storeId: 'store_juja_main' });
 *   exportInventory(prods.data || []);
 */
export function exportInventory(
  products: Array<{
    id?: string;
    name?: string;
    sku?: string;
    barcode?: string;
    category?: { name?: string } | null;
    pricePerUnit?: number;
    costPrice?: number;
    quantityInStock?: number;
    reorderLevel?: number;
    unitType?: string;
    isActive?: boolean;
    isRental?: boolean;
    isBundle?: boolean;
    storeId?: string;
  }>,
): void {
  const rows = products.map((p) => ({
    name: p.name || '',
    sku: p.sku || '',
    barcode: p.barcode || '',
    category: p.category?.name || '',
    pricePerUnit: formatKESForCSV(p.pricePerUnit),
    costPrice: formatKESForCSV(p.costPrice),
    quantityInStock: String(p.quantityInStock ?? 0),
    reorderLevel: String(p.reorderLevel ?? 0),
    unitType: p.unitType || '',
    stockStatus: (p.quantityInStock ?? 0) <= (p.reorderLevel ?? 0) ? 'LOW STOCK' : 'OK',
    isActive: p.isActive ? 'Yes' : 'No',
    isRental: p.isRental ? 'Yes' : 'No',
    isBundle: p.isBundle ? 'Yes' : 'No',
  }));

  const timestamp = new Date().toISOString().split('T')[0];
  exportToCSV(rows, `inventory_${timestamp}`, {
    headers: [
      'name', 'sku', 'barcode', 'category', 'pricePerUnit', 'costPrice',
      'quantityInStock', 'reorderLevel', 'unitType', 'stockStatus',
      'isActive', 'isRental', 'isBundle',
    ],
    headerLabels: {
      name: 'Product Name',
      sku: 'SKU',
      barcode: 'Barcode',
      category: 'Category',
      pricePerUnit: 'Selling Price',
      costPrice: 'Cost Price',
      quantityInStock: 'Qty in Stock',
      reorderLevel: 'Reorder Level',
      unitType: 'Unit',
      stockStatus: 'Stock Status',
      isActive: 'Active',
      isRental: 'Rental',
      isBundle: 'Bundle',
    },
  });
}

// ─── Export Sales Report ─────────────────────────────────────────────────────

/**
 * Export a sales summary report to CSV.
 */
export function exportSalesReport(
  salesData: Array<{
    date: string;
    totalSales: number;
    totalTransactions: number;
    avgTransactionValue: number;
    cashSales: number;
    mpesaSales: number;
    debtSales: number;
    giftCardSales: number;
  }>,
  storeName?: string,
): void {
  const rows = salesData.map((s) => ({
    date: s.date,
    totalSales: formatKESForCSV(s.totalSales),
    totalTransactions: String(s.totalTransactions),
    avgTransactionValue: formatKESForCSV(s.avgTransactionValue),
    cashSales: formatKESForCSV(s.cashSales),
    mpesaSales: formatKESForCSV(s.mpesaSales),
    debtSales: formatKESForCSV(s.debtSales),
    giftCardSales: formatKESForCSV(s.giftCardSales),
  }));

  const timestamp = new Date().toISOString().split('T')[0];
  const prefix = storeName ? `${storeName.replace(/\s+/g, '_')}_` : '';
  exportToCSV(rows, `${prefix}sales_report_${timestamp}`, {
    headers: [
      'date', 'totalSales', 'totalTransactions', 'avgTransactionValue',
      'cashSales', 'mpesaSales', 'debtSales', 'giftCardSales',
    ],
    headerLabels: {
      date: 'Date',
      totalSales: 'Total Sales',
      totalTransactions: 'Transactions',
      avgTransactionValue: 'Avg Transaction',
      cashSales: 'Cash Sales',
      mpesaSales: 'M-Pesa Sales',
      debtSales: 'Debt Sales',
      giftCardSales: 'Gift Card Sales',
    },
  });
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Trigger a file download in the browser.
 */
function downloadFile(content: string, filename: string, mimeType: string): void {
  // Add BOM for UTF-8 CSV files (helps Excel detect encoding)
  const bom = mimeType.includes('csv') ? '\uFEFF' : '';
  const blob = new Blob([bom + content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();

  // Cleanup
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Escape HTML special characters for safe inclusion in HTML content.
 */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
