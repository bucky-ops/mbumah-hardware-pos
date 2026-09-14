import { NextResponse, type NextRequest } from "next/server";
import type { Prisma, Product as DbProduct } from "@prisma/client";
import { z } from "zod";

import { withErrorHandler } from "@/lib/api-error-handler";
import { assertTargetBranch, requireAuth, requireRole } from "@/lib/api/guard";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { D } from "@/lib/format";
import type { Role } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// /api/products — catalog search + creation.
//
// GET   — any authenticated staff. BOLA-scoped by branch; ?q= searches
//         name/sku/barcode, ?category= exact match, ?lowStock=1 flags items at
//         or below reorder level, ?limit/?offset paginate. CASHIER responses
//         zero out buyingPrice (margin protection — cost is need-to-know).
// POST  — MANAGER+ creates a product with full eTIMS fields; an initial
//         RESTOCK StockAdjustment is recorded when opening stock > 0 so the
//         stock ledger reconciles from day one.
// ─────────────────────────────────────────────────────────────────────────────

function route(handler: (req: NextRequest) => Promise<Response>) {
  return withErrorHandler(async (req: Request) => handler(req as NextRequest));
}

const createProductSchema = z
  .object({
    sku: z.string().trim().min(3, "sku must be at least 3 characters").max(40),
    name: z.string().trim().min(3, "name must be at least 3 characters").max(200),
    category: z.string().trim().min(1, "category is required").max(80),
    unit: z.enum(["PCS", "KG", "M", "FT", "BOX", "LTR"]),
    buyingPrice: z.number().positive("buyingPrice must be greater than 0"),
    sellingPrice: z.number().positive("sellingPrice must be greater than 0"),
    stockQty: z.number().min(0, "stockQty must be non-negative"),
    reorderLevel: z.number().min(0, "reorderLevel must be non-negative"),
    barcode: z.string().trim().max(64).nullable().optional(),
    hsCode: z.string().trim().max(20).nullable().optional(),
    taxCategory: z.enum(["A", "B"]).default("B"), // eTIMS: A=Exempt, B=16% standard
    isTaxExempt: z.boolean().default(false),
    branchId: z.string().min(1, "branchId is required"),
  })
  .superRefine((v, ctx) => {
    if (v.sellingPrice <= v.buyingPrice) {
      ctx.addIssue({
        code: "custom",
        path: ["sellingPrice"],
        message: "sellingPrice must be greater than buyingPrice",
      });
    }
  });

/** Decimal serialization: Prisma Decimals go over the wire as strings. */
function serializeProduct(p: DbProduct, role: Role) {
  return {
    id: p.id,
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    category: p.category,
    unit: p.unit,
    sellingPrice: String(p.sellingPrice ?? 0),
    // Margin protection: cashiers never see the cost price.
    buyingPrice: role === "CASHIER" ? "0" : String(p.buyingPrice ?? 0),
    stockQty: String(p.stockQty ?? 0),
    reorderLevel: String(p.reorderLevel ?? 0),
    hsCode: p.hsCode,
    taxCategory: p.taxCategory,
    isTaxExempt: p.isTaxExempt,
    branchId: p.branchId,
  };
}

// GET /api/products?q=…&category=…&branchId=…&lowStock=1&limit=…&offset=…
export const GET = route(async (req) => {
  const user = await requireAuth(req);

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() || undefined;
  const category = sp.get("category")?.trim() || undefined;
  const queryBranchId = sp.get("branchId");
  const lowStock = sp.get("lowStock") === "1";

  const parsedLimit = Number.parseInt(sp.get("limit") ?? "", 10);
  const limit = Number.isNaN(parsedLimit) ? 500 : Math.min(Math.max(parsedLimit, 1), 5000);
  const parsedOffset = Number.parseInt(sp.get("offset") ?? "", 10);
  const offset = Number.isNaN(parsedOffset) ? 0 : Math.max(parsedOffset, 0);

  // BOLA layer 2: non-OWNERs are fenced to their own branch (a mismatched
  // explicit ?branchId is rejected outright).
  assertTargetBranch(user, queryBranchId);
  const branchId = user.role === "OWNER" ? (queryBranchId ?? undefined) : user.branchId;

  const where: Prisma.ProductWhereInput = {
    ...(branchId ? { branchId } : {}),
    ...(category ? { category } : {}),
    // SQLite LIKE is ASCII-case-insensitive by default → `contains` already
    // behaves as case-insensitive search without Postgres-only `mode`.
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { sku: { contains: q } },
            { barcode: { contains: q } },
          ],
        }
      : {}),
  };

  // Prisma cannot compare two columns of the same row in `where`
  // (stockQty ≤ reorderLevel), and the field-reference API is not portable to
  // SQLite — so the low-stock flag is applied in application code before
  // pagination. POS catalogs are small enough (≤ tens of thousands of SKUs)
  // that fetching the filtered match set is safe.
  const rows = await db.product.findMany({ where, orderBy: { name: "asc" } });
  const filtered = lowStock
    ? rows.filter((p) => D(p.stockQty).lessThanOrEqualTo(D(p.reorderLevel)))
    : rows;

  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit).map((p) => serializeProduct(p, user.role));

  return NextResponse.json({ items, total });
});

// POST /api/products — create (MANAGER+).
export const POST = route(async (req) => {
  const user = await requireRole(req, "MANAGER");

  const parsed = createProductSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw parsed.error;

  const {
    sku,
    barcode,
    name,
    category,
    unit,
    buyingPrice,
    sellingPrice,
    stockQty,
    reorderLevel,
    hsCode,
    taxCategory,
    isTaxExempt,
    branchId,
  } = parsed.data;

  assertTargetBranch(user, branchId);

  const created = await db.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        sku,
        barcode: barcode || null, // normalize "" → NULL (unique column)
        name,
        category,
        unit,
        buyingPrice,
        sellingPrice,
        stockQty,
        reorderLevel,
        hsCode: hsCode || null,
        taxCategory,
        isTaxExempt,
        branchId,
      },
    });
    // Opening stock is journaled as a RESTOCK so the adjustment ledger
    // reconciles exactly with stockQty from the first day.
    if (stockQty > 0) {
      await tx.stockAdjustment.create({
        data: {
          productId: product.id,
          branchId,
          type: "RESTOCK",
          quantity: stockQty,
          unitCost: buyingPrice,
          reason: "Initial stock on product creation",
          reference: sku,
          userId: user.id,
        },
      });
    }
    return product;
  });

  await audit({
    userId: user.id,
    action: "PRODUCT_CREATE",
    entity: "Product",
    entityId: created.id,
    meta: { sku, name, category, branchId },
    ip: clientIp(req),
  });

  return NextResponse.json({ product: serializeProduct(created, user.role) }, { status: 201 });
});
