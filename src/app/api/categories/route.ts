// GET /api/categories — catalog categories (public read; console + POS).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [categories, grouped] = await Promise.all([
      db.category.findMany({ orderBy: { sortOrder: "asc" } }),
      db.product.groupBy({ by: ["category"], _count: true, where: { deletedAt: null } }),
    ]);
    const counts = new Map(grouped.map((g) => [g.category, g._count]));
    return NextResponse.json({
      ok: true,
      items: categories.map((c) => ({ id: c.id, name: c.name, description: c.description, icon: c.icon, skus: counts.get(c.name) ?? 0 })),
    });
  } catch (err) {
    console.error("[categories] failed", err);
    return NextResponse.json({ ok: false, error: "Failed to load categories" }, { status: 500 });
  }
}
