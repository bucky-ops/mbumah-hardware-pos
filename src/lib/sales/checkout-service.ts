import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { computeCart, balanceDue, round2, round3, D } from "@/lib/format";
import { ApiError } from "@/lib/api-error-handler";
import { assertBranchAccess } from "@/lib/api/guard";
import { audit } from "@/lib/audit";
import { decryptKraPin } from "@/lib/crypto";
import { recomputeCustomerRisk } from "@/lib/credit-risk";
import type { PaymentMethod, ReceiptData, SessionUser } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Server-authoritative checkout service — shared by:
//   • POST /api/v1/sales/checkout   (live till)
//   • POST /api/v1/sales/sync       (offline queue flush)
//
// SECURITY CONTRACT
//   1. NEVER trust client prices/discounts beyond the validated envelopes —
//      unitPrice, tax flags, UoM and descriptions are re-read from the DB.
//   2. Single-branch carts: every product (and the customer) must pass
//      assertBranchAccess against the session principal (BOLA fence).
//   3. STORE_CREDIT charges are validated ATOMICALLY inside db.$transaction
//      with the ledger write, so concurrent tills can never exceed a credit
//      limit via a race (the guard + ledger update share the same lock window).
//   4. Stock decrement + StockAdjustment + transaction + items + payments +
//      credit ledger all commit together or not at all.
//   5. Every TransactionItem snapshots unitCost = the product's sale-time
//      weighted-average cost (buyingPrice is the running WAC maintained by
//      /api/inventory/adjust on restock). Reports compute TRUE margin from
//      this snapshot instead of re-pricing history at today's cost.
//   6. A STORE_CREDIT charge re-scores the borrower's credit risk in the SAME
//      transaction (after the ledger CHARGE + balance writes, so utilization
//      reflects the new balance); pure-cash checkouts never touch the risk
//      engine. The fresh score is returned as CheckoutResult.riskScore.
// ─────────────────────────────────────────────────────────────────────────────

export const checkoutBodySchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        qty: z.coerce.number().gt(0).lte(100000),
        discountPct: z.coerce.number().min(0).max(50).default(0),
      })
    )
    .min(1)
    .max(200),
  payments: z
    .array(
      z.object({
        method: z.enum(["CASH", "MPESA", "BANK_TRANSFER", "CARD", "STORE_CREDIT"]),
        amount: z.coerce.number().min(0),
        reference: z.string().max(100).optional(),
      })
    )
    .max(4)
    .default([]),
  customerId: z.string().min(1).optional(),
  orderDiscountPct: z.coerce.number().min(0).max(30).default(0),
  vatInclusive: z.boolean().default(false),
  notes: z.string().max(300).optional(),
});

export type CheckoutBody = z.infer<typeof checkoutBodySchema>;

export interface CheckoutTransactionDTO {
  id: string;
  ref: string;
  status: string;
  totalAmount: string;
  balanceDue: string;
}

export interface CheckoutResult {
  duplicate: boolean;
  transaction: CheckoutTransactionDTO;
  receipt: ReceiptData;
  /** Post-charge credit-risk score (0–100, higher = better payer) — present
   *  ONLY when the checkout actually charged STORE_CREDIT. */
  riskScore?: number;
}

/** Only MBM-shaped keys become the transaction ref; anything else gets a fresh one. */
const MBM_REF_PATTERN = /^MBM-[A-Z0-9-]+$/i;

function ymd(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function randomAlnum(length: number): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += charset[Math.floor(Math.random() * charset.length)];
  return out;
}

const RECEIPT_INCLUDE = {
  items: { include: { product: { select: { hsCode: true } } } },
  payments: true,
  customer: true,
  branch: true,
  user: { select: { name: true } },
} satisfies Prisma.TransactionInclude;

type FullTransaction = Prisma.TransactionGetPayload<{ include: typeof RECEIPT_INCLUDE }>;

const FALLBACK_KRA_PIN = "P051234567X";
const FALLBACK_CU_SERIAL = "MBM-CU-0001";

/** Builds the eTIMS-flavoured ReceiptData from a fully-loaded transaction row. */
function buildReceipt(t: FullTransaction): ReceiptData {
  const hsCodes = Array.from(
    new Set(t.items.map((i) => i.product?.hsCode).filter((c): c is string => !!c))
  )
    .join(",")
    .slice(0, 80);
  const taxCategories = Array.from(new Set(t.items.map((i) => i.taxCategory))).join(",");

  return {
    ref: t.ref,
    createdAt: t.createdAt.toISOString(),
    branchName: t.branch.name,
    branchLocation: t.branch.location,
    cashier: t.user.name,
    customerName: t.customer?.name ?? null,
    lines: t.items.map((i) => ({
      description: i.description,
      qty: Number(i.qty),
      uom: i.uom,
      unitPrice: Number(i.unitPrice),
      discountPct: Number(i.discountPct),
      lineNet: Number(i.lineNet),
      vatAmount: Number(i.vatAmount),
    })),
    grossSubtotal: round2(Number(t.subtotal) + Number(t.discountAmount)),
    discount: Number(t.discountAmount),
    vat: Number(t.vatAmount),
    total: Number(t.totalAmount),
    vatInclusive: t.vatInclusive,
    payments: t.payments.map((p) => ({
      method: p.method as PaymentMethod,
      amount: Number(p.amount),
      reference: p.reference,
    })),
    balance: Number(t.balanceDue),
    kraPin: t.branch.kraPin ?? FALLBACK_KRA_PIN,
    // Verbatim buyer PIN (eTIMS tax invoice) — decrypted server-side from the
    // AES-256-GCM ciphertext; directory APIs never emit it unmasked.
    buyerPin: decryptKraPin(t.customer?.kraPinEnc) ?? null,
    invoiceNumber: t.ref,
    cuSerial: process.env.KRA_CU_SERIAL ?? FALLBACK_CU_SERIAL,
    hsCodesSummary: hsCodes,
    taxCategories,
  };
}

function toTransactionDTO(t: {
  id: string;
  ref: string;
  status: string;
  totalAmount: Prisma.Decimal | number | string;
  balanceDue: Prisma.Decimal | number | string;
}): CheckoutTransactionDTO {
  return {
    id: t.id,
    ref: t.ref,
    status: t.status,
    totalAmount: String(t.totalAmount),
    balanceDue: String(t.balanceDue),
  };
}

/**
 * Processes one checkout end-to-end. Idempotent on `idempotencyKey` when it is
 * an MBM-shaped ref (offline sync reuses stable keys); duplicate responses
 * carry the original receipt so retries can never double-charge a customer.
 */
export async function processCheckout(
  user: SessionUser,
  body: CheckoutBody,
  idempotencyKey: string
): Promise<CheckoutResult> {
  const branch = await db.branch.findUnique({ where: { id: user.branchId } });
  if (!branch) throw ApiError.notFound("Session branch not found");

  const ref = MBM_REF_PATTERN.test(idempotencyKey)
    ? idempotencyKey
    : `MBM-${branch.code}-${ymd()}-${randomAlnum(6)}`;

  // ── Offline-sync dedupe: same ref → return the original sale verbatim. ────
  const existing = await db.transaction.findUnique({ where: { ref }, include: RECEIPT_INCLUDE });
  if (existing) {
    assertBranchAccess(user, existing.branchId); // never leak other-branch receipts
    return {
      duplicate: true,
      transaction: toTransactionDTO(existing),
      receipt: buildReceipt(existing),
    };
  }

  // ── Load products; prices/tax/uom come ONLY from here (never the client). ──
  const productIds = Array.from(new Set(body.items.map((i) => i.productId)));
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    include: { branch: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));
  for (const pid of productIds) {
    if (!productMap.has(pid)) throw ApiError.notFound(`Product not found: ${pid}`);
  }
  for (const p of products) assertBranchAccess(user, p.branchId);

  // NOTE: productMap snapshots are OUTSIDE the transaction — they are safe for
  // prices/tax/uom (immutable here) but NOT for stockQty. Stock validation and
  // decrement use a guarded CAS updateMany inside the $transaction (see below),
  // so two concurrent tills can never both pass validation from a stale read
  // and clobber each other's decrement (oversell).

  // Customer pre-check (authoritative re-load happens inside the $transaction).
  if (body.customerId) {
    const customer = await db.customer.findUnique({ where: { id: body.customerId } });
    if (!customer) throw ApiError.notFound("Customer not found");
    assertBranchAccess(user, customer.branchId);
  }

  // ── Financial engine — discounts BEFORE 16% VAT, exactly like the client. ──
  const cartLines = body.items.map((item) => {
    const p = productMap.get(item.productId);
    if (!p) throw ApiError.notFound(`Product not found: ${item.productId}`);
    return {
      qty: item.qty,
      unitPrice: Number(p.sellingPrice), // server price is the only price
      discountPct: item.discountPct,
      isTaxExempt: p.isTaxExempt,
      uom: p.unit,
      description: p.name,
    };
  });
  const { lines: lineMaths, totals } = computeCart(cartLines, {
    orderDiscountPct: body.orderDiscountPct,
    vatInclusive: body.vatInclusive,
  });

  const grand = totals.grandTotal;
  const nonCreditPaid = round2(
    body.payments.filter((p) => p.method !== "STORE_CREDIT").reduce((s, p) => s + p.amount, 0)
  );
  const rawCredit = round2(
    body.payments.filter((p) => p.method === "STORE_CREDIT").reduce((s, p) => s + p.amount, 0)
  );
  const creditAmount = Math.min(rawCredit, grand); // credit can never overshoot the ticket
  const amountPaid = round2(nonCreditPaid + creditAmount);
  const due = balanceDue(grand, amountPaid);

  // Status: fully credit → CREDIT; fully paid → COMPLETED; otherwise PARTIAL.
  const EPS = 0.005;
  const status =
    grand <= 0
      ? "COMPLETED"
      : creditAmount >= grand - EPS
        ? "CREDIT"
        : amountPaid >= grand - EPS
          ? "COMPLETED"
          : "PARTIAL";

  interface CreditCharge {
    creditAccountId: string;
    customerId: string;
    amount: number;
    previousBalance: number;
    newBalance: number;
  }

  let createdId: string;
  // Post-charge risk score — only ever set when a STORE_CREDIT charge was
  // committed, so pure-cash paths pay zero risk-engine overhead.
  let riskScore: number | undefined;
  try {
    createdId = await db.$transaction(async (tx) => {
      // ── Stock: aggregate per product (one product may span 2 lines with
      // different discounts). The stale pre-tx snapshot is NOT trusted for
      // availability — the guarded CAS decrement below is the single
      // authoritative check (this loop is fast-fail UX only):
      const qtyByProduct = new Map<string, number>();
      for (const item of body.items) {
        qtyByProduct.set(item.productId, round3((qtyByProduct.get(item.productId) ?? 0) + item.qty));
      }
      for (const [productId, totalQty] of qtyByProduct) {
        const p = productMap.get(productId);
        if (!p) throw ApiError.notFound(`Product not found: ${productId}`);
        const current = Number(p.stockQty);
        if (round3(current - totalQty) < 0) {
          // Almost certainly insufficient — CAS will re-verify authoritatively.
          throw ApiError.conflict(`Insufficient stock: ${p.name}`);
        }
      }

      // ── HARD CREDIT LIMIT — evaluated inside the same transaction that
      // writes the ledger, so the read-modify-write is race-free. ─────────────
      let creditCharge: CreditCharge | null = null;
      if (creditAmount > 0) {
        if (!body.customerId) {
          throw ApiError.badRequest("STORE_CREDIT payment requires a customer");
        }
        const customer = await tx.customer.findUnique({ where: { id: body.customerId } });
        if (!customer) throw ApiError.notFound("Customer not found");
        const account = await tx.creditAccount.findUnique({ where: { customerId: customer.id } });
        if (!account) throw ApiError.badRequest("Customer has no store-credit account");

        // Spec formula: projected = currentBalance + credit − cashTenderedNow.
        const projected = round2(Number(customer.currentBalance) + creditAmount - nonCreditPaid);
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

      const transaction = await tx.transaction.create({
        data: {
          ref,
          type: "SALE",
          status,
          branchId: branch.id,
          userId: user.id,
          customerId: body.customerId ?? null,
          subtotal: totals.netTotal, // Σ line nets − cart discount (pre-VAT)
          discountAmount: round2(totals.lineDiscounts + totals.orderDiscount),
          vatAmount: totals.vatAmount,
          totalAmount: grand,
          amountPaid,
          balanceDue: due,
          vatInclusive: body.vatInclusive,
          notes: body.notes ?? null,
          items: {
            create: body.items.map((item, idx) => {
              const p = productMap.get(item.productId);
              if (!p) throw ApiError.notFound(`Product not found: ${item.productId}`);
              const m = lineMaths[idx];
              if (!m) throw ApiError.badRequest("Cart line mismatch");
              return {
                productId: p.id,
                description: p.name,
                uom: p.unit,
                qty: item.qty,
                unitPrice: Number(p.sellingPrice),
                discountPct: item.discountPct,
                lineDiscount: m.discount,
                lineNet: m.net,
                vatAmount: m.vat,
                lineTotal: m.total, // net (+ VAT on the exclusive basis)
                taxCategory: p.taxCategory,
                unitCost: Number(p.buyingPrice), // sale-time WAC snapshot (COGS)
              };
            }),
          },
          payments: {
            create: body.payments
              .filter((p) => p.amount > 0)
              .map((p) => ({
                branchId: branch.id,
                method: p.method,
                amount: p.amount,
                reference: p.reference ?? null,
                status: p.method === "STORE_CREDIT" ? "PENDING" : "COMPLETED",
              })),
          },
        },
      });

      // ── Credit ledger CHARGE + balance propagation. ─────────────────────────
      if (creditCharge) {
        await tx.creditLedger.create({
          data: {
            creditAccountId: creditCharge.creditAccountId,
            transactionType: "CHARGE",
            amount: creditCharge.amount,
            previousBalance: creditCharge.previousBalance,
            newBalance: creditCharge.newBalance,
            referenceId: ref,
            note: `Store credit charge — sale ${ref}`,
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

        // Risk re-score in the SAME tx — the balance write above has already
        // landed, so utilization is evaluated on the post-charge balance (a
        // failure here throws → the whole checkout rolls back naturally).
        const risk = await recomputeCustomerRisk(tx, creditCharge.customerId);
        riskScore = risk.score;
      }

      // ── Stock decrement + SALE adjustment rows (same atomic commit). ────────
      for (const [productId, totalQty] of qtyByProduct) {
        const p = productMap.get(productId);
        if (!p) continue;
        // GUARDED CAS DECREMENT (audit concurrency fix): the WHERE re-checks
        // availability against the LIVE row inside the transaction and the
        // decrement is applied atomically by the database — a concurrent till
        // that already consumed the stock makes this update match 0 rows →
        // explicit conflict, never a negative or clobbered quantity.
        const cas = await tx.product.updateMany({
          where: { id: productId, stockQty: { gte: totalQty } },
          data: { stockQty: { decrement: totalQty } },
        });
        if (cas.count === 0) throw ApiError.conflict(`Insufficient stock: ${p.name}`);
        await tx.stockAdjustment.create({
          data: {
            productId,
            branchId: branch.id,
            type: "SALE",
            quantity: -totalQty,
            unitCost: Number(p.buyingPrice),
            reason: `Sale ${ref}`,
            reference: ref,
            userId: user.id,
          },
        });
      }

      return transaction.id;
    });
  } catch (err) {
    // Lost a unique-ref race (concurrent retry) → answer with the winner's sale.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await db.transaction.findUnique({ where: { ref }, include: RECEIPT_INCLUDE });
      if (winner) {
        assertBranchAccess(user, winner.branchId);
        return {
          duplicate: true,
          transaction: toTransactionDTO(winner),
          receipt: buildReceipt(winner),
        };
      }
    }
    throw err;
  }

  const full = await db.transaction.findUnique({
    where: { id: createdId },
    include: RECEIPT_INCLUDE,
  });
  if (!full) throw ApiError.notFound("Transaction disappeared after commit");

  await audit({
    userId: user.id,
    action: "CHECKOUT",
    entity: "Transaction",
    entityId: full.id,
    meta: {
      ref: full.ref,
      status,
      total: D(grand).toString(),
      amountPaid,
      credit: creditAmount,
      items: body.items.length,
      payments: body.payments.map((p) => p.method),
      vatInclusive: body.vatInclusive,
    },
  });

  return {
    duplicate: false,
    transaction: toTransactionDTO(full),
    receipt: buildReceipt(full),
    ...(riskScore !== undefined ? { riskScore } : {}),
  };
}
