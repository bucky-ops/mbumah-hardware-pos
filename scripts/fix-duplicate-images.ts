import { PrismaClient } from '@prisma/client';

// v2.12.1 HOTFIX - owner-run data fix: duplicate nail product images
// Bug: several nail products were seeded with the SAME imageUrl, so the POS
// grid showed the identical photo on every nail row. Clearing `imageUrl`
// makes those cards fall back to the category image instead.
//
// What it does (idempotent):
//   • collects every product whose name matches /nail/i;
//   • groups them by size variant (first "2-inch / 50mm / 3"" style size
//     token found in the name; 'no-size' when none);
//   • keeps ONE canonical row per group (earliest row that actually has an
//     image, else the earliest row) and NULLs `imageUrl` on the rest.
//
// Run from the repo root:
//   DATABASE_URL="postgres://…" npx tsx scripts/fix-duplicate-images.ts
//   (add --dry-run to preview without writing)

// AUDIT FIX (Finding 1.2 - no hardcoded developer path):
// The datasource URL resolves from the environment (DATABASE_URL), with a
// portable repo-relative fallback for local SQLite use.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL || 'file:./db/custom.db' } },
});

const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

/** "2-inch Nails" → "2inch"; "Wire Nails 50mm" → "50mm"; none → "no-size". */
function sizeKeyOf(name: string): string {
  const m = name.match(/(\d+(?:[./]\d+)?)\s*(?:"|”|''|inch|inches|mm|cm|kg|g|m)\b/i);
  return m ? `${m[1]}${m[2]}`.toLowerCase().replace(/\s+/g, '') : 'no-size';
}

async function main() {
  console.log(`Scanning nail products for duplicate images${DRY_RUN ? ' (DRY RUN - nothing will be written)' : ''}…`);

  const products = await prisma.product.findMany({
    select: { id: true, name: true, sku: true, imageUrl: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const nails = products.filter((p) => /nail/i.test(p.name));

  if (nails.length === 0) {
    console.log('No nail products found - nothing to do.');
    return;
  }

  // Group by size variant, preserving the createdAt-asc order.
  const groups = new Map<string, typeof nails>();
  for (const p of nails) {
    const key = sizeKeyOf(p.name);
    const rows = groups.get(key) ?? [];
    rows.push(p);
    groups.set(key, rows);
  }

  let cleared = 0;
  for (const [key, rows] of groups) {
    const canonical = rows.find((r) => r.imageUrl) ?? rows[0];
    const duplicates = rows.filter((r) => r.id !== canonical.id && r.imageUrl);
    console.log(`Group "${key}": ${rows.length} nail product(s) - keeping image on "${canonical.name}" (${canonical.sku || canonical.id})`);
    for (const d of duplicates) {
      cleared++;
      console.log(`  clearing imageUrl on "${d.name}" (${d.sku || d.id})`);
      if (!DRY_RUN) {
        await prisma.product.update({ where: { id: d.id }, data: { imageUrl: null } });
      }
    }
  }

  console.log(`Done: ${cleared} duplicate image(s) cleared${DRY_RUN ? ' (dry run - no rows written)' : ''}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
