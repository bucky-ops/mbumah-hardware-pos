// Expenses.
// GET  /api/expenses        → list (public read)
// POST /api/expenses        → request an expense (auth; status=PENDING)
// PATCH /api/expenses       → approve/reject (MANAGER+; creator cannot self-approve)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser, clientIp } from "@/lib/auth-utils";
import { rateLimit } from "@/lib/auth/rateLimit";
import { audit } from "@/lib/audit";
import { roleAtLeast } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [items, pending] = await Promise.all([
      db.expense.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { branch: { select: { name: true, code: true } } } }),
      db.expense.count({ where: { status: "PENDING" } }),
    ]);
    return NextResponse.json({
      ok: true, pending,
      items: items.map((e) => ({
        id: e.id, branch: e.branch.name, category: e.category, description: e.description,
        amount: Number(e.amount), status: e.status, requestedBy: e.requestedByName,
        approvedBy: e.approvedByName, createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    console.error("[expenses] list failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load expenses" }, { status: 500 });
  }
}

const postSchema = z.object({
  branchId: z.string().min(1),
  category: z.enum(["RENT", "SALARIES", "UTILITIES", "TRANSPORT", "MAINTENANCE", "OTHER"]),
  description: z.string().min(3).max(300),
  amount: z.number().min(1),
  method: z.enum(["CASH", "MPESA", "BANK_TRANSFER"]).default("CASH"),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    const rl = rateLimit(`expenses:${clientIp(req)}`, { limit: 20, windowMs: 60_000 });
    if (!rl.allowed) return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid expense payload" }, { status: 400 });
    const expense = await db.expense.create({
      data: { ...parsed.data, amount: parsed.data.amount.toFixed(2), status: "PENDING", requestedByName: user.name },
    });
    await audit({ userId: user.id, action: "EXPENSE_REQUEST", entity: "Expense", entityId: expense.id, meta: { amount: parsed.data.amount, category: parsed.data.category }, ip: clientIp(req) });
    return NextResponse.json({ ok: true, expense });
  } catch (err) {
    console.error("[expenses] create failed", err);
    return NextResponse.json({ ok: false, error: "Failed to create expense" }, { status: 500 });
  }
}

const patchSchema = z.object({ id: z.string().min(1), decision: z.enum(["APPROVED", "REJECTED"]) });

export async function PATCH(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    if (!roleAtLeast(user.role as never, "MANAGER")) {
      return NextResponse.json({ ok: false, error: "Forbidden: requires MANAGER role" }, { status: 403 });
    }
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    const expense = await db.expense.findUnique({ where: { id: parsed.data.id } });
    if (!expense) return NextResponse.json({ ok: false, error: "Expense not found" }, { status: 404 });
    if (expense.requestedByName === user.name) {
      return NextResponse.json({ ok: false, error: "Segregation of duties: creator cannot approve" }, { status: 403 });
    }
    const updated = await db.expense.update({
      where: { id: expense.id },
      data: { status: parsed.data.decision, approvedByName: user.name, approvedAt: new Date() },
    });
    await audit({ userId: user.id, action: `EXPENSE_${parsed.data.decision}`, entity: "Expense", entityId: expense.id, meta: { amount: Number(expense.amount) }, ip: clientIp(req) });
    return NextResponse.json({ ok: true, expense: updated });
  } catch (err) {
    console.error("[expenses] decide failed", err);
    return NextResponse.json({ ok: false, error: "Failed to decide expense" }, { status: 500 });
  }
}
