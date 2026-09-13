// POST /api/admin/bulk-seed
//
// DEMO DATA LOADER (v2.5.7): SUPER_ADMIN-only bulk loader used to populate a
// (demo) database with realistic hardware-store data — the owner asked for a
// "fully populated" database (>1000 rows per core table: catalog, customers,
// suppliers, HR, sales history) plus simulated staff chat conversations.
//
// Design contracts (READ BEFORE USE):
//   • IDEMPOTENT — every row carries a deterministic primary key with the
//     prefix `seed` (e.g. `seedp_000123`). Flat inserts pre-filter rows whose
//     id already exists; nested inserts (transactions/chats) tolerate P2002.
//     Re-running the same chunk is a safe no-op.
//   • PURGEABLE — every seeded row is identifiable by its id prefix
//     `seedp_/seedc_/seeds_/seede_/seedt_/seedm_/seedr_/seedv_/seedmsg_`,
//     so a future cleanup can delete in FK-safe order:
//       1. stock_movements (seedm_)  2. receipts (seedr_)
//       3. sales_transactions (seedt_) — cascades sale_items + payments
//       4. conversations (seedv_) — cascades conversation_messages
//       5. products (seedp_) / customers (seedc_) / suppliers (seeds_) /
//          employees (seede_)
//   • EXISTING DATA IS NEVER MODIFIED — seed products already carry their
//     post-sale quantityInStock; no UPDATEs are issued to non-seed rows.
//   • FK SAFETY — all referenced ids (stores, users, products, categories,
//     customers) are validated against the live DB before any insert.
//
// Chunk limits (Vercel serverless friendly):
//   products|customers|suppliers|employees|stock-movements  ≤ 400 rows/call
//   transactions (each nests ~3-6 items + 1-2 payments)     ≤ 40 rows/call
//   chats (conversation + nested messages)                  ≤ 8 rows/call
//
// Every call is audit-logged to system_logs (ADMIN_BULK_SEED).

import { type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireAuth } from '@/lib/auth';
import { isCSRFValid } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── chunk limits ─────────────────────────────────────────────────────────────
const MAX_FLAT_ROWS = 400;
const MAX_TRANSACTION_ROWS = 40;
const MAX_CHAT_ROWS = 8;

type SeedTable =
  | 'products'
  | 'customers'
  | 'suppliers'
  | 'employees'
  | 'transactions'
  | 'stock-movements'
  | 'receipts'
  | 'chats';

const ALLOWED_TABLES: readonly SeedTable[] = [
  'products',
  'customers',
  'suppliers',
  'employees',
  'transactions',
  'stock-movements',
  'receipts',
  'chats',
];

// ── tiny safe parsers (a seed script sends plain JSON) ───────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function isoDate(v: unknown): Date | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const dec = (v: unknown, d = 0) => new Prisma.Decimal(num(v) ?? d);
const decOrNull = (v: unknown) => (num(v) === null ? undefined : new Prisma.Decimal(num(v) as number));

// ── FK collection + validation ───────────────────────────────────────────────

interface FkRefs {
  stores: Set<string>;
  users: Set<string>;
  products: Set<string>;
  categories: Set<string>;
  subcategories: Set<string>;
  customers: Set<string>;
  transactions: Set<string>;
}

function newFkRefs(): FkRefs {
  return {
    stores: new Set(),
    users: new Set(),
    products: new Set(),
    categories: new Set(),
    subcategories: new Set(),
    customers: new Set(),
    transactions: new Set(),
  };
}

function collectFks(table: SeedTable, rows: Record<string, unknown>[], refs: FkRefs): void {
  for (const row of rows) {
    const storeId = str(row.storeId);
    if (storeId) refs.stores.add(storeId);
    if (table === 'products') {
      const c = str(row.categoryId);
      const s = str(row.subcategoryId);
      if (c) refs.categories.add(c);
      if (s) refs.subcategories.add(s);
    }
    if (table === 'employees') {
      const u = str(row.userId);
      if (u) refs.users.add(u);
    }
    if (table === 'stock-movements') {
      const p = str(row.productId);
      const u = str(row.performedBy);
      if (p) refs.products.add(p);
      if (u) refs.users.add(u);
    }
    if (table === 'receipts') {
      const t = str(row.transactionId);
      if (t) refs.transactions.add(t);
    }
    if (table === 'transactions') {
      const cashier = str(row.cashierId);
      const customer = str(row.customerId);
      if (cashier) refs.users.add(cashier);
      if (customer) refs.customers.add(customer);
      const items = Array.isArray(row.items) ? row.items : [];
      for (const raw of items) {
        const it = asRecord(raw);
        const pid = it ? str(it.productId) : null;
        if (pid) refs.products.add(pid);
      }
    }
    if (table === 'chats') {
      const msgs = Array.isArray(row.messages) ? row.messages : [];
      for (const raw of msgs) {
        const m = asRecord(raw);
        const sid = m ? str(m.senderId) : null;
        if (sid) refs.users.add(sid);
      }
    }
  }
}

/**
 * Idempotency helper — return the subset of `ids` that ALREADY exists in the
 * target table. Deterministic seed ids make re-running a chunk a no-op.
 * (Flat createMany on the SQLite client cannot use skipDuplicates, so we
 * pre-filter instead; behavior is identical on PostgreSQL.)
 */
async function filterExistingIds(table: SeedTable, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const uniq = [...new Set(ids)];
  const inFilter = { id: { in: uniq } };
  switch (table) {
    case 'products': return new Set((await db.product.findMany({ where: inFilter, select: { id: true } })).map((r) => r.id));
    case 'customers': return new Set((await db.customer.findMany({ where: inFilter, select: { id: true } })).map((r) => r.id));
    case 'suppliers': return new Set((await db.supplier.findMany({ where: inFilter, select: { id: true } })).map((r) => r.id));
    case 'employees': return new Set((await db.employee.findMany({ where: inFilter, select: { id: true } })).map((r) => r.id));
    case 'stock-movements': return new Set((await db.stockMovement.findMany({ where: inFilter, select: { id: true } })).map((r) => r.id));
    case 'receipts': return new Set((await db.receipt.findMany({ where: inFilter, select: { id: true } })).map((r) => r.id));
    case 'transactions': return new Set((await db.salesTransaction.findMany({ where: inFilter, select: { id: true } })).map((r) => r.id));
    default: return new Set((await db.conversation.findMany({ where: inFilter, select: { id: true } })).map((r) => r.id));
  }
}

async function findMissingFks(refs: FkRefs): Promise<string[]> {
  const [
    stores,
    users,
    products,
    categories,
    subcategories,
    customers,
    transactions,
  ] = await Promise.all([
    refs.stores.size ? db.store.findMany({ where: { id: { in: [...refs.stores] } }, select: { id: true } }) : [],
    refs.users.size ? db.user.findMany({ where: { id: { in: [...refs.users] } }, select: { id: true } }) : [],
    refs.products.size ? db.product.findMany({ where: { id: { in: [...refs.products] } }, select: { id: true } }) : [],
    refs.categories.size ? db.productCategory.findMany({ where: { id: { in: [...refs.categories] } }, select: { id: true } }) : [],
    refs.subcategories.size ? db.subCategory.findMany({ where: { id: { in: [...refs.subcategories] } }, select: { id: true } }) : [],
    refs.customers.size ? db.customer.findMany({ where: { id: { in: [...refs.customers] } }, select: { id: true } }) : [],
    refs.transactions.size ? db.salesTransaction.findMany({ where: { id: { in: [...refs.transactions] } }, select: { id: true } }) : [],
  ]);
  const found = new Set<string>([
    ...stores.map((r) => r.id),
    ...users.map((r) => r.id),
    ...products.map((r) => r.id),
    ...categories.map((r) => r.id),
    ...subcategories.map((r) => r.id),
    ...customers.map((r) => r.id),
    ...transactions.map((r) => r.id),
  ]);
  const all = new Set<string>([
    ...refs.stores,
    ...refs.users,
    ...refs.products,
    ...refs.categories,
    ...refs.subcategories,
    ...refs.customers,
    ...refs.transactions,
  ]);
  return [...all].filter((id) => !found.has(id));
}

// ── row builders (validate + whitelist fields defensively) ──────────────────

type RowResult<T> = { ok: T | null; error?: string };

function buildProduct(r: Record<string, unknown>): RowResult<Prisma.ProductCreateManyInput> {
  const storeId = str(r.storeId);
  const sku = str(r.sku);
  const name = str(r.name);
  const price = num(r.pricePerUnit);
  const cost = num(r.costPrice);
  if (!storeId || !sku || !name || price === null || cost === null) {
    return { ok: null, error: 'products require storeId, sku, name, pricePerUnit, costPrice' };
  }
  const maxLevel = typeof r.maximumStockLevel === 'number' ? r.maximumStockLevel : undefined;
  return {
    ok: {
      id: str(r.id) ?? undefined,
      storeId,
      categoryId: str(r.categoryId) ?? undefined,
      subcategoryId: str(r.subcategoryId) ?? undefined,
      sku,
      barcode: str(r.barcode) ?? undefined,
      name,
      description: str(r.description) ?? undefined,
      unitType: str(r.unitType) ?? 'PIECE',
      quantityInStock: dec(r.quantityInStock),
      reorderLevel: dec(r.reorderLevel, 10),
      pricePerUnit: new Prisma.Decimal(price),
      costPrice: new Prisma.Decimal(cost),
      taxRate: dec(r.taxRate, 16),
      isRental: bool(r.isRental),
      isBundle: bool(r.isBundle),
      isActive: bool(r.isActive, true),
      minimumStockLevel: typeof r.minimumStockLevel === 'number' ? Math.trunc(r.minimumStockLevel) : 0,
      maximumStockLevel: maxLevel,
      createdAt: isoDate(r.createdAt),
      updatedAt: isoDate(r.updatedAt),
    },
  };
}

function buildCustomer(r: Record<string, unknown>): RowResult<Prisma.CustomerCreateManyInput> {
  const storeId = str(r.storeId);
  const name = str(r.name);
  if (!storeId || !name) return { ok: null, error: 'customers require storeId and name' };
  const points = typeof r.loyaltyPoints === 'number' ? Math.trunc(r.loyaltyPoints) : 0;
  return {
    ok: {
      id: str(r.id) ?? undefined,
      storeId,
      name,
      phone: str(r.phone) ?? undefined,
      email: str(r.email) ?? undefined,
      address: str(r.address) ?? undefined,
      idNumber: str(r.idNumber) ?? undefined,
      currentDebtBalance: dec(r.currentDebtBalance),
      debtLimit: dec(r.debtLimit, 50000),
      loyaltyPoints: points,
      totalLoyaltyEarned: typeof r.totalLoyaltyEarned === 'number' ? Math.trunc(r.totalLoyaltyEarned) : points,
      loyaltyTier: str(r.loyaltyTier) ?? 'BRONZE',
      joinedAt: isoDate(r.joinedAt),
      preferredChannel: str(r.preferredChannel) ?? 'SMS',
      isActive: bool(r.isActive, true),
      createdAt: isoDate(r.createdAt),
      updatedAt: isoDate(r.updatedAt),
    },
  };
}

function buildSupplier(r: Record<string, unknown>): RowResult<Prisma.SupplierCreateManyInput> {
  const storeId = str(r.storeId);
  const name = str(r.name);
  if (!storeId || !name) return { ok: null, error: 'suppliers require storeId and name' };
  const rating = num(r.rating);
  return {
    ok: {
      id: str(r.id) ?? undefined,
      storeId,
      name,
      email: str(r.email) ?? undefined,
      phone: str(r.phone) ?? undefined,
      address: str(r.address) ?? undefined,
      city: str(r.city) ?? undefined,
      contactPerson: str(r.contactPerson) ?? undefined,
      taxPin: str(r.taxPin) ?? undefined,
      paymentTerms: str(r.paymentTerms) ?? 'NET_30',
      rating: rating === null ? 3 : Math.min(5, Math.max(1, Math.trunc(rating))),
      isActive: bool(r.isActive, true),
      notes: str(r.notes) ?? undefined,
      createdAt: isoDate(r.createdAt),
      updatedAt: isoDate(r.updatedAt),
    },
  };
}

function buildEmployee(r: Record<string, unknown>): RowResult<Prisma.EmployeeCreateManyInput> {
  const storeId = str(r.storeId);
  const firstName = str(r.firstName);
  const lastName = str(r.lastName);
  const hireDate = isoDate(r.hireDate);
  if (!storeId || !firstName || !lastName || !hireDate) {
    return { ok: null, error: 'employees require storeId, firstName, lastName, hireDate' };
  }
  return {
    ok: {
      id: str(r.id) ?? undefined,
      storeId,
      employeeCode: str(r.employeeCode) ?? undefined,
      userId: str(r.userId) ?? undefined,
      firstName,
      lastName,
      email: str(r.email) ?? undefined,
      phone: str(r.phone) ?? undefined,
      nationalId: str(r.nationalId) ?? undefined,
      kraPin: str(r.kraPin) ?? undefined,
      nssfNumber: str(r.nssfNumber) ?? undefined,
      nhifNumber: str(r.nhifNumber) ?? undefined,
      jobTitle: str(r.jobTitle) ?? undefined,
      role: str(r.role) ?? 'STAFF',
      employmentType: str(r.employmentType) ?? 'PERMANENT',
      hireDate,
      terminationDate: isoDate(r.terminationDate),
      status: str(r.status) ?? 'ACTIVE',
      basicSalary: dec(r.basicSalary),
      hourlyRate: decOrNull(r.hourlyRate),
      houseAllowance: dec(r.houseAllowance),
      transportAllowance: dec(r.transportAllowance),
      medicalAllowance: dec(r.medicalAllowance),
      otherAllowances: dec(r.otherAllowances),
      payeExempt: bool(r.payeExempt),
      nssfExempt: bool(r.nssfExempt),
      nhifExempt: bool(r.nhifExempt),
      bankName: str(r.bankName) ?? undefined,
      bankAccountName: str(r.bankAccountName) ?? undefined,
      bankAccountNumber: str(r.bankAccountNumber) ?? undefined,
      bankBranchCode: str(r.bankBranchCode) ?? undefined,
      emergencyContactName: str(r.emergencyContactName) ?? undefined,
      emergencyContactPhone: str(r.emergencyContactPhone) ?? undefined,
      emergencyContactRelation: str(r.emergencyContactRelation) ?? undefined,
      notes: str(r.notes) ?? undefined,
      createdAt: isoDate(r.createdAt),
      updatedAt: isoDate(r.updatedAt),
    },
  };
}

function buildReceipt(r: Record<string, unknown>): RowResult<Prisma.ReceiptCreateManyInput> {
  const storeId = str(r.storeId);
  const transactionId = str(r.transactionId);
  const receiptNumber = str(r.receiptNumber);
  if (!storeId || !transactionId || !receiptNumber) {
    return { ok: null, error: 'receipts require storeId, transactionId, receiptNumber' };
  }
  return {
    ok: {
      id: str(r.id) ?? undefined,
      storeId,
      transactionId,
      receiptNumber,
      receiptType: str(r.receiptType) ?? 'PRINTED',
      sentTo: str(r.sentTo) ?? undefined,
      sentAt: isoDate(r.sentAt),
      createdAt: isoDate(r.createdAt),
    },
  };
}

function buildStockMovement(r: Record<string, unknown>): RowResult<Prisma.StockMovementCreateManyInput> {
  const storeId = str(r.storeId);
  const productId = str(r.productId);
  const movementType = str(r.movementType);
  const quantity = num(r.quantity);
  if (!storeId || !productId || !movementType || quantity === null) {
    return { ok: null, error: 'stock-movements require storeId, productId, movementType, quantity' };
  }
  return {
    ok: {
      id: str(r.id) ?? undefined,
      storeId,
      productId,
      movementType,
      quantity: new Prisma.Decimal(quantity),
      referenceId: str(r.referenceId) ?? undefined,
      notes: str(r.notes) ?? undefined,
      performedBy: str(r.performedBy) ?? undefined,
      createdAt: isoDate(r.createdAt),
    },
  };
}

type TxRow = { tx: Prisma.SalesTransactionCreateInput; id: string };

function buildTransaction(r: Record<string, unknown>): RowResult<TxRow> {
  const storeId = str(r.storeId);
  const receiptNumber = str(r.receiptNumber);
  const cashierId = str(r.cashierId);
  const subtotal = num(r.subtotal);
  const taxAmount = num(r.taxAmount);
  const totalAmount = num(r.totalAmount);
  const paymentMethod = str(r.paymentMethod);
  if (!storeId || !receiptNumber || !cashierId || subtotal === null || taxAmount === null ||
      totalAmount === null || !paymentMethod) {
    return {
      ok: null,
      error: 'transactions require storeId, receiptNumber, cashierId, subtotal, taxAmount, totalAmount, paymentMethod',
    };
  }
  const items = Array.isArray(r.items) ? r.items : [];
  const payments = Array.isArray(r.payments) ? r.payments : [];
  const itemCreates: Prisma.SaleItemCreateWithoutTransactionInput[] = [];
  for (const raw of items) {
    const it = asRecord(raw);
    if (!it) continue;
    const productId = str(it.productId);
    const productName = str(it.productName);
    const quantity = num(it.quantity);
    const pricePerUnit = num(it.pricePerUnit);
    const costPrice = num(it.costPrice);
    const lineTotal = num(it.lineTotal);
    if (!productId || !productName || quantity === null || pricePerUnit === null ||
        costPrice === null || lineTotal === null) {
      return { ok: null, error: `sale item on ${receiptNumber} missing required fields` };
    }
    itemCreates.push({
      product: { connect: { id: productId } },
      productName,
      quantity: new Prisma.Decimal(quantity),
      unitType: str(it.unitType) ?? 'PIECE',
      pricePerUnit: new Prisma.Decimal(pricePerUnit),
      costPrice: new Prisma.Decimal(costPrice),
      discountPercent: dec(it.discountPercent),
      taxRate: dec(it.taxRate, 16),
      lineTotal: new Prisma.Decimal(lineTotal),
      isRentalItem: bool(it.isRentalItem),
    });
  }
  const paymentCreates: Prisma.PaymentCreateWithoutTransactionInput[] = [];
  for (const raw of payments) {
    const p = asRecord(raw);
    if (!p) continue;
    const payStoreId = str(p.storeId);
    const amount = num(p.amount);
    if (!payStoreId || amount === null) {
      return { ok: null, error: `payment on ${receiptNumber} missing storeId/amount` };
    }
    paymentCreates.push({
      store: { connect: { id: payStoreId } },
      paymentMethod: str(p.paymentMethod) ?? 'CASH',
      amount: new Prisma.Decimal(amount),
      currency: str(p.currency) ?? 'KES',
      status: str(p.status) ?? 'COMPLETED',
      reference: str(p.reference) ?? undefined,
      metadata: str(p.metadata) ?? undefined,
      processedAt: isoDate(p.processedAt),
      createdAt: isoDate(p.createdAt),
    });
  }
  const customerId = str(r.customerId);
  const tx: Prisma.SalesTransactionCreateInput = {
    id: str(r.id) ?? undefined,
    store: { connect: { id: storeId } },
    receiptNumber,
    ...(customerId ? { customer: { connect: { id: customerId } } } : {}),
    cashier: { connect: { id: cashierId } },
    subtotal: new Prisma.Decimal(subtotal),
    taxAmount: new Prisma.Decimal(taxAmount),
    discountAmount: dec(r.discountAmount),
    totalAmount: new Prisma.Decimal(totalAmount),
    cashTendered: decOrNull(r.cashTendered),
    changeDue: decOrNull(r.changeDue),
    paymentMethod,
    paymentStatus: str(r.paymentStatus) ?? 'COMPLETED',
    transactionType: str(r.transactionType) ?? 'SALE',
    notes: str(r.notes) ?? undefined,
    isOffline: bool(r.isOffline),
    idempotencyKey: str(r.idempotencyKey) ?? undefined,
    createdAt: isoDate(r.createdAt),
    updatedAt: isoDate(r.updatedAt),
    items: { create: itemCreates },
    payments: { create: paymentCreates },
  };
  return { ok: { tx, id: str(r.id) ?? receiptNumber } };
}

type ChatRow = { conv: Prisma.ConversationCreateInput; id: string };

function buildChat(r: Record<string, unknown>): RowResult<ChatRow> {
  const storeId = str(r.storeId);
  if (!storeId) return { ok: null, error: 'chats require storeId' };
  const msgs = Array.isArray(r.messages) ? r.messages : [];
  const messageCreates: Prisma.ConversationMessageCreateWithoutConversationInput[] = [];
  for (const raw of msgs) {
    const m = asRecord(raw);
    if (!m) continue;
    const senderId = str(m.senderId);
    const content = str(m.content);
    if (!senderId || !content) {
      return { ok: null, error: `chat message in "${str(r.title) ?? '?'}" requires senderId + content` };
    }
    messageCreates.push({
      id: str(m.id) ?? undefined,
      sender: { connect: { id: senderId } },
      content,
      messageType: str(m.messageType) ?? 'TEXT',
      readStatus: str(m.readStatus) ?? '{}',
      attachmentUrl: str(m.attachmentUrl) ?? undefined,
      sentAt: isoDate(m.sentAt),
    });
  }
  const conv: Prisma.ConversationCreateInput = {
    id: str(r.id) ?? undefined,
    store: { connect: { id: storeId } },
    type: str(r.type) ?? 'INTERNAL',
    title: str(r.title) ?? undefined,
    participantIds: str(r.participantIds) ?? '[]',
    lastMessageAt: isoDate(r.lastMessageAt),
    lastMessagePreview: str(r.lastMessagePreview) ?? undefined,
    createdAt: isoDate(r.createdAt),
    updatedAt: isoDate(r.updatedAt),
    messages: { create: messageCreates },
  };
  return { ok: { conv, id: str(r.id) ?? `seedv_${storeId}` } };
}

// ── handler ──────────────────────────────────────────────────────────────────

async function bulkSeedHandler(request: NextRequest): Promise<Response> {
  if (!isCSRFValid(request)) {
    return Response.json(
      { success: false, error: 'CSRF validation failed. Send an allowed Origin header.' },
      { status: 403 }
    );
  }

  const body = asRecord(await request.json().catch(() => null));
  if (!body) {
    return Response.json({ success: false, error: 'JSON body required.' }, { status: 400 });
  }

  const table = str(body.table) as SeedTable | null;
  if (!table || !ALLOWED_TABLES.includes(table)) {
    return Response.json(
      { success: false, error: `table must be one of: ${ALLOWED_TABLES.join(', ')}` },
      { status: 400 }
    );
  }
  const rawRows = Array.isArray(body.rows) ? body.rows : null;
  if (!rawRows) {
    return Response.json({ success: false, error: 'rows array required.' }, { status: 400 });
  }

  const limit =
    table === 'transactions' ? MAX_TRANSACTION_ROWS : table === 'chats' ? MAX_CHAT_ROWS : MAX_FLAT_ROWS;
  if (rawRows.length > limit) {
    return Response.json(
      { success: false, error: `Chunk too large: ${rawRows.length} rows (max ${limit} for ${table}).` },
      { status: 413 }
    );
  }

  // Build + validate every row first; report ALL invalid rows in one response.
  const builders: Record<SeedTable, (r: Record<string, unknown>) => RowResult<unknown>> = {
    products: buildProduct,
    customers: buildCustomer,
    suppliers: buildSupplier,
    employees: buildEmployee,
    'stock-movements': buildStockMovement,
    receipts: buildReceipt,
    transactions: buildTransaction,
    chats: buildChat,
  };
  const build = builders[table];
  const validRows: unknown[] = [];
  const errors: { index: number; error: string }[] = [];
  const refs = newFkRefs();
  rawRows.forEach((raw, i) => {
    const rec = asRecord(raw);
    if (!rec) {
      errors.push({ index: i, error: 'row must be an object' });
      return;
    }
    const res = build(rec);
    if (res.ok === null) errors.push({ index: i, error: res.error ?? 'invalid row' });
    else {
      validRows.push(res.ok);
      collectFks(table, [rec], refs);
    }
  });

  if (errors.length > 0) {
    return Response.json(
      { success: false, error: 'Validation failed.', data: { errors: errors.slice(0, 20) } },
      { status: 400 }
    );
  }

  // FK safety net: reject the call if any referenced entity does not exist
  // (defends the live DB from typos in a hand-run seeding script).
  const missing = await findMissingFks(refs);
  if (missing.length > 0) {
    return Response.json(
      { success: false, error: `Unknown referenced ids: ${missing.slice(0, 10).join(', ')}` },
      { status: 409 }
    );
  }

  // IDEMPOTENCY: drop rows whose deterministic id already exists. (Flat
  // createMany here cannot use skipDuplicates — the SQLite client does not
  // accept the flag — so we pre-filter by id instead, which also keeps re-run
  // behavior identical on PostgreSQL.)
  const seedIds = rawRows
    .map((r) => asRecord(r))
    .map((r) => (r ? str(r.id) : null))
    .filter((v): v is string => Boolean(v));
  const existingIds = await filterExistingIds(table, seedIds);
  const freshRows = (validRows as { id?: string }[]).filter(
    (row) => !row.id || !existingIds.has(row.id)
  );
  let inserted = 0;
  let skipped = 0;

  if (table === 'transactions' || table === 'chats') {
    // Nested tables: skip is counted per row inside the loop (ids that the
    // pre-filter already removed are part of validRows here).
    const rows = validRows as (TxRow | ChatRow)[];
    for (const row of rows) {
      if (existingIds.has(row.id)) { skipped += 1; continue; }
      try {
        if (table === 'transactions') {
          await db.salesTransaction.create({ data: (row as TxRow).tx });
        } else {
          await db.conversation.create({ data: (row as ChatRow).conv });
        }
        inserted += 1;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') skipped += 1;
        else throw e;
      }
    }
  } else {
    // Flat tables: everything left in freshRows is new.
    skipped = validRows.length - freshRows.length;
    if (table === 'products' && freshRows.length) {
      const res = await db.product.createMany({ data: freshRows as Prisma.ProductCreateManyInput[] });
      inserted = res.count;
    } else if (table === 'customers' && freshRows.length) {
      const res = await db.customer.createMany({ data: freshRows as Prisma.CustomerCreateManyInput[] });
      inserted = res.count;
    } else if (table === 'suppliers' && freshRows.length) {
      const res = await db.supplier.createMany({ data: freshRows as Prisma.SupplierCreateManyInput[] });
      inserted = res.count;
    } else if (table === 'employees' && freshRows.length) {
      const res = await db.employee.createMany({ data: freshRows as Prisma.EmployeeCreateManyInput[] });
      inserted = res.count;
    } else if (table === 'stock-movements' && freshRows.length) {
      const res = await db.stockMovement.createMany({ data: freshRows as Prisma.StockMovementCreateManyInput[] });
      inserted = res.count;
    } else if (table === 'receipts' && freshRows.length) {
      const res = await db.receipt.createMany({ data: freshRows as Prisma.ReceiptCreateManyInput[] });
      inserted = res.count;
    }
  }

  await systemLog({
    action: 'ADMIN_BULK_SEED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Bulk seed ${table}: ${inserted} inserted, ${skipped} skipped (${rawRows.length} submitted)`,
    metadata: { table, submitted: rawRows.length, inserted, skipped },
  });

  return Response.json({ success: true, data: { table, submitted: rawRows.length, inserted, skipped } });
}

export const POST = withErrorBoundary(
  requireAuth(bulkSeedHandler, { roles: ['SUPER_ADMIN'] }),
  'ADMIN_BULK_SEED',
);
