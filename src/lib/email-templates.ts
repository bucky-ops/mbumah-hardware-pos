// ════════════════════════════════════════════════════════════════════════════
// src/lib/email-templates.ts
// ════════════════════════════════════════════════════════════════════════════
//
// Reusable HTML email templates for the MBUMAH HARDWARE POS notification
// service. Each export is a pure function that takes a typed `data` payload
// and returns an HTML string. The HTML is intentionally self-contained
// (inline CSS, no external images) so it renders correctly in every mail
// client — including Gmail's HTML sanitizer and Outlook's Word-based engine.
//
// Design system:
//   • Primary color: emerald (#10b981) — matches the in-app accent
//   • Body text: dark gray (#1f2937 / #374151)
//   • Max width: 600px (industry standard for mobile-friendly email)
//   • Logo area: text-based "MBUMAH HARDWARE" wordmark (no external images
//     avoids broken-image icons in sandboxed/preview environments)
//   • Support phone: 0795 191 909 (Kenyan hotline)
//
// All templates are SSR-safe (no `window` / `document` references) and may
// be imported by both server-only email-service.ts and server components.

// ── Shared branding constants ────────────────────────────────────────────────

const BRAND = {
  name: 'MBUMAH HARDWARE',
  tagline: 'Hardware, Building Materials & Tools',
  phone: '0795 191 909',
  phoneFormatted: '0795 191 909',
  email: 'info@mbumahhardware.co.ke',
  website: 'www.mbumahhardware.co.ke',
  primary: '#10b981', // emerald-500
  primaryDark: '#059669', // emerald-600
  primaryLight: '#d1fae5', // emerald-100
  text: '#1f2937', // gray-800
  textMuted: '#6b7280', // gray-500
  border: '#e5e7eb', // gray-200
  bg: '#f9fafb', // gray-50
  white: '#ffffff',
  danger: '#dc2626', // red-600
  warning: '#f59e0b', // amber-500
} as const;

/** ISO currency formatter for Kenyan Shillings. */
function kes(amount: number | string | null | undefined): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : (amount ?? 0);
  if (Number.isNaN(n)) return 'KES 0.00';
  return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Common HTML wrapper — header, footer, and basic responsive styles. */
function emailShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${title}</title>
  <style>
    /* Reset + responsive */
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; background-color: ${BRAND.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: ${BRAND.text}; }
    table { border-collapse: collapse; width: 100%; }
    img { max-width: 100%; height: auto; }
    a { color: ${BRAND.primaryDark}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .wrapper { width: 100%; padding: 24px 12px; }
    .container { max-width: 600px; margin: 0 auto; background: ${BRAND.white}; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .header { background: ${BRAND.primary}; padding: 28px 32px; color: ${BRAND.white}; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
    .header p { margin: 4px 0 0 0; font-size: 12px; opacity: 0.9; }
    .content { padding: 32px; }
    .content h2 { margin: 0 0 16px 0; font-size: 18px; color: ${BRAND.text}; }
    .content p { line-height: 1.6; margin: 0 0 12px 0; font-size: 14px; color: ${BRAND.text}; }
    .footer { background: ${BRAND.bg}; padding: 20px 32px; border-top: 1px solid ${BRAND.border}; font-size: 12px; color: ${BRAND.textMuted}; text-align: center; }
    .footer a { color: ${BRAND.textMuted}; }
    .btn { display: inline-block; background: ${BRAND.primary}; color: ${BRAND.white} !important; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none; }
    .btn:hover { background: ${BRAND.primaryDark}; }
    .alert { padding: 14px 16px; border-radius: 8px; font-size: 13px; margin: 16px 0; }
    .alert-warning { background: #fef3c7; border-left: 4px solid ${BRAND.warning}; color: #92400e; }
    .alert-danger { background: #fee2e2; border-left: 4px solid ${BRAND.danger}; color: #991b1b; }
    .alert-success { background: ${BRAND.primaryLight}; border-left: 4px solid ${BRAND.primary}; color: #065f46; }
    .table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    .table th { background: ${BRAND.bg}; text-align: left; padding: 10px 12px; font-weight: 600; color: ${BRAND.text}; border-bottom: 2px solid ${BRAND.border}; }
    .table td { padding: 10px 12px; border-bottom: 1px solid ${BRAND.border}; }
    .table tr:last-child td { border-bottom: none; }
    .table tfoot td { border-top: 2px solid ${BRAND.border}; font-weight: 600; }
    .totals { margin: 16px 0; padding: 16px; background: ${BRAND.bg}; border-radius: 8px; }
    .totals-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
    .totals-row.grand { font-size: 16px; font-weight: 700; color: ${BRAND.primaryDark}; border-top: 2px solid ${BRAND.border}; padding-top: 12px; margin-top: 8px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 16px 0; }
    .kpi { background: ${BRAND.bg}; border-radius: 8px; padding: 16px; text-align: center; }
    .kpi .label { font-size: 11px; color: ${BRAND.textMuted}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .kpi .value { font-size: 20px; font-weight: 700; color: ${BRAND.text}; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }
    .badge-out { background: #fee2e2; color: #991b1b; }
    .badge-low { background: #fef3c7; color: #92400e; }
    @media only screen and (max-width: 480px) {
      .content { padding: 20px !important; }
      .header { padding: 20px !important; }
      .kpi-grid { grid-template-columns: 1fr !important; }
      .table { font-size: 12px !important; }
      .table th, .table td { padding: 8px !important; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>${BRAND.name}</h1>
        <p>${BRAND.tagline}</p>
      </div>
      <div class="content">
        ${bodyHtml}
      </div>
      <div class="footer">
        <p><strong>${BRAND.name}</strong> &middot; ${BRAND.phoneFormatted} &middot; <a href="mailto:${BRAND.email}">${BRAND.email}</a></p>
        <p>${BRAND.website}</p>
        <p style="margin-top: 8px; font-size: 11px;">This is an automated message. Please do not reply directly to this email.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ── Template data types ──────────────────────────────────────────────────────

export interface ReceiptItemRow {
  productName: string;
  sku?: string;
  quantity: number | string;
  unitType?: string;
  pricePerUnit: number | string;
  discountPercent?: number | string;
  lineTotal: number | string;
}

export interface ReceiptTemplateData {
  customerName: string;
  receiptNumber: string;
  transactionDate?: string;
  items: ReceiptItemRow[];
  subtotal: number | string;
  taxAmount: number | string;
  discountAmount?: number | string;
  totalAmount: number | string;
  paymentMethod: string;
  paymentStatus?: string;
  mpesaReference?: string;
  cashierName?: string;
  storeName: string;
  storeLocation?: string;
  storePhone?: string;
  storeTaxPin?: string;
}

export interface LowStockProductRow {
  name: string;
  sku?: string;
  currentStock: number | string;
  reorderLevel: number | string;
  unitType?: string;
  supplierName?: string;
  category?: string;
}

export interface LowStockTemplateData {
  storeName: string;
  products: LowStockProductRow[];
  generatedAt?: string;
}

export interface DailyReportTemplateData {
  storeName: string;
  date: string;
  totalSales: number | string;
  totalTransactions: number;
  averageTransaction: number | string;
  totalTax: number | string;
  totalDiscounts?: number | string;
  topProducts: Array<{ name: string; quantity: number | string; revenue: number | string }>;
  paymentBreakdown: Array<{ method: string; count: number; amount: number | string }>;
  lowStockCount?: number;
}

export interface WelcomeTemplateData {
  customerName: string;
  storeName?: string;
  loyaltyTier?: string;
  loyaltyPoints?: number;
}

export interface PasswordResetTemplateData {
  customerName?: string;
  resetLink: string;
  expiryHours?: number;
}

export interface TierUpgradeTemplateData {
  customerName: string;
  newTier: string;
  storeName?: string;
}

// ── Templates ────────────────────────────────────────────────────────────────

/**
 * Professional receipt email — itemized table, totals, payment method, and
 * M-Pesa reference (when applicable). Mirrors the printed receipt layout.
 */
export function receiptTemplate(data: ReceiptTemplateData): string {
  const rows = (data.items || [])
    .map(
      (item) => `
      <tr>
        <td>
          <strong>${item.productName}</strong>
          ${item.sku ? `<br/><span style="font-size:11px;color:${BRAND.textMuted}">SKU: ${item.sku}</span>` : ''}
        </td>
        <td style="text-align:center;">${item.quantity} ${item.unitType ? item.unitType.toLowerCase() : ''}</td>
        <td style="text-align:right;">${kes(item.pricePerUnit)}</td>
        <td style="text-align:right;">${kes(item.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  const paymentStatusBadge = data.paymentStatus
    ? `<span class="badge ${data.paymentStatus === 'COMPLETED' ? 'badge-low' : 'badge-out'}" style="margin-left:8px;">${data.paymentStatus}</span>`
    : '';

  const mpesaRow = data.mpesaReference
    ? `<div class="totals-row"><span>M-Pesa Reference</span><span><strong>${data.mpesaReference}</strong></span></div>`
    : '';

  const discountRow =
    data.discountAmount && Number(data.discountAmount) > 0
      ? `<div class="totals-row"><span>Discount</span><span>− ${kes(data.discountAmount)}</span></div>`
      : '';

  return emailShell(
    `Receipt ${data.receiptNumber}`,
    `
    <h2>Payment Receipt</h2>
    <p>Dear <strong>${data.customerName}</strong>,</p>
    <p>Thank you for shopping with us. Here is your receipt for the transaction below.</p>

    <div style="background:${BRAND.bg};padding:14px 16px;border-radius:8px;margin:16px 0;font-size:13px;">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div>
          <strong>${data.storeName}</strong><br/>
          ${data.storeLocation ? `${data.storeLocation}<br/>` : ''}
          ${data.storePhone ? `Tel: ${data.storePhone}<br/>` : ''}
          ${data.storeTaxPin ? `KRA PIN: ${data.storeTaxPin}` : ''}
        </div>
        <div style="text-align:right;">
          <strong>Receipt #${data.receiptNumber}</strong><br/>
          ${data.transactionDate ? `${data.transactionDate}<br/>` : ''}
          ${data.cashierName ? `Served by: ${data.cashierName}` : ''}
        </div>
      </div>
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>Item</th>
          <th style="text-align:center;">Qty</th>
          <th style="text-align:right;">Price</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="4" style="text-align:center;color:' + BRAND.textMuted + '">No items</td></tr>'}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row"><span>Subtotal</span><span>${kes(data.subtotal)}</span></div>
      ${discountRow}
      <div class="totals-row"><span>VAT (16%)</span><span>${kes(data.taxAmount)}</span></div>
      <div class="totals-row grand"><span>Total Paid</span><span>${kes(data.totalAmount)}</span></div>
    </div>

    <div class="totals">
      <div class="totals-row"><span>Payment Method</span><span><strong>${data.paymentMethod}</strong>${paymentStatusBadge}</span></div>
      ${mpesaRow}
    </div>

    <div class="alert alert-success">
      Please retain this receipt for warranty and return purposes. Goods returned must be accompanied by this receipt.
    </div>

    <p style="font-size:12px;color:${BRAND.textMuted};">For inquiries, call us on <strong>${BRAND.phoneFormatted}</strong> or email <a href="mailto:${BRAND.email}">${BRAND.email}</a>.</p>
  `,
  );
}

/**
 * Low-stock alert email — table of products at or below reorder level with
 * current stock, reorder level, and supplier contact for quick reordering.
 */
export function lowStockTemplate(data: LowStockTemplateData): string {
  const rows = (data.products || [])
    .map((p) => {
      const current = Number(p.currentStock) || 0;
      const reorder = Number(p.reorderLevel) || 0;
      const badge =
        current <= 0
          ? '<span class="badge badge-out">OUT OF STOCK</span>'
          : '<span class="badge badge-low">LOW STOCK</span>';
      return `
        <tr>
          <td>
            <strong>${p.name}</strong>
            ${p.sku ? `<br/><span style="font-size:11px;color:${BRAND.textMuted}">${p.sku}</span>` : ''}
            ${p.category ? `<br/><span style="font-size:11px;color:${BRAND.textMuted}">${p.category}</span>` : ''}
          </td>
          <td style="text-align:center;">${badge}</td>
          <td style="text-align:center;">${current} ${p.unitType ? p.unitType.toLowerCase() : ''}</td>
          <td style="text-align:center;">${reorder}</td>
          <td>${p.supplierName || '<span style="color:' + BRAND.textMuted + '">—</span>'}</td>
        </tr>`;
    })
    .join('');

  return emailShell(
    'Low Stock Alert',
    `
    <h2>⚠️ Low Stock Alert</h2>
    <p>An inventory review for <strong>${data.storeName}</strong> identified ${data.products.length} product(s) at or below their reorder level.</p>
    ${data.generatedAt ? `<p style="font-size:12px;color:${BRAND.textMuted};">Generated: ${data.generatedAt}</p>` : ''}

    <table class="table">
      <thead>
        <tr>
          <th>Product</th>
          <th style="text-align:center;">Status</th>
          <th style="text-align:center;">Current</th>
          <th style="text-align:center;">Reorder At</th>
          <th>Supplier</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="5" style="text-align:center;color:' + BRAND.textMuted + '">No low-stock items</td></tr>'}
      </tbody>
    </table>

    <div class="alert alert-warning">
      <strong>Action required:</strong> Please review the supplier contacts above and create purchase orders to replenish stock before items run out completely.
    </div>

    <p style="font-size:12px;color:${BRAND.textMuted};">Need help? Call <strong>${BRAND.phoneFormatted}</strong>.</p>
  `,
  );
}

/**
 * Daily sales report email — KPIs, top products, and payment breakdown for
 * end-of-day reconciliation.
 */
export function dailyReportTemplate(data: DailyReportTemplateData): string {
  const topProductsRows = (data.topProducts || [])
    .slice(0, 10)
    .map(
      (p, idx) => `
      <tr>
        <td style="text-align:center;width:32px;">${idx + 1}</td>
        <td>${p.name}</td>
        <td style="text-align:center;">${p.quantity}</td>
        <td style="text-align:right;">${kes(p.revenue)}</td>
      </tr>`,
    )
    .join('');

  const paymentRows = (data.paymentBreakdown || [])
    .map(
      (p) => `
      <tr>
        <td><strong>${p.method}</strong></td>
        <td style="text-align:center;">${p.count}</td>
        <td style="text-align:right;">${kes(p.amount)}</td>
      </tr>`,
    )
    .join('');

  return emailShell(
    `Daily Sales Report — ${data.date}`,
    `
    <h2>Daily Sales Report</h2>
    <p><strong>${data.storeName}</strong> &middot; ${data.date}</p>

    <div class="kpi-grid">
      <div class="kpi">
        <div class="label">Total Sales</div>
        <div class="value">${kes(data.totalSales)}</div>
      </div>
      <div class="kpi">
        <div class="label">Transactions</div>
        <div class="value">${data.totalTransactions}</div>
      </div>
      <div class="kpi">
        <div class="label">Average Sale</div>
        <div class="value">${kes(data.averageTransaction)}</div>
      </div>
      <div class="kpi">
        <div class="label">VAT Collected</div>
        <div class="value">${kes(data.totalTax)}</div>
      </div>
    </div>

    ${data.totalDiscounts && Number(data.totalDiscounts) > 0 ? `<p style="font-size:13px;">Total Discounts Given: <strong>${kes(data.totalDiscounts)}</strong></p>` : ''}

    <h3 style="font-size:15px;margin:24px 0 8px 0;">Top Products</h3>
    <table class="table">
      <thead>
        <tr>
          <th style="text-align:center;width:32px;">#</th>
          <th>Product</th>
          <th style="text-align:center;">Qty Sold</th>
          <th style="text-align:right;">Revenue</th>
        </tr>
      </thead>
      <tbody>
        ${topProductsRows || '<tr><td colspan="4" style="text-align:center;color:' + BRAND.textMuted + '">No sales recorded</td></tr>'}
      </tbody>
    </table>

    <h3 style="font-size:15px;margin:24px 0 8px 0;">Payment Method Breakdown</h3>
    <table class="table">
      <thead>
        <tr>
          <th>Method</th>
          <th style="text-align:center;">Count</th>
          <th style="text-align:right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${paymentRows || '<tr><td colspan="3" style="text-align:center;color:' + BRAND.textMuted + '">No payments recorded</td></tr>'}
      </tbody>
    </table>

    ${data.lowStockCount && data.lowStockCount > 0 ? `<div class="alert alert-warning"><strong>${data.lowStockCount}</strong> product(s) are low on stock. Please review the inventory dashboard.</div>` : ''}

    <p style="font-size:12px;color:${BRAND.textMuted};">This report was generated automatically. For discrepancies, contact your branch manager or call <strong>${BRAND.phoneFormatted}</strong>.</p>
  `,
  );
}

/**
 * Welcome email sent to new customers — includes loyalty program info.
 */
export function welcomeTemplate(data: WelcomeTemplateData): string {
  return emailShell(
    'Welcome to MBUMAH HARDWARE',
    `
    <h2>Welcome, ${data.customerName}! 👋</h2>
    <p>Thank you for joining the <strong>${BRAND.name}</strong> family. We're delighted to have you as a customer${data.storeName ? ` at our <strong>${data.storeName}</strong> branch` : ''}.</p>

    <div class="alert alert-success">
      <strong>Your Benefits:</strong>
      <ul style="margin:8px 0 0 0;padding-left:20px;">
        <li>Earn loyalty points on every purchase (1 point per KES 100 spent)</li>
        <li>Redeem points for discounts (100 points = KES 10 off)</li>
        <li>Progress through tiers: BRONZE → SILVER → GOLD → PLATINUM</li>
        <li>Exclusive offers and early access to promotions</li>
      </ul>
    </div>

    ${data.loyaltyTier ? `<p>You're currently on the <strong>${data.loyaltyTier}</strong> tier${typeof data.loyaltyPoints === 'number' ? ` with <strong>${data.loyaltyPoints} points</strong>` : ''}. Keep shopping to unlock more rewards!</p>` : ''}

    <p style="text-align:center;margin:24px 0;">
      <a href="https://${BRAND.website}" class="btn">Visit Our Store</a>
    </p>

    <p style="font-size:12px;color:${BRAND.textMuted};">Questions? Call us on <strong>${BRAND.phoneFormatted}</strong> or email <a href="mailto:${BRAND.email}">${BRAND.email}</a>. We're here to help!</p>
  `,
  );
}

/**
 * Password reset email — contains a time-limited reset link.
 */
export function passwordResetTemplate(data: PasswordResetTemplateData): string {
  const expiry = data.expiryHours ?? 1;
  return emailShell(
    'Password Reset Request',
    `
    <h2>Reset Your Password</h2>
    <p>Hello${data.customerName ? ` <strong>${data.customerName}</strong>` : ''},</p>
    <p>We received a request to reset your ${BRAND.name} account password. Click the button below to set a new password:</p>

    <p style="text-align:center;margin:24px 0;">
      <a href="${data.resetLink}" class="btn">Reset Password</a>
    </p>

    <div class="alert alert-warning">
      <strong>This link will expire in ${expiry} hour${expiry !== 1 ? 's' : ''}.</strong> If you did not request a password reset, please ignore this email or contact support immediately if you suspect unauthorized access.
    </div>

    <p style="font-size:12px;color:${BRAND.textMuted};word-break:break-all;">If the button above doesn't work, copy and paste this URL into your browser:<br/><a href="${data.resetLink}">${data.resetLink}</a></p>

    <p style="font-size:12px;color:${BRAND.textMuted};">For help, call <strong>${BRAND.phoneFormatted}</strong>.</p>
  `,
  );
}

/**
 * Loyalty tier upgrade congratulatory email — lists new tier benefits.
 */
export function tierUpgradeTemplate(data: TierUpgradeTemplateData): string {
  const tierBenefits: Record<string, string[]> = {
    BRONZE: ['1 point per KES 100 spent', 'Birthday discount voucher'],
    SILVER: ['1.25 points per KES 100 spent', '5% bonus on bulk purchases', 'Priority customer support'],
    GOLD: ['1.5 points per KES 100 spent', 'Free delivery on orders over KES 5,000', 'Exclusive monthly offers', 'Extended warranty on tools'],
    PLATINUM: ['2 points per KES 100 spent', 'Free delivery on all orders', 'Dedicated account manager', 'Early access to new stock', 'Quarterly business review'],
  };
  const benefits = tierBenefits[data.newTier] || tierBenefits.BRONZE;
  const benefitsHtml = benefits.map((b) => `<li>${b}</li>`).join('');

  return emailShell(
    `You're now ${data.newTier}! 🎉`,
    `
    <h2>Congratulations, ${data.customerName}! 🎉</h2>
    <p>Great news! You've been upgraded to the <strong>${data.newTier}</strong> loyalty tier${data.storeName ? ` at ${data.storeName}` : ''}.</p>

    <div class="alert alert-success">
      <strong>Your new ${data.newTier} benefits:</strong>
      <ul style="margin:8px 0 0 0;padding-left:20px;">
        ${benefitsHtml}
      </ul>
    </div>

    <p>Thank you for your continued loyalty to ${BRAND.name}. We appreciate your business and look forward to serving you again soon!</p>

    <p style="text-align:center;margin:24px 0;">
      <a href="https://${BRAND.website}" class="btn">Start Shopping</a>
    </p>

    <p style="font-size:12px;color:${BRAND.textMuted};">Questions about your rewards? Call <strong>${BRAND.phoneFormatted}</strong>.</p>
  `,
  );
}

// ── Plain-text fallbacks (for accessibility / non-HTML clients) ──────────────

/** Plain-text receipt for email clients that don't render HTML. */
export function receiptText(data: ReceiptTemplateData): string {
  const lines: string[] = [];
  lines.push(`${BRAND.name}`);
  lines.push(`${BRAND.tagline}`);
  lines.push(`Tel: ${BRAND.phoneFormatted}`);
  lines.push('');
  lines.push(`RECEIPT #${data.receiptNumber}`);
  if (data.transactionDate) lines.push(`Date: ${data.transactionDate}`);
  if (data.cashierName) lines.push(`Cashier: ${data.cashierName}`);
  if (data.storeName) lines.push(`Store: ${data.storeName}`);
  lines.push('='.repeat(48));
  for (const item of data.items || []) {
    lines.push(
      `${item.productName} x${item.quantity} @ ${kes(item.pricePerUnit)} = ${kes(item.lineTotal)}`,
    );
  }
  lines.push('-'.repeat(48));
  lines.push(`Subtotal: ${kes(data.subtotal)}`);
  if (data.discountAmount && Number(data.discountAmount) > 0)
    lines.push(`Discount: -${kes(data.discountAmount)}`);
  lines.push(`VAT: ${kes(data.taxAmount)}`);
  lines.push(`TOTAL: ${kes(data.totalAmount)}`);
  lines.push(`Payment: ${data.paymentMethod}`);
  if (data.mpesaReference) lines.push(`M-Pesa Ref: ${data.mpesaReference}`);
  lines.push('');
  lines.push(`Thank you for shopping with us!`);
  return lines.join('\n');
}
