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
// Task 12-b: Prisma Decimal valueOf() returns a STRING — `number + decimal`
// concatenates. Totals below accumulate via toDec(); formatKES (canonical 2dp
// en-KE formatter) is kept from '@/lib/helpers'.
import { toDec, round2 } from '@/lib/utils/financialMath';
import { readFileSync } from 'fs';
import { join } from 'path';
import { withSessionAuth, MANAGER_PLUS_ROLES } from '@/lib/auth';

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

  const totalSubtotal = transactions.reduce((acc, t) => acc.plus(toDec(t.subtotal)), toDec(0)).toNumber();
  const totalVat = transactions.reduce((acc, t) => acc.plus(toDec(t.taxAmount)), toDec(0)).toNumber();
  const totalAmount = transactions.reduce((acc, t) => acc.plus(toDec(t.totalAmount)), toDec(0)).toNumber();

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
    formatKES(toDec(p.quantityInStock).mul(toDec(p.costPrice)).toNumber()),
  ]);

  const totalStockValue = products.reduce(
    (acc, p) => acc.plus(toDec(p.quantityInStock).mul(toDec(p.costPrice))),
    toDec(0),
  ).toNumber();
  // Task 12-b: reorder-level comparison in Decimal — Decimals coerce to STRINGS
  // under `<=` (lexicographic: "10" <= "5" is true!), so use Decimal.lte.
  const lowStock = products.filter((p) => toDec(p.quantityInStock).lte(toDec(p.reorderLevel))).length;

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
    // Task 12-b fix: DebtLedger has no `originalAmount` column — the original
    // debt is `amountOwed` (was rendering undefined → "KES 0.00").
    formatKES(d.amountOwed),
    formatKES(d.amountPaid),
    formatKES(d.balance),
    formatDate(d.dueDate),
    d.status,
  ]);

  const totalOutstanding = debts.reduce((acc, d) => acc.plus(toDec(d.balance)), toDec(0)).toNumber();
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
    include: {
      customer: { select: { name: true, phone: true } },
      // Task 12-b fix: EquipmentRental has no `equipmentName` column — the item
      // is identified through its product relation.
      product: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const headers = ['Customer', 'Phone', 'Item', 'Start', 'End', 'Rate/Day', 'Total Charge', 'Deposit', 'Status'];
  const rows = rentals.map((r) => [
    r.customer?.name || '—',
    r.customer?.phone || '—',
    r.product?.name || '—',
    formatDate(r.rentalStartDate),
    formatDate(r.expectedReturnDate),
    formatKES(r.ratePerDay),
    formatKES(r.totalRentalCharge),
    formatKES(r.securityDeposit),
    r.status,
  ]);

  const totalCharge = rentals.reduce((acc, r) => acc.plus(toDec(r.totalRentalCharge)), toDec(0)).toNumber();
  const totalDeposits = rentals.reduce((acc, r) => acc.plus(toDec(r.securityDeposit)), toDec(0)).toNumber();

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

// ═══════════════════════════════════════════════════════════════════════════
// R14 (v2.5.1): CUSTOMER ACCOUNT STATEMENT — full account history for ONE
// customer: statement table (chronological, running debt balance), activity
// timeline, SVG graphs, summary cards and auto-generated key highlights.
// Query: type=customer-statement&customerId=…&storeId=…
// ═══════════════════════════════════════════════════════════════════════════

function formatDateTimeEAT(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-KE', {
    timeZone: 'Africa/Nairobi',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

interface StatementEntry {
  at: Date;
  activity: string;
  icon: string;          // emoji marker for the timeline
  tone: 'in' | 'out' | 'info' | 'warn';
  reference: string;
  details: string;
  /** Amount the customer OWES the store (increases debt balance). */
  debit: number;
  /** Amount the customer PAID / was charged against what they owe. */
  credit: number;
  /** Memo-only row (deposit held/released) — excluded from debt balance. */
  memo: boolean;
}

interface StatementData {
  customer: {
    name: string; phone: string; email: string | null; idNumber: string | null;
    currentDebtBalance: number; debtLimit: number; loyaltyPoints: number;
    loyaltyTier: string; joinedAt: Date;
  };
  entries: StatementEntry[];
  rentals: {
    id: string; productName: string; sku: string; status: string;
    start: Date; end: Date | null; expected: Date;
    deposit: number; charge: number; lateFee: number; damage: number;
  }[];
  totals: {
    purchases: number;        // Σ sales transaction totals
    amountPaidSales: number;  // sales actually settled (COMPLETED)
    debtCharged: number;      // Σ debt ledger amounts owed
    debtPaid: number;         // Σ debt payments
    rentalCharges: number;    // Σ rental charges incl. late + damage
    depositsHeld: number;     // deposits on ACTIVE/OVERDUE rentals
    depositsReleased: number; // deposits on returned rentals
    refundsGiven: number;     // cash refunded from deposits
  };
  counts: { sales: number; rentals: number; activeRentals: number; payments: number };
}

async function loadCustomerStatement(storeId: string, customerId: string): Promise<StatementData | null> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: {
      name: true, phone: true, email: true, idNumber: true,
      currentDebtBalance: true, debtLimit: true, loyaltyPoints: true,
      loyaltyTier: true, joinedAt: true, storeId: true,
    },
  });
  if (!customer || customer.storeId !== storeId) return null;

  const [transactions, ledgers, rentals] = await Promise.all([
    db.salesTransaction.findMany({
      where: { storeId, customerId },
      include: {
        cashier: { select: { name: true } },
        // For the statement detail line (item count) without pulling every row.
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    }),
    db.debtLedger.findMany({
      where: { storeId, customerId },
      include: {
        debtPayments: { orderBy: { createdAt: 'asc' } },
        transaction: { select: { receiptNumber: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
    db.equipmentRental.findMany({
      where: { storeId, customerId },
      include: { product: { select: { name: true, sku: true } } },
      orderBy: { rentalStartDate: 'asc' },
      take: 200,
    }),
  ]);

  const entries: StatementEntry[] = [];
  const n = (v: unknown): number => toDec(v as never).toNumber();

  // ── Sales ──
  let purchases = 0;
  let amountPaidSales = 0;
  for (const t of transactions) {
    purchases += n(t.totalAmount);
    if (t.paymentStatus === 'COMPLETED') amountPaidSales += n(t.totalAmount);
    const isDebt = t.paymentMethod === 'DEBT';
    // R15 FIX (v2.5.1): a DEBT-method sale and the debt-ledger row auto-created
    // from it are the SAME credit event — the ledger row (which carries the
    // due date + status) is the authoritative charge. The sale row is shown
    // balance-neutral here so the running balance does not DOUBLE-COUNT the
    // amount (Caroline's statement showed 12,696 instead of 6,348). Cash /
    // M-Pesa sales are settled instantly (debit = credit = total, net zero).
    entries.push({
      at: t.createdAt,
      activity: t.transactionType === 'REFUND' ? 'Sales refund' : 'Purchase (sale)',
      icon: t.transactionType === 'REFUND' ? '↩️' : '🛒',
      tone: t.transactionType === 'REFUND' ? 'info' : (isDebt ? 'out' : 'in'),
      reference: t.receiptNumber,
      details:
        `${t._count.items} item(s) · ${t.paymentMethod}` +
        (t.cashier?.name ? ` · served by ${t.cashier.name}` : '') +
        (isDebt ? ' · taken on store credit (charged to account below)' : ''),
      debit: t.transactionType === 'REFUND' ? 0 : (isDebt ? 0 : n(t.totalAmount)),
      credit: t.transactionType === 'REFUND' ? n(t.totalAmount) : (isDebt ? 0 : n(t.totalAmount)),
      memo: false,
    });
  }

  // ── Debt ledgers + payments ──
  let debtCharged = 0;
  let debtPaid = 0;
  for (const l of ledgers) {
    debtCharged += n(l.amountOwed);
    entries.push({
      at: l.createdAt,
      activity: 'Credit sale charged to account',
      icon: '📘',
      tone: 'warn',
      reference: l.transaction?.receiptNumber || l.id.slice(-8).toUpperCase(),
      details: `Due ${formatDate(l.dueDate)} · status ${l.status}`,
      debit: n(l.amountOwed),
      credit: 0,
      memo: false,
    });
    for (const p of l.debtPayments) {
      debtPaid += n(p.amount);
      entries.push({
        at: p.createdAt,
        activity: 'Debt payment received',
        icon: '💵',
        tone: 'in',
        reference: p.reference || p.id.slice(-8).toUpperCase(),
        details: `${p.paymentMethod}${p.reference ? ` · ref ${p.reference}` : ''}`,
        debit: 0,
        credit: n(p.amount),
        memo: false,
      });
    }
  }

  // ── Rentals ──
  let rentalCharges = 0;
  let depositsHeld = 0;
  let depositsReleased = 0;
  let refundsGiven = 0;
  let activeRentals = 0;
  for (const r of rentals) {
    const deposit = n(r.securityDeposit);
    const charge = n(r.totalRentalCharge) + n(r.lateFeeAccumulated) + n(r.damageCharge);
    const returned = r.status === 'RETURNED' || r.status === 'DAMAGED' || r.status === 'LOST';
    if (returned) depositsReleased += deposit;
    else depositsHeld += deposit;
    if (r.status === 'ACTIVE' || r.status === 'OVERDUE') activeRentals += 1;
    rentalCharges += charge;

    entries.push({
      at: r.rentalStartDate,
      activity: `Rental started — ${r.product?.name || 'equipment'}`,
      icon: '🔑',
      tone: 'out',
      reference: r.id.slice(-8).toUpperCase(),
      details: `SKU ${r.product?.sku || '—'} · deposit ${formatKES(deposit)} · rate ${formatKES(r.ratePerDay)}/day · due ${formatDate(r.expectedReturnDate)}`,
      debit: 0,
      credit: 0,
      memo: false,
    });
    entries.push({
      at: r.rentalStartDate,
      activity: 'Security deposit paid (held)',
      icon: '🛡️',
      tone: 'info',
      reference: r.id.slice(-8).toUpperCase(),
      details: `Refundable deposit for ${r.product?.name || 'equipment'} — held as liability, not income`,
      debit: 0,
      credit: 0,
      memo: true,
    });

    if (returned) {
      // Deposit settlement: charges absorbed from the deposit; the rest refunded.
      const refund = Math.max(0, toDec(deposit).minus(charge).toNumber());
      refundsGiven += refund;
      entries.push({
        at: r.actualReturnDate || r.updatedAt,
        activity: `Rental returned — ${r.product?.name || 'equipment'}`,
        icon: '✅',
        tone: 'in',
        reference: r.id.slice(-8).toUpperCase(),
        details:
          `${charge > 0 ? `charges ${formatKES(charge)} (incl. late ${formatKES(n(r.lateFeeAccumulated))}, damage ${formatKES(n(r.damageCharge))})` : 'no charges'}` +
          (refund > 0 ? ` · refund ${formatKES(refund)}` : ''),
        debit: 0,
        credit: 0,
        memo: true,
      });
      if (charge > 0) {
        entries.push({
          at: r.actualReturnDate || r.updatedAt,
          activity: 'Rental charges applied',
          icon: '🧾',
          tone: 'out',
          reference: r.id.slice(-8).toUpperCase(),
          details: `Hire charge settled from the security deposit at return`,
          debit: charge,
          credit: charge,
          memo: false,
        });
      }
    }
  }

  entries.sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    customer: {
      name: customer.name,
      phone: customer.phone || '—',
      email: customer.email,
      idNumber: customer.idNumber,
      currentDebtBalance: n(customer.currentDebtBalance),
      debtLimit: n(customer.debtLimit),
      loyaltyPoints: customer.loyaltyPoints,
      loyaltyTier: customer.loyaltyTier,
      joinedAt: customer.joinedAt,
    },
    entries,
    rentals: rentals.map((r) => ({
      id: r.id,
      productName: r.product?.name || '—',
      sku: r.product?.sku || '—',
      status: r.status,
      start: r.rentalStartDate,
      end: r.actualReturnDate,
      expected: r.expectedReturnDate,
      deposit: n(r.securityDeposit),
      charge: n(r.totalRentalCharge),
      lateFee: n(r.lateFeeAccumulated),
      damage: n(r.damageCharge),
    })),
    totals: {
      purchases,
      amountPaidSales,
      debtCharged,
      debtPaid,
      rentalCharges,
      depositsHeld,
      depositsReleased,
      refundsGiven,
    },
    counts: {
      sales: transactions.length,
      rentals: rentals.length,
      activeRentals,
      payments: ledgers.reduce((acc, l) => acc + l.debtPayments.length, 0),
    },
  };
}

/** Horizontal bar chart (SVG) — money by category. */
function buildCategoryBarChart(rows: { label: string; value: number; color: string }[]): string {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const bars = rows.map((r) => {
    const pct = (Math.abs(r.value) / max) * 100;
    return `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(r.label)}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${r.color}"></div>
        </div>
        <div class="bar-value">${formatKES(r.value)}</div>
      </div>`;
  });
  return `<div class="chart-box">${bars.join('')}</div>`;
}

/** Debt balance area chart (SVG polyline) from the chronological entries. */
function buildBalanceChart(entries: StatementEntry[]): string {
  // Running DEBT balance = Σ(debit − credit) over non-memo entries.
  const points: { x: Date; y: number }[] = [];
  let balance = 0;
  for (const e of entries) {
    if (e.memo) continue;
    balance = round2(toDec(balance).plus(e.debit).minus(e.credit));
    points.push({ x: e.at, y: balance });
  }
  if (points.length === 0) {
    return '<p class="no-data">No balance movement yet.</p>';
  }

  const W = 660; const H = 170; const PAD_L = 56; const PAD_B = 26; const PAD_T = 12;
  const xs = points.map((p) => p.x.getTime());
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const ys = points.map((p) => p.y);
  const maxY = Math.max(1, ...ys.map((v) => Math.abs(v)));
  const spanX = Math.max(1, maxX - minX);
  const px = (t: number) => PAD_L + ((t - minX) / spanX) * (W - PAD_L - 12);
  const py = (v: number) => PAD_T + (1 - Math.min(1, Math.abs(v) / maxY)) * (H - PAD_T - PAD_B);

  const line = points.map((p) => `${px(p.x.getTime()).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');
  const area = `${PAD_L},${py(0)} ${line} ${px(points[points.length - 1].x.getTime()).toFixed(1)},${py(0)}`;
  const dots = points
    .map((p) => `<circle cx="${px(p.x.getTime()).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="3" fill="#0f766e" />`)
    .join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" class="balance-svg" role="img" aria-label="Account balance over time">
      <line x1="${PAD_L}" y1="${py(0)}" x2="${W - 12}" y2="${py(0)}" stroke="#e2e8f0" stroke-width="1" />
      <polygon points="${area}" fill="rgba(15,118,110,0.12)" />
      <polyline points="${line}" fill="none" stroke="#0f766e" stroke-width="2.5" stroke-linejoin="round" />
      ${dots}
      <text x="${PAD_L - 6}" y="${py(maxY) + 4}" text-anchor="end" class="svg-label">${formatKES(maxY)}</text>
      <text x="${PAD_L - 6}" y="${py(0) + 4}" text-anchor="end" class="svg-label">0</text>
      <text x="${PAD_L}" y="${H - 8}" class="svg-label">${escapeHtml(formatDateTimeEAT(points[0].x))}</text>
      <text x="${W - 12}" y="${H - 8}" text-anchor="end" class="svg-label">${escapeHtml(formatDateTimeEAT(points[points.length - 1].x))}</text>
    </svg>`;
}

interface StatementReport {
  title: string;
  data: StatementData;
  highlights: string[];
}

async function buildCustomerStatement(storeId: string, customerId: string): Promise<StatementReport | null> {
  const data = await loadCustomerStatement(storeId, customerId);
  if (!data) return null;

  const t = data.totals;
  const highlights: string[] = [];
  const debtBalance = t.debtCharged - t.debtPaid;
  const utilization = data.customer.debtLimit > 0
    ? Math.min(100, Math.round((debtBalance / data.customer.debtLimit) * 100))
    : 0;

  highlights.push(
    debtBalance > 0
      ? `Outstanding store credit: KES ${formatKES(debtBalance)} of a KES ${formatKES(data.customer.debtLimit)} limit (${utilization}% utilised).`
      : `Account is fully settled — no outstanding store credit.`
  );
  highlights.push(
    `Purchases to date: KES ${formatKES(t.purchases)} across ${data.counts.sales} transaction(s).`
  );
  if (data.counts.rentals > 0) {
    highlights.push(
      `Equipment rentals: ${data.counts.rentals} (active now: ${data.counts.activeRentals}) · hire charges KES ${formatKES(t.rentalCharges)}.`
    );
    highlights.push(
      `Deposits: KES ${formatKES(t.depositsHeld)} currently held · KES ${formatKES(t.depositsReleased)} released (refunds paid: KES ${formatKES(t.refundsGiven)}).`
    );
  }
  if (data.customer.loyaltyPoints > 0) {
    highlights.push(
      `Loyalty: ${data.customer.loyaltyPoints} points (${data.customer.loyaltyTier} tier) — worth about KES ${formatKES(data.customer.loyaltyPoints * 10)} in redeemable vouchers.`
    );
  }
  const last = data.entries[data.entries.length - 1];
  if (last) {
    highlights.push(`Last account activity: ${last.activity.toLowerCase()} on ${formatDateTimeEAT(last.at)}.`);
  }

  return { title: `Account Statement — ${data.customer.name}`, data, highlights };
}

// ── Statement HTML template (R14) ────────────────────────────────────────────

function buildHtmlStatement(
  report: StatementReport,
  storeName: string,
  storeLocation: string,
  storePhone: string,
  storeTaxPin: string | undefined,
): string {
  const generatedAt = new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
  const logoDataUri = getLogoDataUri();
  const logoHtml = logoDataUri
    ? `<img src="${logoDataUri}" alt="MBUMAH HARDWARE" class="logo" />`
    : '';
  const { data, highlights } = report;
  const c = data.customer;
  const t = data.totals;

  // ── Summary cards ──
  const debtBalance = round2(toDec(t.debtCharged).minus(t.debtPaid));
  const utilization = c.debtLimit > 0 ? Math.min(100, Math.round((debtBalance / c.debtLimit) * 100)) : 0;
  const summaryCards: { label: string; value: string; cls: string }[] = [
    { label: 'Purchases to date', value: formatKES(t.purchases), cls: '' },
    { label: 'Store-credit balance', value: formatKES(debtBalance), cls: debtBalance > 0 ? 'neg' : 'pos' },
    { label: 'Debt limit utilised', value: `${utilization}%`, cls: utilization > 80 ? 'neg' : '' },
    { label: 'Rental charges', value: formatKES(t.rentalCharges), cls: '' },
    { label: 'Deposits held now', value: formatKES(t.depositsHeld), cls: '' },
    { label: 'Deposits released', value: formatKES(t.depositsReleased), cls: '' },
    { label: 'Loyalty points', value: `${c.loyaltyPoints} (${c.loyaltyTier})`, cls: '' },
    { label: 'Member since', value: formatDate(c.joinedAt), cls: '' },
  ];

  // ── Statement table (chronological, running credit-account balance) ──
  let running = 0;
  const statementRows = data.entries.map((e) => {
    if (!e.memo) {
      running = round2(toDec(running).plus(e.debit).minus(e.credit));
    }
    const amountCell =
      e.debit > 0 ? `<span class="neg">+${escapeHtml(formatKES(e.debit))}</span>`
      : e.credit > 0 ? `<span class="pos">−${escapeHtml(formatKES(e.credit))}</span>`
      : '<span class="muted">—</span>';
    return `
      <tr class="${e.memo ? 'memo' : ''}">
        <td class="nowrap">${escapeHtml(formatDateTimeEAT(e.at))}</td>
        <td>${e.icon} ${escapeHtml(e.activity)}</td>
        <td class="mono">${escapeHtml(e.reference)}</td>
        <td class="details">${escapeHtml(e.details)}${e.memo ? ' <span class="chip">memo</span>' : ''}</td>
        <td class="right">${amountCell}</td>
        ${e.memo ? '<td class="right muted">—</td>' : `<td class="right bold">${escapeHtml(formatKES(running))}</td>`}
      </tr>`;
  }).join('');

  // ── Timeline (most recent first) ──
  const timeline = [...data.entries].reverse().map((e) => `
    <div class="tl-row">
      <div class="tl-dot tl-${e.tone}">${e.icon}</div>
      <div class="tl-body">
        <div class="tl-head">
          <span class="tl-activity">${escapeHtml(e.activity)}</span>
          <span class="tl-date">${escapeHtml(formatDateTimeEAT(e.at))}</span>
        </div>
        <div class="tl-details">${escapeHtml(e.details)} · ref ${escapeHtml(e.reference)}</div>
      </div>
    </div>`).join('');

  // ── Graphs ──
  const barChart = buildCategoryBarChart([
    { label: 'Purchases', value: t.purchases, color: '#0ea5a0' },
    { label: 'Store credit charged', value: t.debtCharged, color: '#f59e0b' },
    { label: 'Debt payments', value: t.debtPaid, color: '#10b981' },
    { label: 'Rental charges', value: t.rentalCharges, color: '#6366f1' },
    { label: 'Deposits held now', value: t.depositsHeld, color: '#0f766e' },
    { label: 'Deposits released', value: t.depositsReleased, color: '#94a3b8' },
  ]);
  const balanceChart = buildBalanceChart(data.entries);

  // ── Rentals table ──
  const rentalsTable = data.rentals.length > 0 ? `
    <table>
      <thead><tr><th>Item</th><th>SKU</th><th>Start</th><th>Due</th><th>Returned</th><th class="right">Deposit</th><th class="right">Charge</th><th>Status</th></tr></thead>
      <tbody>
        ${data.rentals.map((r) => `
          <tr>
            <td>${escapeHtml(r.productName)}</td>
            <td class="mono">${escapeHtml(r.sku)}</td>
            <td class="nowrap">${escapeHtml(formatDate(r.start))}</td>
            <td class="nowrap">${escapeHtml(formatDate(r.expected))}</td>
            <td class="nowrap">${r.end ? escapeHtml(formatDate(r.end)) : '—'}</td>
            <td class="right">${escapeHtml(formatKES(r.deposit))}</td>
            <td class="right">${escapeHtml(formatKES(round2(toDec(r.charge).plus(r.lateFee).plus(r.damage))))}</td>
            <td>${escapeHtml(r.status)}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : '<p class="no-data">No equipment rentals on this account.</p>';

  const highlightsHtml = highlights.map((h) => `<li>${escapeHtml(h)}</li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(report.title)} — MBUMAH HARDWARE</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; background: #fff; padding: 32px; font-size: 12px; }
    .header { display: flex; align-items: center; gap: 20px; border-bottom: 3px solid #0f766e; padding-bottom: 16px; margin-bottom: 20px; }
    .logo { max-width: 90px; max-height: 90px; }
    .company-info { flex: 1; }
    .company-name { font-size: 22px; font-weight: 800; color: #0f766e; letter-spacing: 0.5px; }
    .company-branch { font-size: 14px; font-weight: 600; margin-top: 2px; }
    .company-meta { font-size: 11px; color: #555; margin-top: 4px; line-height: 1.5; }
    .report-title { font-size: 18px; font-weight: 700; }
    .report-subtitle { font-size: 12px; color: #666; margin-top: 2px; }
    .customer-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin: 14px 0; display: flex; gap: 32px; flex-wrap: wrap; }
    .customer-box div { line-height: 1.7; }
    .cb-label { font-size: 10px; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; display: block; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.6px; color: #0f766e; margin: 26px 0 8px; border-bottom: 1px solid #ccfbf1; padding-bottom: 4px; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 12px 0; }
    .scard { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
    .scard .sc-label { font-size: 9.5px; text-transform: uppercase; color: #64748b; letter-spacing: 0.4px; }
    .scard .sc-value { font-size: 15px; font-weight: 700; margin-top: 3px; color: #0f172a; }
    .scard .neg { color: #b91c1c; } .scard .pos { color: #047857; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 10.5px; }
    thead th { background: #0f766e; color: #fff; text-align: left; padding: 7px 9px; font-weight: 600; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.3px; }
    tbody td { padding: 6px 9px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    tbody tr.memo { background: #fffbeb; color: #92400e; }
    tr { page-break-inside: avoid; }
    .right { text-align: right; } .bold { font-weight: 700; }
    .mono { font-family: 'Courier New', monospace; font-size: 10px; }
    .nowrap { white-space: nowrap; }
    .muted { color: #94a3b8; } .neg { color: #b91c1c; font-weight: 600; } .pos { color: #047857; font-weight: 600; }
    .details { color: #475569; }
    .chip { background: #fef3c7; border: 1px solid #fde68a; color: #92400e; font-size: 8.5px; padding: 1px 6px; border-radius: 999px; text-transform: uppercase; }
    .no-data { text-align: center; padding: 26px; color: #94a3b8; font-style: italic; }
    .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 10px; }
    @media (max-width: 900px) { .charts { grid-template-columns: 1fr; } }
    .chart-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
    .bar-row { display: grid; grid-template-columns: 128px 1fr 92px; align-items: center; gap: 8px; margin: 7px 0; }
    .bar-label { font-size: 10px; color: #475569; }
    .bar-track { background: #f1f5f9; border-radius: 999px; height: 12px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 999px; }
    .bar-value { font-size: 10.5px; font-weight: 700; text-align: right; }
    .balance-svg { width: 100%; height: auto; border: 1px solid #e2e8f0; border-radius: 8px; }
    .svg-label { font-size: 9px; fill: #64748b; }
    .timeline { border-left: 2px solid #ccfbf1; margin: 10px 0 0 8px; padding-left: 18px; }
    .tl-row { display: flex; gap: 10px; margin: 0 0 12px; position: relative; }
    .tl-dot { width: 26px; height: 26px; border-radius: 999px; display: flex; align-items: center; justify-content: center; font-size: 13px; background: #f0fdfa; border: 1px solid #99f6e4; flex-shrink: 0; margin-left: -32px; }
    .tl-in { background: #ecfdf5; border-color: #a7f3d0; }
    .tl-out { background: #fff7ed; border-color: #fed7aa; }
    .tl-warn { background: #fffbeb; border-color: #fde68a; }
    .tl-info { background: #eff6ff; border-color: #bfdbfe; }
    .tl-head { display: flex; justify-content: space-between; gap: 10px; }
    .tl-activity { font-weight: 600; font-size: 11.5px; }
    .tl-date { font-size: 10px; color: #64748b; white-space: nowrap; }
    .tl-details { font-size: 10px; color: #64748b; margin-top: 1px; }
    .highlights { background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 12px 18px 12px 30px; margin-top: 10px; }
    .highlights li { margin: 5px 0; line-height: 1.5; }
    .print-hint { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; border-radius: 8px; padding: 10px 14px; margin: 14px 0; font-size: 11px; }
    @media print { body { padding: 0; } .print-hint { display: none; } .header { page-break-after: avoid; } thead { display: table-header-group; } }
  </style>
</head>
<body>
  <div class="print-hint">🖨️ To save as PDF: press <b>Ctrl/Cmd + P</b> → choose <b>Save as PDF</b>. This statement reflects the account as shown on screen at generation time.</div>
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

  <div class="report-title">Customer Account Statement</div>
  <div class="report-subtitle">Full account history · statement &amp; activity timeline</div>

  <div class="customer-box">
    <div><span class="cb-label">Customer</span><b>${escapeHtml(c.name)}</b></div>
    <div><span class="cb-label">Phone</span>${escapeHtml(c.phone)}</div>
    ${c.email ? `<div><span class="cb-label">Email</span>${escapeHtml(c.email)}</div>` : ''}
    ${c.idNumber ? `<div><span class="cb-label">ID No.</span>${escapeHtml(c.idNumber)}</div>` : ''}
    <div><span class="cb-label">Loyalty</span>${c.loyaltyPoints} pts · ${escapeHtml(c.loyaltyTier)}</div>
    <div><span class="cb-label">Member since</span>${escapeHtml(formatDate(c.joinedAt))}</div>
  </div>

  <h2>Summary — Key Figures</h2>
  <div class="summary-grid">
    ${summaryCards.map((s) => `<div class="scard"><span class="sc-label">${escapeHtml(s.label)}</span><span class="sc-value ${s.cls}">${escapeHtml(s.value)}</span></div>`).join('')}
  </div>

  <h2>Key Highlights</h2>
  <ul class="highlights">${highlightsHtml}</ul>

  <h2>Graphs</h2>
  <div class="charts">
    <div>
      <div class="cb-label" style="margin-bottom:6px">Money flow by category</div>
      ${barChart}
    </div>
    <div>
      <div class="cb-label" style="margin-bottom:6px">Credit-account balance over time</div>
      ${balanceChart}
    </div>
  </div>

  <h2>Statement of Account</h2>
  <table>
    <thead><tr><th>Date &amp; Time</th><th>Activity</th><th>Reference</th><th>Details</th><th class="right">Amount</th><th class="right">Balance</th></tr></thead>
    <tbody>${statementRows || '<tr><td colspan="6" class="no-data">No account activity.</td></tr>'}</tbody>
  </table>
  <p class="muted" style="margin-top:6px">Balance = running store-credit owed (memo rows — deposits held/released — do not change the credit balance).</p>

  <h2>Equipment Rental History</h2>
  ${rentalsTable}

  <h2>Activity Timeline (latest first)</h2>
  <div class="timeline">${timeline || '<p class="no-data">No activity yet.</p>'}</div>

  <div class="footer" style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;display:flex;justify-content:space-between">
    <span>Generated: ${escapeHtml(generatedAt)} (EAT)</span>
    <span class="brand" style="color:#0f766e;font-weight:600">MBUMAH HARDWARE POS &amp; ERP © 2026</span>
  </div>
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 600); });</script>
</body>
</html>`;
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
  const customerId = searchParams.get('customerId') || '';

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

  // R14 (v2.5.1): per-customer ACCOUNT STATEMENT — full history, timeline,
  // graphs and highlights. Must be handled before the generic table reports
  // because it renders a dedicated HTML template.
  if (type === 'customer-statement') {
    if (!customerId) {
      return Response.json(
        { success: false, error: 'customerId is required for a customer statement.' },
        { status: 400 }
      );
    }
    const statement = await buildCustomerStatement(storeId, customerId);
    if (!statement) {
      return Response.json(
        { success: false, error: 'Customer not found in this store.' },
        { status: 404 }
      );
    }
    await systemLog({
      action: 'PDF_REPORT_GENERATED',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.INFO,
      message: `Customer account statement generated: ${statement.data.customer.name} (${statement.data.entries.length} entries)`,
      storeId,
      metadata: {
        type,
        customerId,
        entries: statement.data.entries.length,
        creditBalance: round2(toDec(statement.data.totals.debtCharged).minus(statement.data.totals.debtPaid)),
      },
    });
    const html = buildHtmlStatement(statement, storeName, storeLocation, storePhone, storeTaxPin);
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="statement_${customerId}.html"`,
      },
    });
  }

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

// AUDIT FIX (Task 3-d): printable report export (sales/inventory/debt/rentals,
// cost & margin columns) = manager-or-above — exports leak margin data.
export const GET = withErrorBoundary(
  withSessionAuth(getExportPdfHandler, { roles: MANAGER_PLUS_ROLES }),
  'REPORTS_EXPORT_PDF',
);
