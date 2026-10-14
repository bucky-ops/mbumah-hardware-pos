// GET /api/reports/export — CSV export (public read; branch_intelligence.csv
// default per the console matrix, plus sales|inventory|debt datasets).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function csv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => (typeof c === "string" && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
}

export async function GET(req: NextRequest) {
  try {
    const kind = req.nextUrl.searchParams.get("kind") ?? "branch_intelligence";
    let body: string;
    let filename: string;
    if (kind === "sales") {
      const txns = await db.transaction.findMany({ where: { type: "SALE" }, orderBy: { createdAt: "desc" }, take: 500, include: { branch: { select: { code: true } } } });
      body = csv([["ref", "branch", "subtotal_kes", "vat_kes", "total_kes", "created_at"], ...txns.map((t) => [t.ref, t.branch.code, Number(t.subtotal), Number(t.vatAmount), Number(t.totalAmount), t.createdAt.toISOString()])]);
      filename = "sales_export.csv";
    } else if (kind === "inventory") {
      const products = await db.product.findMany({ where: { deletedAt: null }, include: { branch: { select: { code: true } } } });
      body = csv([["sku", "name", "category", "branch", "stock_qty", "reorder_level", "selling_price_kes"], ...products.map((p) => [p.sku, p.name, p.category, p.branch.code, Number(p.stockQty), Number(p.reorderLevel), Number(p.sellingPrice)])]);
      filename = "inventory_export.csv";
    } else if (kind === "debt") {
      const customers = await db.customer.findMany({ where: { outstanding: { gt: 0 } } });
      body = csv([["customer", "outstanding_kes", "credit_limit_kes", "status", "risk_score"], ...customers.map((c) => [c.name, Number(c.outstanding), Number(c.creditLimit), c.creditStatus, c.riskScore])]);
      filename = "debt_export.csv";
    } else {
      // branch intelligence (console matrix)
      const now = new Date();
      const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
      const weekAgo = new Date(startToday.getTime() - 6 * 86_400_000);
      const twoWeeksAgo = new Date(startToday.getTime() - 13 * 86_400_000);
      const [branches, txns, unpaid, products] = await Promise.all([
        db.branch.findMany({ orderBy: { createdAt: "asc" } }),
        db.transaction.findMany({ where: { type: "SALE", createdAt: { gte: twoWeeksAgo } }, select: { branchId: true, subtotal: true, createdAt: true } }),
        db.invoice.findMany({ where: { status: { in: ["UNPAID", "PARTIAL"] } } }),
        db.product.findMany({ where: { deletedAt: null }, select: { branchId: true, stockQty: true, reorderLevel: true } }),
      ]);
      const rows: (string | number)[][] = [["branch_code", "name", "revenue_today_kes", "variance_pct", "transactions_today", "stock_health_pct", "low_stock", "overdue_rentals", "debt_total_kes", "aging_90plus_kes"]];
      for (const b of branches) {
        const bt = txns.filter((t) => t.branchId === b.id && t.createdAt >= startToday);
        const bw = txns.filter((t) => t.branchId === b.id && t.createdAt >= weekAgo);
        const bp = txns.filter((t) => t.branchId === b.id && t.createdAt >= twoWeeksAgo && t.createdAt < weekAgo);
        const revPrior = bp.reduce((a, t) => a + Number(t.subtotal), 0);
        const bProducts = products.filter((p) => p.branchId === b.id);
        const bLow = bProducts.filter((p) => Number(p.stockQty) <= Number(p.reorderLevel)).length;
        const bDebt = unpaid.filter((i) => i.branchId === b.id).reduce((a, i) => a + Number(i.total) - Number(i.amountPaid), 0);
        const bDebt90 = unpaid.filter((i) => i.branchId === b.id && (now.getTime() - new Date(i.dueDate).getTime()) / 86_400_000 > 60).reduce((a, i) => a + Number(i.total) - Number(i.amountPaid), 0);
        rows.push([
          b.code, b.name,
          Math.round(bt.reduce((a, t) => a + Number(t.subtotal), 0) * 100) / 100,
          revPrior > 0 ? Math.round(((bw.reduce((a, t) => a + Number(t.subtotal), 0) - revPrior) / revPrior) * 1000) / 10 : 0,
          bt.length,
          bProducts.length ? Math.round(100 - (100 * bLow) / bProducts.length) : 100,
          bLow,
          (await db.rental.count({ where: { branchId: b.id, status: "OVERDUE" } })),
          Math.round(bDebt * 100) / 100, Math.round(bDebt90 * 100) / 100,
        ]);
      }
      body = csv(rows);
      filename = "branch_intelligence.csv";
    }
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[reports/export] failed", err);
    return NextResponse.json({ ok: false, error: "Export failed" }, { status: 500 });
  }
}
