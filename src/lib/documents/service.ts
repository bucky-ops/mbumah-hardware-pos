// src/lib/documents/service.ts — Document & Workflow Correlation Engine
// (directive 2). One module owns the full lifecycle:
//
//   createDocument()  → QUOTE | PROFORMA (priced snapshot, zero side effects)
//   convertDocument() → PROFORMA | ORDER | SALE via CONVERSION_MATRIX
//
// INVARIANTS
//  • Financial math is delegated to computeCart (Decimal.js, discounts BEFORE
//    the 16% VAT — directive 5). The server re-prices every line from LIVE
//    product rows; client prices are never trusted.
//  • The terminal SALE conversion performs stock deduction + credit charge +
//    payment records + lineage flip inside ONE $transaction (directive 2's
//    "atomic database transaction"), reusing the guarded CAS decrement that
//    survived the concurrency audit — two clerks converting the same order
//    can never oversell or double-charge.
//  • Lineage: the source document flips to CONVERTED and the child carries
//    convertedFromId. Nothing is deleted; the chain is fully navigable.
//  • BOLA: every persisted row involved (source doc, products, customer) is
//    checked with assertBranchAccess against the session user.
//  • QUOTE/PROFORMA expiry: validUntil in the past blocks conversion (400).
//    A dedicated cron may later flip stale rows to EXPIRED; the guard here is
//    authoritative regardless of the stored status.

import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api-error-handler";
import { assertBranchAccess } from "@/lib/api/guard";
import type { SessionUser } from "@/lib/types";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { recomputeCustomerRisk } from "@/lib/credit-risk";
import { balanceDue, computeCart, round2, round3 } from "@/lib/format";
import {
  CONVERSION_MATRIX,
  DOC_REF_PREFIX,
  type ConvertDocumentInput,
  type CreateDocumentInput,
  type DocumentDTO,
  type DocumentStatus,
  type DocumentSummaryDTO,
  type DocumentType,
} from "./types";

// ── Helpers ─────────────────────────────────────────────────────────────────

const EPS = 0.005; // same money-epsilon as checkout-service
const randomAlnum = (len: number): string => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // unambiguous subset
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
};
const ymd = (d = new Date()): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

/** Document refs: MBM-<branchCode>-Q|PI|SO-<yyyymmdd>-<rand> (invoices keep the sale shape). */
function documentRef(branchCode: string, type: DocumentType): string {
  if (type === "SALE") return `MBM-${branchCode}-${ymd()}-${randomAlnum(6)}`;
  return `MBM-${branchCode}-${DOC_REF_PREFIX[type]}-${ymd()}-${randomAlnum(6)}`;
}

/** Conversions allowed right now — state machine ∩ "still open". */
export function nextTargetsFor(type: DocumentType, status: DocumentStatus): DocumentType[] {
  if (status !== "OPEN") return [];
  return [...CONVERSION_MATRIX[type]];
}

function isDocumentRow(row: { type: string }): boolean {
  return row.type === "QUOTE" || row.type === "PROFORMA" || row.type === "ORDER";
}

/** Sale status derivation — mirrors checkout-service exactly. */
function saleStatus(grand: number, amountPaid: number, creditAmount: number): DocumentStatus {
  if (grand <= 0) return "COMPLETED";
  if (creditAmount >= grand - EPS) return "CREDIT";
  if (amountPaid >= grand - EPS) return "COMPLETED";
  return "PARTIAL";
}

// ── Shared include ──────────────────────────────────────────────────────────

const DOC_INCLUDE = {
  // TransactionItem has no createdAt column — id preserves insertion order.
  items: { orderBy: { id: "asc" as const } },
  payments: { orderBy: { receivedAt: "asc" as const } },
  branch: { select: { code: true } },
  customer: { select: { name: true } },
  user: { select: { name: true } },
  convertedFrom: { select: { ref: true } },
} satisfies Prisma.TransactionInclude;

type DocRow = Prisma.TransactionGetPayload<{ include: typeof DOC_INCLUDE }>;

/** Row → wire DTO (money serialized as strings; Decimal-free on the wire). */
function toDocumentDTO(row: DocRow): DocumentDTO {
  return {
    id: row.id,
    ref: row.ref,
    type: row.type as DocumentType,
    status: row.status as DocumentStatus,
    branchId: row.branchId,
    branchCode: row.branch.code,
    customerId: row.customerId,
    customerName: row.customer?.name ?? null,
    subtotal: String(row.subtotal),
    discountAmount: String(row.discountAmount),
    vatAmount: String(row.vatAmount),
    totalAmount: String(row.totalAmount),
    amountPaid: String(row.amountPaid),
    balanceDue: String(row.balanceDue),
    vatInclusive: row.vatInclusive,
    validUntil: row.validUntil ? row.validUntil.toISOString() : null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    convertedFromId: row.convertedFromId,
    convertedFromRef: row.convertedFrom?.ref ?? null,
    createdBy: row.user.name,
    items: row.items.map((it) => ({
      id: it.id,
      productId: it.productId,
      description: it.description,
      uom: it.uom,
      qty: String(it.qty),
      unitPrice: String(it.unitPrice),
      discountPct: String(it.discountPct),
      lineDiscount: String(it.lineDiscount),
      lineNet: String(it.lineNet),
      vatAmount: String(it.vatAmount),
      lineTotal: String(it.lineTotal),
      taxCategory: it.taxCategory,
    })),
    payments: row.payments.map((p) => ({
      method: p.method as DocumentDTO["payments"][number]["method"],
      amount: String(p.amount),
      receivedAt: p.receivedAt.toISOString(),
    })),
    nextTargets: nextTargetsFor(row.type as DocumentType, row.status as DocumentStatus),
  };
}

function toSummaryDTO(row: DocRow): DocumentSummaryDTO {
  const { items: _items, payments: _payments, ...rest } = toDocumentDTO(row);
  void _items;
  void _payments;
  return { ...rest, itemCount: row.items.length };
}

// ── createDocument — QUOTE / PROFORMA ───────────────────────────────────────

export async function createDocument(
  user: SessionUser,
  input: CreateDocumentInput
): Promise<DocumentDTO> {
  // Documents always belong to the creator's branch — no cross-branch
  // creation, which makes the row's branchId trustworthy for every later
  // layer-2 check (OWNER included: quotes follow the clerk who wrote them).
  const branch = await db.branch.findUnique({ where: { id: user.branchId } });
  if (!branch) throw ApiError.notFound("Session branch not found");

  if (input.items.length === 0) throw ApiError.badRequest("At least one line item is required");

  // Customer (optional — walk-in quotations allowed). BOLA-checked.
  if (input.customerId) {
    const customer = await db.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw ApiError.notFound("Customer not found");
    assertBranchAccess(user, customer.branchId);
  }

  // ── Live re-pricing: prices/tax/uom come ONLY from the product table. ─────
  const productIds = Array.from(new Set(input.items.map((i) => i.productId)));
  const products = await db.product.findMany({ where: { id: { in: productIds } } });
  const productMap = new Map(products.map((p) => [p.id, p]));
  for (const pid of productIds) {
    const p = productMap.get(pid);
    if (!p) throw ApiError.notFound(`Product not found: ${pid}`);
    assertBranchAccess(user, p.branchId);
  }

  // Financial engine — identical math to POS checkout (discounts BEFORE 16% VAT).
  const { lines: lineMaths, totals } = computeCart(
    input.items.map((item) => {
      const p = productMap.get(item.productId);
      if (!p) throw ApiError.notFound(`Product not found: ${item.productId}`);
      return {
        qty: item.qty,
        unitPrice: Number(p.sellingPrice), // server price is the only price
        discountPct: item.discountPct ?? 0,
        isTaxExempt: p.isTaxExempt,
        uom: p.unit,
        description: p.name,
      };
    }),
    { orderDiscountPct: input.orderDiscountPct ?? 0, vatInclusive: input.vatInclusive ?? false }
  );

  const grand = totals.grandTotal;
  const validUntil = input.validUntil ? new Date(input.validUntil) : null;
  if (validUntil && Number.isNaN(validUntil.getTime())) {
    throw ApiError.badRequest("validUntil is not a valid date");
  }

  const ref = documentRef(branch.code, input.type);
  const createdId = await db.$transaction(async (tx) => {
    const doc = await tx.transaction.create({
      data: {
        ref,
        type: input.type,
        status: "OPEN",
        branchId: branch.id,
        userId: user.id,
        customerId: input.customerId ?? null,
        subtotal: totals.netTotal, // Σ line nets − order discount (pre-VAT)
        discountAmount: round2(totals.lineDiscounts + totals.orderDiscount),
        vatAmount: totals.vatAmount,
        totalAmount: grand,
        amountPaid: 0,
        balanceDue: grand, // nothing paid on an OPEN document
        vatInclusive: input.vatInclusive ?? false,
        validUntil,
        notes: input.notes ?? null,
        items: {
          create: input.items.map((item, idx) => {
            const p = productMap.get(item.productId);
            if (!p) throw ApiError.notFound(`Product not found: ${item.productId}`);
            const m = lineMaths[idx];
            if (!m) throw ApiError.badRequest("Document line mismatch");
            return {
              productId: p.id,
              description: p.name,
              uom: p.unit,
              qty: item.qty,
              unitPrice: Number(p.sellingPrice),
              discountPct: item.discountPct ?? 0,
              lineDiscount: m.discount,
              lineNet: m.net,
              vatAmount: m.vat,
              lineTotal: m.total, // net (+ VAT on the exclusive basis)
              taxCategory: p.taxCategory,
              unitCost: Number(p.buyingPrice), // WAC snapshot for margin views
            };
          }),
        },
      },
      select: { id: true },
    });
    return doc.id;
  });

  const full = await db.transaction.findUnique({ where: { id: createdId }, include: DOC_INCLUDE });
  if (!full) throw ApiError.notFound("Document disappeared after commit");

  await audit({
    userId: user.id,
    action: "DOCUMENT_CREATE",
    entity: "Transaction",
    entityId: full.id,
    meta: { ref: full.ref, type: full.type, total: grand, items: input.items.length },
  });

  return toDocumentDTO(full);
}

// ── convertDocument — the correlated state transition ───────────────────────

export async function convertDocument(
  user: SessionUser,
  input: ConvertDocumentInput
): Promise<{ document: DocumentDTO; sourceRef: string }> {
  const source = await db.transaction.findUnique({
    where: { id: input.sourceId },
    include: { ...DOC_INCLUDE, branch: { select: { code: true, id: true } } },
  });
  if (!source) throw ApiError.notFound("Source document not found");
  assertBranchAccess(user, source.branchId); // BOLA: persisted row is authoritative

  const sourceType = source.type as DocumentType;
  if (!isDocumentRow(source)) {
    throw ApiError.badRequest("Only QUOTE/PROFORMA/ORDER documents can be converted");
  }
  if (source.status !== "OPEN") {
    throw ApiError.badRequest(
      `Document is not convertible (status: ${source.status}) — it may already be converted, cancelled or expired`
    );
  }

  const allowed = CONVERSION_MATRIX[sourceType];
  if (!allowed.includes(input.targetType)) {
    throw ApiError.badRequest(`Cannot convert a ${sourceType} to ${input.targetType}`);
  }

  // Expiry guard — an expired quotation never becomes money.
  if (source.validUntil && source.validUntil.getTime() < Date.now()) {
    throw ApiError.badRequest(
      `Document expired on ${source.validUntil.toISOString().slice(0, 10)} and can no longer be converted`
    );
  }

  if (source.items.length === 0) throw ApiError.badRequest("Source document has no line items");

  const branchCode = source.branch.code;
  const ref = documentRef(branchCode, input.targetType);

  // ── Live re-price from CURRENT product rows (prices may have moved since
  // the quote was written; the customer always sees today's price list). ────
  const productIds = Array.from(
    new Set(source.items.filter((it) => it.productId).map((it) => it.productId as string))
  );
  const products = await db.product.findMany({ where: { id: { in: productIds } } });
  const productMap = new Map(products.map((p) => [p.id, p]));
  for (const pid of productIds) {
    const p = productMap.get(pid);
    if (!p) throw ApiError.notFound(`Product no longer available: ${pid}`);
    assertBranchAccess(user, p.branchId);
  }

  const cartLines = source.items.map((it) => {
    const p = it.productId ? productMap.get(it.productId) : undefined;
    if (it.productId && !p) throw ApiError.notFound(`Product no longer available: ${it.description}`);
    return {
      qty: Number(it.qty),
      unitPrice: p ? Number(p.sellingPrice) : Number(it.unitPrice), // server price only
      discountPct: Number(it.discountPct), // negotiated discount carries over
      isTaxExempt: p ? p.isTaxExempt : it.taxCategory === "A",
      uom: p ? p.unit : it.uom,
      description: p ? p.name : it.description,
    };
  });
  const { lines: lineMaths, totals } = computeCart(cartLines, {
    orderDiscountPct: 0, // per-line discounts are the negotiated terms; order-level is POS-only
    vatInclusive: source.vatInclusive,
  });

  // ── SALE-specific planning (cash path) ────────────────────────────────────
  const grand = totals.grandTotal;
  const method = input.paymentMethod ?? "CASH";
  const cashAmount =
    input.targetType === "SALE" ? Math.min(round2(input.paymentAmount ?? grand), grand) : 0;
  if (cashAmount < 0) throw ApiError.badRequest("paymentAmount cannot be negative");
  const wantsCredit = input.targetType === "SALE" && (input.useCredit ?? false);
  const creditAmount = wantsCredit ? round2(Math.max(grand - cashAmount, 0)) : 0;
  if (wantsCredit && !source.customerId) {
    throw ApiError.badRequest("Store-credit charge requires the document to have a customer");
  }
  if (wantsCredit && creditAmount <= EPS && cashAmount >= grand - EPS) {
    // Fully paid in cash — no credit leg needed.
  }
  const amountPaid = round2(cashAmount + creditAmount);
  const due = balanceDue(grand, amountPaid);
  const saleStatusFinal = saleStatus(grand, amountPaid, creditAmount);

  const validUntil =
    input.targetType === "SALE" ? null : input.validUntil ? new Date(input.validUntil) : source.validUntil;

  let newDocId: string;
  try {
    newDocId = await db.$transaction(async (tx) => {
      // HARD CREDIT GATE — read-modify-write inside the same tx that writes the
      // ledger, so concurrent conversions cannot both pass the limit check.
      interface CreditCharge {
        creditAccountId: string;
        customerId: string;
        amount: number;
        previousBalance: number;
        newBalance: number;
      }
      let creditCharge: CreditCharge | null = null;
      if (creditAmount > 0 && source.customerId) {
        const customer = await tx.customer.findUnique({ where: { id: source.customerId } });
        if (!customer) throw ApiError.notFound("Customer not found");
        const account = await tx.creditAccount.findUnique({ where: { customerId: customer.id } });
        if (!account) throw ApiError.badRequest("Customer has no store-credit account");
        if (account.status !== "ACTIVE") {
          throw ApiError.badRequest(`Customer credit account is ${account.status}`);
        }
        // Spec formula: projected = currentBalance + credit − cashTenderedNow.
        const projected = round2(Number(customer.currentBalance) + creditAmount - cashAmount);
        if (projected > Number(account.creditLimit)) {
          throw new ApiError(400, "Credit Limit Exceeded");
        }
        creditCharge = {
          creditAccountId: account.id,
          customerId: customer.id,
          amount: creditAmount,
          previousBalance: Number(customer.currentBalance),
          newBalance: projected,
        };
      }

      const doc = await tx.transaction.create({
        data: {
          ref,
          type: input.targetType,
          status: input.targetType === "SALE" ? saleStatusFinal : "OPEN",
          branchId: source.branchId,
          userId: user.id,
          customerId: source.customerId,
          subtotal: totals.netTotal,
          discountAmount: round2(totals.lineDiscounts),
          vatAmount: totals.vatAmount,
          totalAmount: grand,
          amountPaid,
          balanceDue: due,
          vatInclusive: source.vatInclusive,
          validUntil,
          notes: input.notes ?? source.notes,
          convertedFromId: source.id, // immutable lineage pointer
          items: {
            create: source.items.map((it, idx) => {
              const m = lineMaths[idx];
              if (!m) throw ApiError.badRequest("Conversion line mismatch");
              const p = it.productId ? productMap.get(it.productId) : undefined;
              return {
                productId: it.productId,
                description: p ? p.name : it.description,
                uom: p ? p.unit : it.uom,
                qty: Number(it.qty),
                unitPrice: p ? Number(p.sellingPrice) : Number(it.unitPrice),
                discountPct: Number(it.discountPct),
                lineDiscount: m.discount,
                lineNet: m.net,
                vatAmount: m.vat,
                lineTotal: m.total,
                taxCategory: p ? p.taxCategory : it.taxCategory,
                unitCost: p ? Number(p.buyingPrice) : Number(it.unitCost),
              };
            }),
          },
          payments:
            input.targetType === "SALE"
              ? {
                  create: [
                    ...(cashAmount > 0
                      ? [
                          {
                            branchId: source.branchId,
                            method,
                            amount: cashAmount,
                            reference: `CONV:${source.ref}`,
                            status: "COMPLETED",
                          },
                        ]
                      : []),
                    ...(creditCharge
                      ? [
                          {
                            branchId: source.branchId,
                            method: "STORE_CREDIT" as const,
                            amount: creditCharge.amount,
                            reference: `CONV:${source.ref}`,
                            status: "PENDING",
                          },
                        ]
                      : []),
                  ],
                }
              : undefined,
        },
        select: { id: true },
      });

      // ── Terminal SALE side effects: credit ledger + balances + risk. ───────
      if (creditCharge) {
        await tx.creditLedger.create({
          data: {
            creditAccountId: creditCharge.creditAccountId,
            transactionType: "CHARGE",
            amount: creditCharge.amount,
            previousBalance: creditCharge.previousBalance,
            newBalance: creditCharge.newBalance,
            referenceId: ref,
            note: `Store credit charge — conversion of ${source.ref}`,
            performedBy: user.id,
          },
        });
        await tx.creditAccount.update({
          where: { id: creditCharge.creditAccountId },
          data: { totalDebt: creditCharge.newBalance },
        });
        await tx.customer.update({
          where: { id: creditCharge.customerId },
          data: { currentBalance: creditCharge.newBalance },
        });
        await recomputeCustomerRisk(tx, creditCharge.customerId);
      }

      // ── Terminal SALE side effects: guarded CAS stock decrement. ──────────
      // Aggregate per product (one product may span several lines), then let
      // the database arbitrate availability — a stale read can never oversell.
      if (input.targetType === "SALE") {
        const qtyByProduct = new Map<string, number>();
        for (const it of source.items) {
          if (!it.productId) continue;
          qtyByProduct.set(
            it.productId,
            round3((qtyByProduct.get(it.productId) ?? 0) + Number(it.qty))
          );
        }
        for (const [productId, totalQty] of qtyByProduct) {
          const p = productMap.get(productId);
          if (!p) continue;
          const cas = await tx.product.updateMany({
            where: { id: productId, stockQty: { gte: totalQty } },
            data: { stockQty: { decrement: totalQty } },
          });
          if (cas.count === 0) throw ApiError.conflict(`Insufficient stock: ${p.name}`);
          await tx.stockAdjustment.create({
            data: {
              productId,
              branchId: source.branchId,
              type: "SALE",
              quantity: -totalQty,
              unitCost: Number(p.buyingPrice),
              reason: `Conversion of ${source.ref}`,
              reference: ref,
              userId: user.id,
            },
          });
        }
      }

      // ── Lineage flip: source → CONVERTED (same atomic commit). ────────────
      await tx.transaction.update({
        where: { id: source.id },
        data: { status: "CONVERTED" },
      });

      return doc.id;
    });
  } catch (err) {
    // Lost a unique-ref race (astronomically unlikely) → surface a clean 409
    // instead of an opaque P2002. The client can simply retry.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw ApiError.conflict("Reference collision on conversion — retry");
    }
    throw err;
  }

  const full = await db.transaction.findUnique({ where: { id: newDocId }, include: DOC_INCLUDE });
  if (!full) throw ApiError.notFound("Converted document disappeared after commit");

  await audit({
    userId: user.id,
    action: "DOCUMENT_CONVERT",
    entity: "Transaction",
    entityId: full.id,
    meta: {
      ref: full.ref,
      from: source.ref,
      fromType: source.type,
      toType: full.type,
      status: full.status,
      total: grand,
      amountPaid,
      credit: creditAmount,
      stockMoved: input.targetType === "SALE",
    },
  });

  return { document: toDocumentDTO(full), sourceRef: source.ref };
}

// ── listDocuments — filters + BOLA branch scoping ───────────────────────────

export interface ListDocumentsOptions {
  branchId?: string; // pre-scoped by the route for non-OWNERs
  type?: DocumentType;
  status?: DocumentStatus;
  limit: number;
}

export async function listDocuments(opts: ListDocumentsOptions): Promise<DocumentSummaryDTO[]> {
  const rows = await db.transaction.findMany({
    where: {
      type: { in: ["QUOTE", "PROFORMA", "ORDER"] }, // documents; SALE list stays in Sales History
      ...(opts.type && opts.type !== "SALE" ? { type: opts.type } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.limit,
    include: DOC_INCLUDE,
  });
  return rows.map(toSummaryDTO);
}

// ── getDocument — detail + chain ────────────────────────────────────────────

export async function getDocument(user: SessionUser, id: string): Promise<DocumentDTO> {
  const row = await db.transaction.findUnique({
    where: { id },
    include: DOC_INCLUDE,
  });
  if (!row) throw ApiError.notFound("Document not found");
  assertBranchAccess(user, row.branchId); // BOLA: persisted row is authoritative
  return toDocumentDTO(row);
}
