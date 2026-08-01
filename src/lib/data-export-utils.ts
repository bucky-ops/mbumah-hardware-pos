// ════════════════════════════════════════════════════════════════════════════
// src/lib/data-export-utils.ts
// ════════════════════════════════════════════════════════════════════════════
//
// Server-side data export utilities for the Data Export Dashboard.
//
// Each generator queries the Prisma DB for a specific data type and returns a
// `{ csv: string; recordCount: number }` object. The caller (the API route)
// then writes the CSV string to disk under `/home/z/my-project/download/exports/`.
//
// All Decimal fields are coerced to plain numbers via `toNumber()` and formatted
// with `toFixed(2)` for currency columns. Dates are ISO-formatted for easy
// parsing in spreadsheets.
//
// The CSV escaping logic mirrors `src/lib/export-utils.ts` (RFC 4180), but is
// duplicated here because the helpers in `export-utils.ts` are not exported and
// that module also pulls in browser-only APIs (Blob, document). This module
// must remain Node/server-only.

import { db } from '@/lib/db';
import { calculateAgingBucket } from '@/lib/debt-helpers';

// ── Types ────────────────────────────────────────────────────────────────────

export type ExportType =
  | 'PRODUCTS'
  | 'CUSTOMERS'
  | 'TRANSACTIONS'
  | 'DEBT'
  | 'INVENTORY'
  | 'EMPLOYEES'
  | 'SUPPLIERS'
  | 'LOYALTY'
  | 'TAX'
  | 'SALES_SUMMARY';

export type ExportFormat = 'CSV' | 'JSON';

export interface ExportFilters {
  categoryId?: string;
  status?: string;
  activeOnly?: boolean;
  lowStockOnly?: boolean;
  customerId?: string;
}

export interface GenerateResult {
  csv: string;
  recordCount: number;
}

// ── Internal CSV helpers ─────────────────────────────────────────────────────

/**
 * Escape a CSV field per RFC 4180. Wraps the value in double quotes if it
 * contains a comma, double quote, newline, or carriage return; doubles any
 * embedded double quotes.
 */
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Build a CSV string from an array of row objects and an ordered list of
 * columns. The first line is the header row (using `headerLabels` if provided).
 */
function buildCsv(
  rows: Array<Record<string, unknown>>,
  columns: Array<{ key: string; label?: string }>,
): string {
  const headerLine = columns
    .map((c) => escapeCsvField(c.label ?? c.key))
    .join(',');
  const dataLines = rows.map((row) =>
    columns.map((c) => escapeCsvField(row[c.key])).join(','),
  );
  // Prepend UTF-8 BOM so Excel detects encoding correctly.
  return '\uFEFF' + [headerLine, ...dataLines].join('\n');
}

/** Decimal-safe numeric coercion. Returns 0 for null/undefined/invalid. */
function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  // Prisma Decimal — call .toNumber() if available.
  const maybeDecimal = value as { toNumber?: () => number };
  if (typeof maybeDecimal.toNumber === 'function') {
    const n = maybeDecimal.toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Format a number as a fixed 2-decimal string (suitable for CSV currency). */
function fmtMoney(value: unknown): string {
  return toNumber(value).toFixed(2);
}

/** Format a Date / ISO string as ISO 8601 for CSV. Empty string if null. */
function fmtDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  try {
    return new Date(value).toISOString();
  } catch {
    return String(value);
  }
}

// ── Filter parser ────────────────────────────────────────────────────────────

/**
 * Parse the JSON-encoded `filters` string from a DataExport row into a typed
 * object. Returns an empty object if the input is missing or invalid.
 */
export function parseExportFilters(raw: string | null | undefined): ExportFilters {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as ExportFilters;
    }
  } catch {
    /* ignore malformed JSON */
  }
  return {};
}

// ── Generators ───────────────────────────────────────────────────────────────

/**
 * PRODUCTS — every product in the store with category, pricing, stock, flags.
 */
export async function generateProductsCsv(
  storeId: string,
  filters: ExportFilters,
): Promise<GenerateResult> {
  const where: Record<string, unknown> = { storeId };
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.activeOnly) where.isActive = true;

  const products = await db.product.findMany({
    where,
    include: {
      category: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  });

  const rows = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    barcode: p.barcode ?? '',
    name: p.name,
    description: p.description ?? '',
    category: p.category?.name ?? '',
    unitType: p.unitType,
    quantityInStock: toNumber(p.quantityInStock).toFixed(2),
    reorderLevel: toNumber(p.reorderLevel).toFixed(2),
    minimumStockLevel: p.minimumStockLevel,
    maximumStockLevel: p.maximumStockLevel ?? '',
    pricePerUnit: fmtMoney(p.pricePerUnit),
    costPrice: fmtMoney(p.costPrice),
    taxRate: toNumber(p.taxRate).toFixed(2),
    isRental: p.isRental ? 'Yes' : 'No',
    isBundle: p.isBundle ? 'Yes' : 'No',
    isActive: p.isActive ? 'Yes' : 'No',
    etimsItemCode: p.etimsItemCode ?? '',
    etimsTaxType: p.etimsTaxType ?? '',
    createdAt: fmtDate(p.createdAt),
    updatedAt: fmtDate(p.updatedAt),
  }));

  const csv = buildCsv(rows, [
    { key: 'id', label: 'ID' },
    { key: 'sku', label: 'SKU' },
    { key: 'barcode', label: 'Barcode' },
    { key: 'name', label: 'Name' },
    { key: 'description', label: 'Description' },
    { key: 'category', label: 'Category' },
    { key: 'unitType', label: 'Unit Type' },
    { key: 'quantityInStock', label: 'Qty in Stock' },
    { key: 'reorderLevel', label: 'Reorder Level' },
    { key: 'minimumStockLevel', label: 'Min Stock Level' },
    { key: 'maximumStockLevel', label: 'Max Stock Level' },
    { key: 'pricePerUnit', label: 'Selling Price (KES)' },
    { key: 'costPrice', label: 'Cost Price (KES)' },
    { key: 'taxRate', label: 'Tax Rate (%)' },
    { key: 'isRental', label: 'Rental' },
    { key: 'isBundle', label: 'Bundle' },
    { key: 'isActive', label: 'Active' },
    { key: 'etimsItemCode', label: 'eTIMS Item Code' },
    { key: 'etimsTaxType', label: 'eTIMS Tax Type' },
    { key: 'createdAt', label: 'Created At' },
    { key: 'updatedAt', label: 'Updated At' },
  ]);

  return { csv, recordCount: rows.length };
}

/**
 * CUSTOMERS — every customer with contact info, debt balance, loyalty tier.
 */
export async function generateCustomersCsv(
  storeId: string,
  filters: ExportFilters,
): Promise<GenerateResult> {
  const where: Record<string, unknown> = { storeId };
  if (filters.activeOnly) where.isActive = true;

  const customers = await db.customer.findMany({
    where,
    orderBy: { name: 'asc' },
  });

  const rows = customers.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone ?? '',
    email: c.email ?? '',
    address: c.address ?? '',
    idNumber: c.idNumber ?? '',
    currentDebtBalance: fmtMoney(c.currentDebtBalance),
    debtLimit: fmtMoney(c.debtLimit),
    loyaltyPoints: c.loyaltyPoints,
    loyaltyTier: c.loyaltyTier,
    totalLoyaltyEarned: c.totalLoyaltyEarned,
    totalLoyaltyRedeemed: c.totalLoyaltyRedeemed,
    preferredChannel: c.preferredChannel,
    joinedAt: fmtDate(c.joinedAt),
    isActive: c.isActive ? 'Yes' : 'No',
    createdAt: fmtDate(c.createdAt),
  }));

  const csv = buildCsv(rows, [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'address', label: 'Address' },
    { key: 'idNumber', label: 'ID Number' },
    { key: 'currentDebtBalance', label: 'Debt Balance (KES)' },
    { key: 'debtLimit', label: 'Debt Limit (KES)' },
    { key: 'loyaltyPoints', label: 'Loyalty Points' },
    { key: 'loyaltyTier', label: 'Loyalty Tier' },
    { key: 'totalLoyaltyEarned', label: 'Total Loyalty Earned' },
    { key: 'totalLoyaltyRedeemed', label: 'Total Loyalty Redeemed' },
    { key: 'preferredChannel', label: 'Preferred Channel' },
    { key: 'joinedAt', label: 'Joined At' },
    { key: 'isActive', label: 'Active' },
    { key: 'createdAt', label: 'Created At' },
  ]);

  return { csv, recordCount: rows.length };
}

/**
 * TRANSACTIONS — sales transactions with totals, payment method, cashier,
 * customer, and item count. Scoped to a date range.
 */
export async function generateTransactionsCsv(
  storeId: string,
  dateFrom?: Date | null,
  dateTo?: Date | null,
): Promise<GenerateResult> {
  const where: Record<string, unknown> = { storeId };
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) (where.createdAt as Record<string, unknown>).gte = dateFrom;
    if (dateTo) (where.createdAt as Record<string, unknown>).lte = dateTo;
  }

  const transactions = await db.salesTransaction.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      cashier: { select: { id: true, name: true } },
      items: { select: { id: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const rows = transactions.map((t) => ({
    id: t.id,
    receiptNumber: t.receiptNumber,
    date: fmtDate(t.createdAt),
    customerId: t.customerId ?? '',
    customerName: t.customer?.name ?? 'Walk-in',
    customerPhone: t.customer?.phone ?? '',
    cashierId: t.cashierId,
    cashierName: t.cashier?.name ?? '',
    paymentMethod: t.paymentMethod,
    paymentStatus: t.paymentStatus,
    transactionType: t.transactionType,
    subtotal: fmtMoney(t.subtotal),
    taxAmount: fmtMoney(t.taxAmount),
    discountAmount: fmtMoney(t.discountAmount),
    totalAmount: fmtMoney(t.totalAmount),
    itemCount: t.items.length,
    isOffline: t.isOffline ? 'Yes' : 'No',
    etimsInvoiceNumber: t.etimsInvoiceNumber ?? '',
    etimsStatus: t.etimsStatus ?? '',
    notes: t.notes ?? '',
  }));

  const csv = buildCsv(rows, [
    { key: 'id', label: 'ID' },
    { key: 'receiptNumber', label: 'Receipt #' },
    { key: 'date', label: 'Date' },
    { key: 'customerId', label: 'Customer ID' },
    { key: 'customerName', label: 'Customer' },
    { key: 'customerPhone', label: 'Customer Phone' },
    { key: 'cashierId', label: 'Cashier ID' },
    { key: 'cashierName', label: 'Cashier' },
    { key: 'paymentMethod', label: 'Payment Method' },
    { key: 'paymentStatus', label: 'Payment Status' },
    { key: 'transactionType', label: 'Type' },
    { key: 'subtotal', label: 'Subtotal (KES)' },
    { key: 'taxAmount', label: 'VAT (KES)' },
    { key: 'discountAmount', label: 'Discount (KES)' },
    { key: 'totalAmount', label: 'Total (KES)' },
    { key: 'itemCount', label: 'Items' },
    { key: 'isOffline', label: 'Offline' },
    { key: 'etimsInvoiceNumber', label: 'eTIMS Invoice #' },
    { key: 'etimsStatus', label: 'eTIMS Status' },
    { key: 'notes', label: 'Notes' },
  ]);

  return { csv, recordCount: rows.length };
}

/**
 * DEBT — outstanding debt ledger entries with customer info, balances, and
 * aging buckets. Filters by status if provided.
 */
export async function generateDebtCsv(
  storeId: string,
  filters: ExportFilters,
): Promise<GenerateResult> {
  const where: Record<string, unknown> = { storeId };
  if (filters.status) where.status = filters.status;
  if (filters.customerId) where.customerId = filters.customerId;

  const debts = await db.debtLedger.findMany({
    where,
    include: {
      customer: {
        select: { id: true, name: true, phone: true, email: true },
      },
      transaction: {
        select: { id: true, receiptNumber: true, totalAmount: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const now = new Date();
  const rows = debts.map((d) => ({
    id: d.id,
    customerId: d.customerId,
    customerName: d.customer.name,
    customerPhone: d.customer.phone ?? '',
    customerEmail: d.customer.email ?? '',
    transactionId: d.transactionId ?? '',
    receiptNumber: d.transaction?.receiptNumber ?? '',
    transactionTotal: d.transaction ? fmtMoney(d.transaction.totalAmount) : '',
    amountOwed: fmtMoney(d.amountOwed),
    amountPaid: fmtMoney(d.amountPaid),
    balance: fmtMoney(d.balance),
    dueDate: fmtDate(d.dueDate),
    status: d.status,
    agingBucket: calculateAgingBucket(d.dueDate, now),
    lastReminderAt: fmtDate(d.lastReminderAt),
    notes: d.notes ?? '',
    createdAt: fmtDate(d.createdAt),
    updatedAt: fmtDate(d.updatedAt),
  }));

  const csv = buildCsv(rows, [
    { key: 'id', label: 'Debt ID' },
    { key: 'customerId', label: 'Customer ID' },
    { key: 'customerName', label: 'Customer' },
    { key: 'customerPhone', label: 'Phone' },
    { key: 'customerEmail', label: 'Email' },
    { key: 'transactionId', label: 'Transaction ID' },
    { key: 'receiptNumber', label: 'Receipt #' },
    { key: 'transactionTotal', label: 'Transaction Total (KES)' },
    { key: 'amountOwed', label: 'Amount Owed (KES)' },
    { key: 'amountPaid', label: 'Amount Paid (KES)' },
    { key: 'balance', label: 'Balance (KES)' },
    { key: 'dueDate', label: 'Due Date' },
    { key: 'status', label: 'Status' },
    { key: 'agingBucket', label: 'Aging Bucket' },
    { key: 'lastReminderAt', label: 'Last Reminder At' },
    { key: 'notes', label: 'Notes' },
    { key: 'createdAt', label: 'Created At' },
    { key: 'updatedAt', label: 'Updated At' },
  ]);

  return { csv, recordCount: rows.length };
}

/**
 * INVENTORY — products with stock levels, reorder points, and bin locations.
 * Includes stock status (LOW STOCK / OK / OUT OF STOCK).
 */
export async function generateInventoryCsv(
  storeId: string,
  filters: ExportFilters,
): Promise<GenerateResult> {
  const where: Record<string, unknown> = { storeId };
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.activeOnly) where.isActive = true;

  const products = await db.product.findMany({
    where,
    include: {
      category: { select: { id: true, name: true } },
      binLocations: { select: { id: true, locationCode: true, aisle: true, shelf: true, bin: true } },
    },
    orderBy: { name: 'asc' },
  });

  const rows = products.map((p) => {
    const qty = toNumber(p.quantityInStock);
    const reorder = toNumber(p.reorderLevel);
    const stockStatus = qty <= 0 ? 'OUT OF STOCK' : qty <= reorder ? 'LOW STOCK' : 'OK';
    const binLocations = p.binLocations
      .map((b) => {
        const parts = [b.locationCode];
        if (b.aisle) parts.push(`aisle=${b.aisle}`);
        if (b.shelf) parts.push(`shelf=${b.shelf}`);
        if (b.bin) parts.push(`bin=${b.bin}`);
        return parts.join(' ');
      })
      .join('; ');
    return {
      id: p.id,
      sku: p.sku,
      barcode: p.barcode ?? '',
      name: p.name,
      category: p.category?.name ?? '',
      unitType: p.unitType,
      quantityInStock: qty.toFixed(2),
      reorderLevel: reorder.toFixed(2),
      minimumStockLevel: p.minimumStockLevel,
      maximumStockLevel: p.maximumStockLevel ?? '',
      stockStatus,
      binLocations,
      costPrice: fmtMoney(p.costPrice),
      stockValue: (qty * toNumber(p.costPrice)).toFixed(2),
      lastUpdated: fmtDate(p.updatedAt),
    };
  });

  const csv = buildCsv(rows, [
    { key: 'id', label: 'ID' },
    { key: 'sku', label: 'SKU' },
    { key: 'barcode', label: 'Barcode' },
    { key: 'name', label: 'Product Name' },
    { key: 'category', label: 'Category' },
    { key: 'unitType', label: 'Unit' },
    { key: 'quantityInStock', label: 'Qty in Stock' },
    { key: 'reorderLevel', label: 'Reorder Level' },
    { key: 'minimumStockLevel', label: 'Min Level' },
    { key: 'maximumStockLevel', label: 'Max Level' },
    { key: 'stockStatus', label: 'Stock Status' },
    { key: 'binLocations', label: 'Bin Locations' },
    { key: 'costPrice', label: 'Cost Price (KES)' },
    { key: 'stockValue', label: 'Stock Value (KES)' },
    { key: 'lastUpdated', label: 'Last Updated' },
  ]);

  return { csv, recordCount: rows.length };
}

/**
 * EMPLOYEES — every employee with role, contact info, salary, and employment
 * status.
 */
export async function generateEmployeesCsv(storeId: string): Promise<GenerateResult> {
  const employees = await db.employee.findMany({
    where: { storeId },
    orderBy: { firstName: 'asc' },
  });

  const rows = employees.map((e) => ({
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email ?? '',
    phone: e.phone ?? '',
    nationalId: e.nationalId ?? '',
    kraPin: e.kraPin ?? '',
    nssfNumber: e.nssfNumber ?? '',
    nhifNumber: e.nhifNumber ?? '',
    jobTitle: e.jobTitle ?? '',
    role: e.role,
    employmentType: e.employmentType,
    status: e.status,
    hireDate: fmtDate(e.hireDate),
    terminationDate: fmtDate(e.terminationDate),
    basicSalary: fmtMoney(e.basicSalary),
    houseAllowance: fmtMoney(e.houseAllowance),
    transportAllowance: fmtMoney(e.transportAllowance),
    medicalAllowance: fmtMoney(e.medicalAllowance),
    otherAllowances: fmtMoney(e.otherAllowances),
    totalGross: fmtMoney(
      toNumber(e.basicSalary) +
        toNumber(e.houseAllowance) +
        toNumber(e.transportAllowance) +
        toNumber(e.medicalAllowance) +
        toNumber(e.otherAllowances),
    ),
    hourlyRate: e.hourlyRate ? fmtMoney(e.hourlyRate) : '',
    bankName: e.bankName ?? '',
    bankAccountName: e.bankAccountName ?? '',
  }));

  const csv = buildCsv(rows, [
    { key: 'id', label: 'ID' },
    { key: 'firstName', label: 'First Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'nationalId', label: 'National ID' },
    { key: 'kraPin', label: 'KRA PIN' },
    { key: 'nssfNumber', label: 'NSSF Number' },
    { key: 'nhifNumber', label: 'NHIF Number' },
    { key: 'jobTitle', label: 'Job Title' },
    { key: 'role', label: 'Role' },
    { key: 'employmentType', label: 'Employment Type' },
    { key: 'status', label: 'Status' },
    { key: 'hireDate', label: 'Hire Date' },
    { key: 'terminationDate', label: 'Termination Date' },
    { key: 'basicSalary', label: 'Basic Salary (KES)' },
    { key: 'houseAllowance', label: 'House Allowance (KES)' },
    { key: 'transportAllowance', label: 'Transport Allowance (KES)' },
    { key: 'medicalAllowance', label: 'Medical Allowance (KES)' },
    { key: 'otherAllowances', label: 'Other Allowances (KES)' },
    { key: 'totalGross', label: 'Total Gross (KES)' },
    { key: 'hourlyRate', label: 'Hourly Rate (KES)' },
    { key: 'bankName', label: 'Bank Name' },
    { key: 'bankAccountName', label: 'Bank Account Name' },
  ]);

  return { csv, recordCount: rows.length };
}

/**
 * SUPPLIERS — every supplier with contact info, payment terms, rating.
 */
export async function generateSuppliersCsv(storeId: string): Promise<GenerateResult> {
  const suppliers = await db.supplier.findMany({
    where: { storeId },
    orderBy: { name: 'asc' },
  });

  const rows = suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email ?? '',
    phone: s.phone ?? '',
    address: s.address ?? '',
    city: s.city ?? '',
    contactPerson: s.contactPerson ?? '',
    taxPin: s.taxPin ?? '',
    paymentTerms: s.paymentTerms,
    rating: s.rating,
    isActive: s.isActive ? 'Yes' : 'No',
    notes: s.notes ?? '',
    createdAt: fmtDate(s.createdAt),
  }));

  const csv = buildCsv(rows, [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Supplier Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'address', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'contactPerson', label: 'Contact Person' },
    { key: 'taxPin', label: 'Tax PIN' },
    { key: 'paymentTerms', label: 'Payment Terms' },
    { key: 'rating', label: 'Rating (1-5)' },
    { key: 'isActive', label: 'Active' },
    { key: 'notes', label: 'Notes' },
    { key: 'createdAt', label: 'Created At' },
  ]);

  return { csv, recordCount: rows.length };
}

/**
 * LOYALTY — customers with loyalty points, tier, total earned/redeemed, and
 * transaction counts.
 */
export async function generateLoyaltyCsv(storeId: string): Promise<GenerateResult> {
  const customers = await db.customer.findMany({
    where: { storeId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      loyaltyPoints: true,
      loyaltyTier: true,
      totalLoyaltyEarned: true,
      totalLoyaltyRedeemed: true,
      joinedAt: true,
      isActive: true,
      _count: { select: { loyaltyTransactions: true } },
    },
    orderBy: { loyaltyPoints: 'desc' },
  });

  const rows = customers.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone ?? '',
    email: c.email ?? '',
    loyaltyPoints: c.loyaltyPoints,
    loyaltyTier: c.loyaltyTier,
    totalLoyaltyEarned: c.totalLoyaltyEarned,
    totalLoyaltyRedeemed: c.totalLoyaltyRedeemed,
    loyaltyTransactions: c._count.loyaltyTransactions,
    joinedAt: fmtDate(c.joinedAt),
    isActive: c.isActive ? 'Yes' : 'No',
  }));

  const csv = buildCsv(rows, [
    { key: 'id', label: 'Customer ID' },
    { key: 'name', label: 'Customer Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'loyaltyPoints', label: 'Points Balance' },
    { key: 'loyaltyTier', label: 'Tier' },
    { key: 'totalLoyaltyEarned', label: 'Total Earned' },
    { key: 'totalLoyaltyRedeemed', label: 'Total Redeemed' },
    { key: 'loyaltyTransactions', label: 'Transactions' },
    { key: 'joinedAt', label: 'Joined At' },
    { key: 'isActive', label: 'Active' },
  ]);

  return { csv, recordCount: rows.length };
}

/**
 * TAX — transactions in a date range with VAT breakdown (subtotal, tax,
 * total). Useful for KRA VAT returns.
 */
export async function generateTaxCsv(
  storeId: string,
  dateFrom?: Date | null,
  dateTo?: Date | null,
): Promise<GenerateResult> {
  const where: Record<string, unknown> = { storeId };
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) (where.createdAt as Record<string, unknown>).gte = dateFrom;
    if (dateTo) (where.createdAt as Record<string, unknown>).lte = dateTo;
  }

  const transactions = await db.salesTransaction.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const rows = transactions.map((t) => {
    const subtotal = toNumber(t.subtotal);
    const tax = toNumber(t.taxAmount);
    const total = toNumber(t.totalAmount);
    // Reverse-compute the effective VAT rate from total & subtotal.
    const effectiveRate = subtotal > 0 ? (tax / subtotal) * 100 : 0;
    return {
      id: t.id,
      receiptNumber: t.receiptNumber,
      date: fmtDate(t.createdAt),
      customer: t.customer?.name ?? 'Walk-in',
      paymentMethod: t.paymentMethod,
      paymentStatus: t.paymentStatus,
      transactionType: t.transactionType,
      subtotal: subtotal.toFixed(2),
      taxAmount: tax.toFixed(2),
      discountAmount: toNumber(t.discountAmount).toFixed(2),
      totalAmount: total.toFixed(2),
      effectiveVatRate: effectiveRate.toFixed(2),
      etimsInvoiceNumber: t.etimsInvoiceNumber ?? '',
      etimsStatus: t.etimsStatus ?? '',
    };
  });

  const csv = buildCsv(rows, [
    { key: 'id', label: 'Transaction ID' },
    { key: 'receiptNumber', label: 'Receipt #' },
    { key: 'date', label: 'Date' },
    { key: 'customer', label: 'Customer' },
    { key: 'paymentMethod', label: 'Payment Method' },
    { key: 'paymentStatus', label: 'Payment Status' },
    { key: 'transactionType', label: 'Type' },
    { key: 'subtotal', label: 'Subtotal (KES)' },
    { key: 'taxAmount', label: 'VAT Amount (KES)' },
    { key: 'discountAmount', label: 'Discount (KES)' },
    { key: 'totalAmount', label: 'Total (KES)' },
    { key: 'effectiveVatRate', label: 'Effective VAT Rate (%)' },
    { key: 'etimsInvoiceNumber', label: 'eTIMS Invoice #' },
    { key: 'etimsStatus', label: 'eTIMS Status' },
  ]);

  return { csv, recordCount: rows.length };
}

/**
 * SALES_SUMMARY — daily aggregated sales for a date range. One row per day
 * with revenue, transaction count, average transaction value, total tax, and
 * (optionally) per-payment-method breakdown.
 */
export async function generateSalesSummaryCsv(
  storeId: string,
  dateFrom?: Date | null,
  dateTo?: Date | null,
): Promise<GenerateResult> {
  const where: Record<string, unknown> = {
    storeId,
    transactionType: 'SALE',
    paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
  };
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) (where.createdAt as Record<string, unknown>).gte = dateFrom;
    if (dateTo) (where.createdAt as Record<string, unknown>).lte = dateTo;
  }

  const transactions = await db.salesTransaction.findMany({
    where,
    select: {
      createdAt: true,
      subtotal: true,
      taxAmount: true,
      discountAmount: true,
      totalAmount: true,
      paymentMethod: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Group by calendar day (UTC).
  const byDay = new Map<
    string,
    {
      date: string;
      revenue: number;
      tax: number;
      discount: number;
      subtotal: number;
      count: number;
      byMethod: Record<string, { count: number; revenue: number }>;
    }
  >();

  for (const t of transactions) {
    const dayKey = new Date(t.createdAt).toISOString().slice(0, 10);
    let entry = byDay.get(dayKey);
    if (!entry) {
      entry = {
        date: dayKey,
        revenue: 0,
        tax: 0,
        discount: 0,
        subtotal: 0,
        count: 0,
        byMethod: {},
      };
      byDay.set(dayKey, entry);
    }
    const total = toNumber(t.totalAmount);
    entry.revenue += total;
    entry.tax += toNumber(t.taxAmount);
    entry.discount += toNumber(t.discountAmount);
    entry.subtotal += toNumber(t.subtotal);
    entry.count += 1;
    const method = t.paymentMethod || 'UNKNOWN';
    if (!entry.byMethod[method]) entry.byMethod[method] = { count: 0, revenue: 0 };
    entry.byMethod[method].count += 1;
    entry.byMethod[method].revenue += total;
  }

  const rows = Array.from(byDay.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => {
      const avg = d.count > 0 ? d.revenue / d.count : 0;
      const cashRevenue = d.byMethod.CASH?.revenue ?? 0;
      const mpesaRevenue = d.byMethod.MPESA?.revenue ?? 0;
      const debtRevenue = d.byMethod.DEBT?.revenue ?? 0;
      const splitRevenue = d.byMethod.SPLIT?.revenue ?? 0;
      return {
        date: d.date,
        transactions: d.count,
        subtotal: d.subtotal.toFixed(2),
        taxAmount: d.tax.toFixed(2),
        discountAmount: d.discount.toFixed(2),
        totalRevenue: d.revenue.toFixed(2),
        avgTransactionValue: avg.toFixed(2),
        cashSales: cashRevenue.toFixed(2),
        mpesaSales: mpesaRevenue.toFixed(2),
        debtSales: debtRevenue.toFixed(2),
        splitSales: splitRevenue.toFixed(2),
      };
    });

  const csv = buildCsv(rows, [
    { key: 'date', label: 'Date' },
    { key: 'transactions', label: 'Transactions' },
    { key: 'subtotal', label: 'Subtotal (KES)' },
    { key: 'taxAmount', label: 'VAT (KES)' },
    { key: 'discountAmount', label: 'Discount (KES)' },
    { key: 'totalRevenue', label: 'Total Revenue (KES)' },
    { key: 'avgTransactionValue', label: 'Avg Transaction (KES)' },
    { key: 'cashSales', label: 'Cash Sales (KES)' },
    { key: 'mpesaSales', label: 'M-Pesa Sales (KES)' },
    { key: 'debtSales', label: 'Debt Sales (KES)' },
    { key: 'splitSales', label: 'Split Sales (KES)' },
  ]);

  return { csv, recordCount: rows.length };
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Run the appropriate generator for the given export type. Returns the CSV
 * string and the number of records exported. Throws an Error with a helpful
 * message if the export type is unsupported.
 */
export async function runExportGenerator(
  storeId: string,
  exportType: string,
  filters: ExportFilters,
  dateFrom?: Date | null,
  dateTo?: Date | null,
): Promise<GenerateResult> {
  switch (exportType) {
    case 'PRODUCTS':
      return generateProductsCsv(storeId, filters);
    case 'CUSTOMERS':
      return generateCustomersCsv(storeId, filters);
    case 'TRANSACTIONS':
      return generateTransactionsCsv(storeId, dateFrom, dateTo);
    case 'DEBT':
      return generateDebtCsv(storeId, filters);
    case 'INVENTORY':
      return generateInventoryCsv(storeId, filters);
    case 'EMPLOYEES':
      return generateEmployeesCsv(storeId);
    case 'SUPPLIERS':
      return generateSuppliersCsv(storeId);
    case 'LOYALTY':
      return generateLoyaltyCsv(storeId);
    case 'TAX':
      return generateTaxCsv(storeId, dateFrom, dateTo);
    case 'SALES_SUMMARY':
      return generateSalesSummaryCsv(storeId, dateFrom, dateTo);
    default:
      throw new Error(`Unsupported export type: ${exportType}`);
  }
}

/**
 * Wrap a CSV string as a JSON document. The JSON is an array of row objects
 * keyed by the column labels. This is a simple convenience wrapper — for
 * structured JSON exports of complex types, callers should write dedicated
 * generators.
 */
export function csvToJson(csv: string): string {
  // Strip UTF-8 BOM if present.
  const cleaned = csv.startsWith('\uFEFF') ? csv.slice(1) : csv;
  const lines = cleaned.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return '[]';

  // Parse the header row into column labels.
  const headers = parseCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }
  return JSON.stringify(rows, null, 2);
}

/**
 * Parse a single CSV line into an array of field values. Handles quoted fields
 * with embedded commas, double-quotes (escaped as ""), and newlines. Assumes
 * well-formed RFC 4180 input.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}
