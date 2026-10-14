// Receipts.
// GET  /api/receipts     → recent receipts (public read)
// POST /api/receipts     → issue receipt for a transaction (auth; sequential)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth-utils";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const receipts = await db.receipt.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { branch: { select: { name: true, code: true } } },
    });
    return NextResponse.json({
      ok: true,
      items: receipts.map((r) => ({
        id: r.id, number: r.number, branch: r.branch.name, customer: r.customerName ?? "Walk-in",
        total: Number(r.total), smsStatus: r.smsStatus, pdfGenerated: r.pdfGenerated, createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error("[receipts] list failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load receipts" }, { status: 500 });
  }
}

const postSchema = z.object({ transactionId: z.string().min(1), sms: z.boolean().default(false) });

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    const tx = await db.transaction.findUnique({ where: { id: parsed.data.transactionId }, include: { branch: true } });
    if (!tx) return NextResponse.json({ ok: false, error: "Transaction not found" }, { status: 404 });
    const seq = (await db.receipt.count()) + 1;
    const receipt = await db.receipt.create({
      data: {
        branchId: tx.branchId, number: `MBM-R-${String(seq).padStart(4, "0")}`, transactionId: tx.id,
        customerName: "Walk-in", total: tx.totalAmount, smsStatus: parsed.data.sms ? "SIMULATED" : null, pdfGenerated: true,
      },
    });
    await audit({ userId: user.id, action: "RECEIPT_ISSUE", entity: "Receipt", entityId: receipt.id, meta: { number: receipt.number, ref: tx.ref }, ip: req.headers.get("x-forwarded-for") });
    return NextResponse.json({ ok: true, receipt: { id: receipt.id, number: receipt.number, total: Number(receipt.total) } });
  } catch (err) {
    console.error("[receipts] issue failed", err);
    return NextResponse.json({ ok: false, error: "Failed to issue receipt" }, { status: 500 });
  }
}
