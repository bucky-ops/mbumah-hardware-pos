// GET /api/debt — mkopo (debt) overview for the Debt Expert module:
// aging buckets, top debtors, payment plans, reminders. Public read (masked).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { RELEASE } from "@/lib/release";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const now = new Date();
    const unpaid = await db.invoice.findMany({ where: { status: { in: ["UNPAID", "PARTIAL"] } } });
    let current = 0, d30 = 0, d60 = 0, d90 = 0;
    for (const inv of unpaid) {
      const bal = Number(inv.total) - Number(inv.amountPaid);
      const days = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86_400_000);
      if (days <= 0) current += bal;
      else if (days <= 30) d30 += bal;
      else if (days <= 60) d60 += bal;
      else d90 += bal;
    }
    const [customers, plans, reminders] = await Promise.all([
      db.customer.findMany({
        where: { outstanding: { gt: 0 } },
        orderBy: { outstanding: "desc" },
        select: { id: true, name: true, outstanding: true, creditLimit: true, creditStatus: true, riskScore: true, branchId: true },
      }),
      db.debtPlan.findMany({ include: { installments: true, creditAccount: { select: { customer: { select: { name: true } } } } } }),
      db.paymentReminder.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { customer: { select: { name: true } } } }),
    ]);
    return NextResponse.json({
      ok: true,
      aging: { current, d30, d60, d90plus: d90 },
      total: current + d30 + d60 + d90,
      customers: customers.map((c) => ({
        id: c.id, name: c.name, outstanding: Number(c.outstanding), creditLimit: Number(c.creditLimit),
        creditStatus: c.creditStatus, riskScore: c.riskScore,
      })),
      plans: plans.map((p) => ({
        id: p.id, customer: p.creditAccount?.customer?.name ?? "—", totalAmount: Number(p.totalAmount),
        balanceRemaining: Number(p.balanceRemaining), status: p.status,
        installments: p.installments.length, paid: p.installments.filter((i) => i.status === "PAID").length,
      })),
      reminders: reminders.map((r) => ({ id: r.id, customer: r.customer.name, channel: r.channel, status: r.status, sentAt: r.sentAt })),
      release: RELEASE.version,
    });
  } catch (err) {
    console.error("[debt] failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load debt overview" }, { status: 500 });
  }
}
