// GET /api/reports/export-pdf
//
// Generates a branded, print-ready HTML report (browser print → PDF) with:
//   • Company logo (base64-embedded so it survives in print windows)
//   • Company name, branch, address, phone, KRA PIN
//   • Report title + date range
//   • Data table with zebra striping
//   • Footer with generated timestamp + page print
//
// Supported types: sales, inventory, debt, rentals
// Query params: storeId, type, dateFrom?, dateTo?
//
// Returns Content-Type: text/html — the client opens it in a new tab and
// the user uses the browser's "Save as PDF" (Ctrl+P → Save as PDF).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { formatKES, formatDate } from '@/lib/helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';

// ── Logo embedding ───────────────────────────────────────────────────────────
//
// Read the logo from /public and base64-encode it so the generated HTML is
// fully self-contained (works in a print window even if the origin differs).

function getLogoDataUri(): string {
  try {
    const logoPath = join(process.cwd(), 'public', 'logo.png');
    const buffer = readFileSync(logoPath);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    try {
      const svgPath = join(process.cwd(), 'public', 'logo.svg');
      const buffer = readFileSync(svgPath);
      return `data:image/svg+xml;base64,${buffer.toString('base64')}`;
    } catch {
      return '';
    }
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

// ── Report builders ──────────────────────────────────────────────────────────

interface ReportContext {
  storeId: string;
  dateFrom: string;
  dateTo: string;
}

interface ReportResult {
  title: string;
  subtitle: string;
  headers: string[];
  rows: string[][];
  summary?: { label: string; value: string }[];
}

async function buildSalesReport(ctx: ReportContext): Promise<ReportResult> {
  const where: Record<string, unknown> = { storeId: ctx.storeId, transactionType: 'SALE' };
  if (ctx.dateFrom || ctx.dateTo) {
    const createdAt: Record<string, Date> = {};
    if (ctx.dateFrom) createdAt.gte = new Date(ctx.dateFrom);
    if (ctx.dateTo) {
      const to = new Date(ctx.dateTo);
      to.setHours(23, 59, 59, 999);
      createdAt.lte = to;
    }
    where.createdAt = createdAt;
  }

  const transactions = await db.salesTransaction.findMany({
    where,
    include: {
      customer: { select: { name: true } },
      cashier: { select: { name: true } },
      items: { select: { productName: true, quantity: true, lineTotal: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const headers = ['Receipt #', 'Date', 'Customer', 'Cashier', 'Items', 'Subtotal', 'VAT', 'Total', 'Status'];
  const rows = transactions.map((t) => [
    t.receiptNumber,
    formatDate(t.createdAt),
    t.customer?.name || 'Walk-in',
    t.cashier?.name || '—',
    String(t.items.length),
    formatKES(t.subtotal),
    formatKES(t.taxAmount),
    formatKES(t.totalAmount),
    t.paymentStatus,
  ]);

  const totalSubtotal = transactions.reduce((s, t) => s + t.subtotal, 0);
  const totalVat = transactions.reduce((s, t) => s + t.taxAmount, 0);
  const totalAmount = transactions.reduce((s, t) => s + t.totalAmount, 0);

  return {
    title: 'Sales Report',
    subtitle: `${transactions.length} transaction(s)`,
    headers,
    rows,
    summary: [
      { label: 'Total Subtotal', value: formatKES(totalSubtotal) },
      { label: 'Total VAT', value: formatKES(totalVat) },
      { label: 'Total Revenue', value: formatKES(totalAmount) },
    ],
  };
}

async function buildInventoryReport(ctx: ReportContext): Promise<ReportResult> {
  const products = await db.product.findMany({
    where: { storeId: ctx.storeId, isActive: true },
    include: { category: { select: { name: true } } },
    orderBy: { name: 'asc' },
    take: 500,
  });

  const headers = ['SKU', 'Barcode', 'Product', 'Category', 'In Stock', 'Reorder Lvl', 'Cost Price', 'Sell Price', 'Stock Value'];
  const rows = products.map((p) => [
    p.sku,
    p.barcode || '—',
    p.name,
    p.category?.name || 'Uncategorized',
    String(p.quantityInStock),
    String(p.reorderLevel),
    formatKES(p.costPrice),
    formatKES(p.pricePerUnit),
    formatKES(p.costPrice * p.quantityInStock),
  ]);

  const totalStockValue = products.reduce((s, p) => s + p.costPrice * p.quantityInStock, 0);
  const lowStock = products.filter((p) => p.quantityInStock <= p.reorderLevel).length;

  return {
    title: 'Inventory Report',
    subtitle: `${products.length} product(s) · ${lowStock} low/out of stock`,
    headers,
    rows,
    summary: [
      { label: 'Total Products', value: String(products.length) },
      { label: 'Low/Out of Stock', value: String(lowStock) },
      { label: 'Total Stock Value (Cost)', value: formatKES(totalStockValue) },
    ],
  };
}

async function buildDebtReport(ctx: ReportContext): Promise<ReportResult> {
  const debts = await db.debtLedger.findMany({
    where: { storeId: ctx.storeId, status: { in: ['OUTSTANDING', 'PARTIALLY_PAID', 'OVERDUE'] } },
    include: { customer: { select: { name: true, phone: true } } },
    orderBy: { dueDate: 'asc' },
    take: 500,
  });

  const headers = ['Customer', 'Phone', 'Original Debt', 'Amount Paid', 'Balance', 'Due Date', 'Status'];
  const rows = debts.map((d) => [
    d.customer?.name || '—',
    d.customer?.phone || '—',
    formatKES(d.originalAmount),
    formatKES(d.amountPaid),
    formatKES(d.balance),
    formatDate(d.dueDate),
    d.status,
  ]);

  const totalOutstanding = debts.reduce((s, d) => s + d.balance, 0);
  const overdue = debts.filter((d) => d.status === 'OVERDUE').length;

  return {
    title: 'Outstanding Debt Report',
    subtitle: `${debts.length} record(s) · ${overdue} overdue`,
    headers,
    rows,
    summary: [
      { label: 'Total Records', value: String(debts.length) },
      { label: 'Overdue', value: String(overdue) },
      { label: 'Total Outstanding', value: formatKES(totalOutstanding) },
    ],
  };
}

async function buildRentalsReport(ctx: ReportContext): Promise<ReportResult> {
  const rentals = await db.equipmentRental.findMany({
    where: { storeId: ctx.storeId },
    include: { customer: { select: { name: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const headers = ['Customer', 'Phone', 'Item', 'Start', 'End', 'Rate/Day', 'Total Charge', 'Deposit', 'Status'];
  const rows = rentals.map((r) => [
    r.customer?.name || '—',
    r.customer?.phone || '—',
    r.equipmentName,
    formatDate(r.rentalStartDate),
    formatDate(r.expectedReturnDate),
    formatKES(r.ratePerDay),
    formatKES(r.totalRentalCharge),
    formatKES(r.securityDeposit),
    r.status,
  ]);

  const totalCharge = rentals.reduce((s, r) => s + r.totalRentalCharge, 0);
  const totalDeposits = rentals.reduce((s, r) => s + r.securityDeposit, 0);

  return {
    title: 'Equipment Rentals Report',
    subtitle: `${rentals.length} rental(s)`,
    headers,
    rows,
    summary: [
      { label: 'Total Rentals', value: String(rentals.length) },
      { label: 'Total Charges', value: formatKES(totalCharge) },
      { label: 'Total Deposits Held', value: formatKES(totalDeposits) },
    ],
  };
}

// ── HTML template ────────────────────────────────────────────────────────────

function buildHtmlReport(
  report: ReportResult,
  storeName: string,
  storeLocation: string,
  storePhone: string,
  storeTaxPin: string | undefined,
  dateFrom: string,
  dateTo: string
): string {
  const generatedAt = new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
  const logoDataUri = getLogoDataUri();
  const logoHtml = logoDataUri
    ? `<img src="${logoDataUri}" alt="MBUMAH HARDWARE" class="logo" />`
    : '';

  const summaryHtml = report.summary && report.summary.length > 0
    ? `<div class="summary">
         ${report.summary.map((s) => `
           <div class="summary-item">
             <span class="summary-label">${escapeHtml(s.label)}</span>
             <span class="summary-value">${escapeHtml(s.value)}</span>
           </div>
         `).join('')}
       </div>`
    : '';

  const tableHtml = report.rows.length > 0
    ? `<table>
         <thead><tr>${report.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
         <tbody>
           ${report.rows.map((row, i) => `
             <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
               ${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}
             </tr>
           `).join('')}
         </tbody>
       </table>`
    : '<p class="no-data">No records found for the selected period.</p>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(report.title)} — MBUMAH HARDWARE</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1a1a1a; background: #fff; padding: 32px; font-size: 12px;
    }
    .header { display: flex; align-items: center; gap: 20px; border-bottom: 3px solid #0f766e; padding-bottom: 16px; margin-bottom: 20px; }
    .logo { max-width: 90px; max-height: 90px; }
    .company-info { flex: 1; }
    .company-name { font-size: 22px; font-weight: 800; color: #0f766e; letter-spacing: 0.5px; }
    .company-branch { font-size: 14px; font-weight: 600; margin-top: 2px; }
    .company-meta { font-size: 11px; color: #555; margin-top: 4px; line-height: 1.5; }
    .report-title-block { margin-bottom: 16px; }
    .report-title { font-size: 18px; font-weight: 700; color: #1a1a1a; }
    .report-subtitle { font-size: 12px; color: #666; margin-top: 2px; }
    .report-period {
      display: inline-block; background: #f0fdfa; color: #0f766e;
      padding: 4px 12px; border-radius: 4px; font-size: 11px; font-weight: 600;
      margin-top: 6px;
    }
    .summary { display: flex; gap: 16px; margin: 16px 0; flex-wrap: wrap; }
    .summary-item {
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;
      padding: 10px 16px; min-width: 140px;
    }
    .summary-label { display: block; font-size: 10px; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; }
    .summary-value { display: block; font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 11px; }
    thead th {
      background: #0f766e; color: #fff; text-align: left; padding: 8px 10px;
      font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px;
    }
    tbody td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
    tbody tr.even { background: #fff; }
    tbody tr.odd { background: #f8fafc; }
    tbody tr:hover { background: #ecfdf5; }
    .no-data { text-align: center; padding: 40px; color: #94a3b8; font-style: italic; }
    .footer {
      margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0;
      font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between;
    }
    .footer .brand { color: #0f766e; font-weight: 600; }
    @media print {
      body { padding: 12px; }
      .header { page-break-after: avoid; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; }
      thead { display: table-header-group; }
    }
  </style>
</head>
<body>
  <div class="header">
    ${logoHtml}
    <div class="company-info">
      <div class="company-name">MBUMAH HARDWARE</div>
      <div class="company-branch">${escapeHtml(storeName)}</div>
      <div class="company-meta">
        ${escapeHtml(storeLocation)}<br />
        Tel: ${escapeHtml(storePhone)}${storeTaxPin ? ' · PIN: ' + escapeHtml(storeTaxPin) : ''}<br />
        info@mbumahhardware.co.ke · www.mbumahhardware.co.ke
      </div>
    </div>
  </div>

  <div class="report-title-block">
    <div class="report-title">${escapeHtml(report.title)}</div>
    <div class="report-subtitle">${escapeHtml(report.subtitle)}</div>
    <div class="report-period">
      Period: ${dateFrom ? escapeHtml(formatDate(new Date(dateFrom))) : 'Beginning'} → ${dateTo ? escapeHtml(formatDate(new Date(dateTo))) : 'Today'}
    </div>
  </div>

  ${summaryHtml}
  ${tableHtml}

  <div class="footer">
    <span>Generated: ${escapeHtml(generatedAt)} (EAT)</span>
    <span class="brand">MBUMAH HARDWARE POS &amp; ERP © 2026</span>
  </div>
</body>
</html>`;
}

// ── Route handler ────────────────────────────────────────────────────────────

async function getExportPdfHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const type = searchParams.get('type') || 'sales';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';

  // Fetch store info for the header
  const store = await db.store.findUnique({
    where: { id: storeId },
    select: { name: true, location: true, phone: true, taxPin: true, address: true },
  });

  const storeName = store?.name || 'MBUMAH HARDWARE';
  const storeLocation = store?.location || store?.address || '';
  const storePhone = store?.phone || '0795191909';
  const storeTaxPin = store?.taxPin || undefined;

  const ctx: ReportContext = { storeId, dateFrom, dateTo };

  let report: ReportResult;
  switch (type) {
    case 'sales': report = await buildSalesReport(ctx); break;
    case 'inventory': report = await buildInventoryReport(ctx); break;
    case 'debt': report = await buildDebtReport(ctx); break;
    case 'rentals': report = await buildRentalsReport(ctx); break;
    default:
      return Response.json(
        { success: false, error: 'Invalid export type. Supported: sales, inventory, debt, rentals' },
        { status: 400 }
      );
  }

  await systemLog({
    action: 'PDF_REPORT_GENERATED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `PDF report generated: ${type} (${report.rows.length} rows)`,
    storeId,
    metadata: { type, rowCount: report.rows.length, dateFrom, dateTo },
  });

  const html = buildHtmlReport(report, storeName, storeLocation, storePhone, storeTaxPin, dateFrom, dateTo);

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="${type}_report.html"`,
    },
  });
}

export const GET = withErrorBoundary(getExportPdfHandler, 'REPORTS_EXPORT_PDF');
