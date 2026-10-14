// Transactions (sales).
// GET  /api/transactions → recent sales w/ filters (public read, masked customer)
// POST /api/transactions → checkout (auth; idempotencyKey @unique; low-stock
//                          guard; creates payment + double-entry journal)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser, clientIp } from "@/lib/auth-utils";
import { rateLimit } from "@/lib/auth/rateLimit";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const branchId = sp.get("branchId");
    const take = Math.min(Number(sp.get("take") ?? 30), 100);
    const txns = await db.transaction.findMany({
      where: { type: "SALE", ...(branchId ? { branchId } : {}) },
      orderBy: { createdAt: "desc" },
      take,
      include: {
        user: { select: { name: true } },
        customer: { select: { name: true } },
        branch: { select: { name: true, code: true } },
        payments: { select: { method: true, amount: true } },
        _count: { select: { items: true } },
      },
    });
    return NextResponse.json({
      ok: true,
      items: txns.map((t) => ({
        id: t.id, ref: t.ref, branch: t.branch.name, cashier: t.user.name,
        customer: t.customer?.name ?? "Walk-in", items: t._count.items,
        subtotal: Number(t.subtotal), vat: Number(t.vatAmount), total: Number(t.totalAmount),
        methods: t.payments.map((p) => p.method), status: t.status, createdAt: t.createdAt,
      })),
    });
  } catch (err) {
    console.error("[transactions] list failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load transactions" }, { status: 500 });
  }
}

const checkoutSchema = z.object({
  branchId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(64).optional(),
  customerId: z.string().nullish(),
  vatInclusive: z.boolean().default(false),
  method: z.enum(["CASH", "MPESA", "BANK_TRANSFER"]),
  lines: z.array(z.object({ productId: z.string().min(1), qty: z.number().positive() })).min(1).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    const rl = rateLimit(`checkout:${clientIp(req)}`, { limit: 60, windowMs: 60_000 });
    if (!rl.allowed) return NextResponse.json({ ok: false, error: "Too many checkouts" }, { status: 429 });
    const parsed = checkoutSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid checkout payload" }, { status: 400 });
    const d = parsed.data;

    if (d.idempotencyKey) {
      const dupe = await db.transaction.findUnique({ where: { idempotencyKey: d.idempotencyKey } });
      if (dupe) return NextResponse.json({ ok: true, transaction: { id: dupe.id, ref: dupe.ref }, idempotentReplay: true });
    }

    const products = await db.product.findMany({ where: { id: { in: d.lines.map((l) => l.productId) } } });
    const byId = new Map(products.map((p) => [p.id, p]));
    let subtotal = 0;
    for (const line of d.lines) {
      const p = byId.get(line.productId);
      if (!p) return NextResponse.json({ ok: false, error: `Unknown product ${line.productId}` }, { status: 400 });
      if (Number(p.stockQty) < line.qty) {
        return NextResponse.json({ ok: false, error: `Low stock blocks checkout: ${p.name} has ${Number(p.stockQty)} ${p.unit}` }, { status: 400 });
      }
      subtotal += Number(p.sellingPrice) * line.qty;
    }
    subtotal = Math.round(subtotal * 100) / 100;
    const vat = d.vatInclusive ? Math.round((subtotal - subtotal / 1.16) * 100) / 100 : Math.round(subtotal * 0.16 * 100) / 100;
    const total = d.vatInclusive ? subtotal : Math.round((subtotal + vat) * 100) / 100;

    const ref = `MBM-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String((await db.transaction.count()) + 1).padStart(4, "0")}`;
    const tx = await db.transaction.create({
      data: {
        ref, type: "SALE", status: "COMPLETED", branchId: d.branchId, userId: user.id,
        customerId: d.customerId ?? null, subtotal: subtotal.toFixed(2), vatAmount: vat.toFixed(2),
        totalAmount: total.toFixed(2), amountPaid: total.toFixed(2), balanceDue: "0",
        vatInclusive: d.vatInclusive, idempotencyKey: d.idempotencyKey ?? null,
        items: {
          create: d.lines.map((line) => {
            const p = byId.get(line.productId)!;
            const lineNet = Math.round(Number(p.sellingPrice) * line.qty * 100) / 100;
            return {
              productId: p.id, description: p.name, uom: p.unit, qty: line.qty.toFixed(3),
              unitPrice: Number(p.sellingPrice).toFixed(2), lineNet: lineNet.toFixed(2),
              vatAmount: (d.vatInclusive ? lineNet - lineNet / 1.16 : lineNet * 0.16).toFixed(2),
              lineTotal: (d.vatInclusive ? lineNet : lineNet * 1.16).toFixed(2),
              taxCategory: p.taxCategory, unitCost: Number(p.buyingPrice).toFixed(2),
            };
          }),
        },
        payments: { create: { branchId: d.branchId, method: d.method, amount: total.toFixed(2), receivedByName: user.name } },
      },
    });
    for (const line of d.lines) {
      const p = byId.get(line.productId)!;
      const newQty = Math.round((Number(p.stockQty) - line.qty) * 1000) / 1000;
      await db.product.update({ where: { id: p.id }, data: { stockQty: newQty.toFixed(3) } });
      await db.stockMovement.create({ data: { branchId: d.branchId, productId: p.id, type: "SALE", qty: (-line.qty).toFixed(3), balanceAfter: newQty.toFixed(3), reason: `Sale ${ref}`, userId: user.id, userName: user.name } });
    }
    const je = await db.journalEntry.create({ data: { branchId: d.branchId, date: new Date(), memo: `Sale ${ref}`, refType: "TRANSACTION", refId: tx.id } });
    await db.journalLine.createMany({
      data: [
        { entryId: je.id, account: d.method === "MPESA" ? "1100 M-Pesa Receivable" : d.method === "BANK_TRANSFER" ? "1010 Bank" : "1000 Cash", debit: total.toFixed(2), credit: "0" },
        { entryId: je.id, account: "4000 Sales Revenue", debit: "0", credit: subtotal.toFixed(2) },
        { entryId: je.id, account: "2100 VAT Payable 16%", debit: "0", credit: vat.toFixed(2) },
      ],
    });
    await audit({ userId: user.id, action: "CREATE", entity: "Transaction", entityId: tx.id, meta: { ref, total }, ip: clientIp(req) });
    return NextResponse.json({ ok: true, transaction: { id: tx.id, ref, subtotal, vat, total } });
  } catch (err) {
    console.error("[transactions] checkout failed", err);
    return NextResponse.json({ ok: false, error: "Checkout failed" }, { status: 500 });
  }
}
