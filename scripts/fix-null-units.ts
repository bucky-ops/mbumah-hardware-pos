import { PrismaClient } from '@prisma/client';

// v2.12.1 HOTFIX - owner-run data fix: NULL unitType backfill
// Bug: a batch of products (e.g. Bamburi Cement) was saved with a NULL
// `unitType`, so the POS rendered a dangling "per " on the product card and
// empty/"null" unit badges in the cart, catalog and inventory. The UI now
// falls back safely (src/lib/units.ts), but the data should be corrected at
// the source too.
//
// What it does (idempotent - only touches rows WHERE unitType IS NULL):
//   • name contains "bamburi" OR the product sits in a cement/concrete
//     category                        → unitType = 'BAG'
//   • every other NULL-unit product    → unitType = 'PIECE'
//
// Run from the repo root:
//   DATABASE_URL="postgres://…" npx tsx scripts/fix-null-units.ts
//   (add --dry-run to preview without writing)

// AUDIT FIX (Finding 1.2 - no hardcoded developer path):
// The datasource URL resolves from the environment (DATABASE_URL), with a
// portable repo-relative fallback for local SQLite use.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL || 'file:./db/custom.db' } },
});

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function main() {
  console.log(`Scanning for products with NULL unitType${DRY_RUN ? ' (DRY RUN - nothing will be written)' : ''}…`);

  // `unitType` is schema-required, so NULL rows (legacy/raw inserts) are found
  // via raw SQL - works identically on Postgres (prod) and SQLite (local).
  const nullUnitProducts = await prisma.$queryRaw<Array<{ id: string; name: string; sku: string; categoryId: string | null }>>`
    SELECT id, name, sku, "categoryId"
    FROM "Product"
    WHERE "unitType" IS NULL`;

  if (nullUnitProducts.length === 0) {
    console.log('No products with NULL unitType found - nothing to do.');
    return;
  }
  console.log(`Found ${nullUnitProducts.length} product(s) with NULL unitType.`);

  // Cement/concrete category ids (matched case-insensitively in JS so this
  // stays provider-agnostic - Postgres `contains` is case-sensitive).
  const categories = await prisma.productCategory.findMany({ select: { id: true, name: true } });
  const cementCategoryIds = new Set(
    categories.filter((c) => /cement|concrete/i.test(c.name)).map((c) => c.id),
  );

  let bags = 0;
  let pieces = 0;
  for (const p of nullUnitProducts) {
    const isCement = /bamburi/i.test(p.name)
      || (p.categoryId != null && cementCategoryIds.has(p.categoryId));
    const unit = isCement ? 'BAG' : 'PIECE';
    if (isCement) bags++; else pieces++;
    console.log(`  ${p.sku || p.id} - "${p.name}" → ${unit}`);
    if (!DRY_RUN) {
      await prisma.product.update({ where: { id: p.id }, data: { unitType: unit } });
    }
  }

  console.log(`Done: ${bags} → BAG (cement), ${pieces} → PIECE${DRY_RUN ? ' (dry run - no rows written)' : ''}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
