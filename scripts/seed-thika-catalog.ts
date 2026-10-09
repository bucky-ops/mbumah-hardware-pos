// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — v2.13.3 THIKA BRANCH CATALOG SEED (idempotent)
// ─────────────────────────────────────────────────────────────────────────────
//
// Ensures the Thika (THI) branch carries the v2.13.3 spec grid: 11 products
// with EXACT names / prices / stock, plus the rental Concrete Mixer and the
// Chain Link roll used by the demo cart.
//
// SAFE TO RE-RUN: matches by product NAME inside the branch — existing items
// are corrected (price/stock/category/unit), missing items are created.
// Stock deltas go through StockMovement (full audit trail), never raw writes.
//
// OWNER RUN (laptop kit / sandbox):
//   DATABASE_URL="postgres://…" bun run scripts/seed-thika-catalog.ts
//
// Env: DATABASE_URL (Neon pooled URL) — same one Vercel uses.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const THIKA_STORE_ID = 'store_thika';

/** money → cost assumption for seed rows (owner can correct in Catalog UI) */
const COST_RATIO = 0.75;

interface SeedItem {
  name: string;
  category: string;
  price: number;
  stock: number;
  unit: 'PIECE' | 'KILOGRAM' | 'BAG';
  unitShort: string;
  reorder: number;
  isRental?: boolean;
}

const SEED_ITEMS: SeedItem[] = [
  { name: '4-inch Nails', category: 'Nails & Screws', price: 150, stock: 350, unit: 'KILOGRAM', unitShort: 'kg', reorder: 50 },
  { name: 'Bamburi Cement 50kg', category: 'Cement', price: 750, stock: 180, unit: 'BAG', unitShort: 'bags', reorder: 30 },
  { name: 'Dulux Weathershield 20L', category: 'Paints', price: 8500, stock: 20, unit: 'PIECE', unitShort: 'pcs', reorder: 5 },
  { name: 'Mabati 28-Gauge (8ft)', category: 'Iron Sheets', price: 800, stock: 200, unit: 'PIECE', unitShort: 'pcs', reorder: 40 },
  { name: 'Mabati 30-Gauge (8ft)', category: 'Iron Sheets', price: 650, stock: 350, unit: 'PIECE', unitShort: 'pcs', reorder: 60 },
  { name: 'Plywood 8x4ft (18mm)', category: 'Timber & Wood', price: 2800, stock: 45, unit: 'PIECE', unitShort: 'pcs', reorder: 10 },
  { name: 'PVC Pipe 4-inch x 3m', category: 'Plumbing', price: 800, stock: 90, unit: 'PIECE', unitShort: 'pcs', reorder: 20 },
  { name: 'Rebar 12mm x 12m', category: 'Iron Bars', price: 1200, stock: 280, unit: 'PIECE', unitShort: 'pcs', reorder: 50 },
  { name: 'Simba Cement 50kg', category: 'Cement', price: 720, stock: 120, unit: 'BAG', unitShort: 'bags', reorder: 25 },
  { name: 'Spade (Heavy Duty)', category: 'Tools', price: 1200, stock: 40, unit: 'PIECE', unitShort: 'pcs', reorder: 8 },
  { name: 'Timber 2x4 x 12ft (Cypress)', category: 'Timber & Wood', price: 800, stock: 60, unit: 'PIECE', unitShort: 'pcs', reorder: 15 },
  // Demo-cart items (spec: rental item + chain link roll must be sellable in Thika)
  { name: 'Concrete Mixer', category: 'Tools', price: 85000, stock: 2, unit: 'PIECE', unitShort: 'pcs', reorder: 1, isRental: true },
  { name: 'Chain Link 6ft x 50m', category: 'Fencing', price: 4500, stock: 25, unit: 'PIECE', unitShort: 'rolls', reorder: 5 },
];

const CATEGORY_COLORS: Record<string, string> = {
  'Nails & Screws': '#b45309',
  'Cement': '#64748b',
  'Paints': '#0d9488',
  'Iron Sheets': '#475569',
  'Timber & Wood': '#92400e',
  'Plumbing': '#0891b2',
  'Iron Bars': '#334155',
  'Tools': '#c2410c',
  'Fencing': '#15803d',
};

function skuFor(name: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  return `THI-${slug}`;
}

async function main() {
  const store = await prisma.store.findUnique({ where: { id: THIKA_STORE_ID } });
  if (!store) throw new Error(`Store ${THIKA_STORE_ID} not found — run prisma seed first.`);

  // 1. Ensure categories exist
  const existingCats = await prisma.productCategory.findMany({ where: { storeId: THIKA_STORE_ID } });
  const catByName = new Map(existingCats.map((c) => [c.name.toLowerCase(), c]));
  for (const item of SEED_ITEMS) {
    const key = item.category.toLowerCase();
    if (!catByName.has(key)) {
      const created = await prisma.productCategory.create({
        data: {
          storeId: THIKA_STORE_ID,
          name: item.category,
          color: CATEGORY_COLORS[item.category] || '#64748b',
          sortOrder: 99,
        },
      });
      catByName.set(key, created);
      console.log(`  + category "${item.category}"`);
    }
  }

  // 2. Upsert products
  const existingProducts = await prisma.product.findMany({
    where: { storeId: THIKA_STORE_ID },
    select: { id: true, name: true, pricePerUnit: true, quantityInStock: true, categoryId: true, unitType: true, isRental: true },
  });
  const prodByName = new Map(existingProducts.map((p) => [p.name.trim().toLowerCase(), p]));

  let created = 0;
  let updated = 0;
  let untouched = 0;

  for (const item of SEED_ITEMS) {
    const cat = catByName.get(item.category.toLowerCase())!;
    const match = prodByName.get(item.name.trim().toLowerCase());

    if (!match) {
      await prisma.product.create({
        data: {
          storeId: THIKA_STORE_ID,
          categoryId: cat.id,
          sku: skuFor(item.name),
          name: item.name,
          unitType: item.unit,
          quantityInStock: item.stock,
          reorderLevel: item.reorder,
          pricePerUnit: item.price,
          costPrice: Math.round(item.price * COST_RATIO),
          taxRate: 16,
          isRental: item.isRental ?? false,
          isActive: true,
          minimumStockLevel: 0,
        },
      });
      console.log(`  + product "${item.name}" @ ${item.price} x${item.stock}`);
      created += 1;
      continue;
    }

    // Correct drift on existing rows
    const price = Number(match.pricePerUnit);
    const stock = Number(match.quantityInStock);
    const needsPrice = Math.abs(price - item.price) > 0.001;
    const needsCat = match.categoryId !== cat.id;
    const needsRental = item.isRental !== undefined && match.isRental !== item.isRental;

    if (needsPrice || needsCat || needsRental) {
      await prisma.product.update({
        where: { id: match.id },
        data: {
          ...(needsPrice ? { pricePerUnit: item.price } : {}),
          ...(needsCat ? { categoryId: cat.id } : {}),
          ...(needsRental ? { isRental: item.isRental } : {}),
        },
      });
      console.log(`  ~ product "${item.name}" corrected (price ${price}→${item.price}${needsCat ? ', category' : ''}${needsRental ? ', rental flag' : ''})`);
      updated += 1;
    }

    if (Math.abs(stock - item.stock) > 0.001) {
      const delta = item.stock - stock;
      await prisma.$transaction([
        prisma.stockMovement.create({
          data: {
            productId: match.id,
            storeId: THIKA_STORE_ID,
            movementType: delta > 0 ? 'PURCHASE' : 'ADJUSTMENT',
            quantity: delta,
            notes: 'v2.13.3 Thika catalog seed — stock alignment',
            // PURCHASE movements require a non-negative unitCost (WAC recompute)
            ...(delta > 0 ? { unitCost: Math.round(item.price * COST_RATIO * 100) / 100 } : {}),
          },
        }),
        prisma.product.update({ where: { id: match.id }, data: { quantityInStock: item.stock } }),
      ]);
      console.log(`  ~ stock "${item.name}" ${stock} → ${item.stock} (${delta > 0 ? '+' : ''}${delta}, movement logged)`);
      updated += 1;
    }

    if (!needsPrice && !needsCat && !needsRental && Math.abs(stock - item.stock) <= 0.001) untouched += 1;
  }

  console.log(`\nTHIKA SEED DONE — created:${created} corrected:${updated} already-exact:${untouched}`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
