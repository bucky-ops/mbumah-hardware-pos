// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Guarded Demo-Data Top-Up
// ─────────────────────────────────────────────────────────────────────────────
// Fills ONLY the entities that are missing when the production database was
// seeded by an older seed.ts version (which left branch sales, purchase
// orders, equipment rentals, gift cards, suppliers and chart-of-accounts
// incomplete). Additive-only: no UPDATE, no DELETE, no schema changes.
//
// Every insert is guarded:
//   • existence check on a natural/hardcoded key (receiptNumber, poNumber, id…)
//   • FK pre-verification — referenced rows must exist or the field is nulled
//     and the omission is logged (walk-in semantics for customers)
//   • per-entity try/catch so one failure never aborts the run
//
// Usage:
//   DRY RUN (default):  DATABASE_URL=<direct-neon-url> bun scripts/topup-demo-data.ts
//   APPLY:              APPLY=1 DATABASE_URL=<direct-neon-url> bun scripts/topup-demo-data.ts
//
// Recommended against the DIRECT (non-pooler) Neon endpoint for transactional
// throughput. Connection string must never be committed.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.env.APPLY === '1';

const created: string[] = [];
const skipped: string[] = [];
const failed: { item: string; err: string }[] = [];

// ── date helpers (mirror prisma/seed.ts exactly) ────────────────────────────
function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}
function daysAgoAtHour(n: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, Math.floor(Math.random() * 50) + 5, Math.floor(Math.random() * 60), 0);
  return d;
}
function poDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function main() {
  console.log(`\n=== MBUMAH demo-data top-up — mode: ${APPLY ? '🟢 APPLY' : '🟡 DRY RUN'} ===\n`);

  // ── before counts ─────────────────────────────────────────────────────────
  const before = await snapshot();

  // ── reference data ────────────────────────────────────────────────────────
  const store = await prisma.store.findUnique({ where: { id: 'store_juja_main' } });
  const storeThika = await prisma.store.findUnique({ where: { id: 'store_thika' } });
  const storeRuiru = await prisma.store.findUnique({ where: { id: 'store_ruiru' } });
  const storeNairobiCbd = await prisma.store.findUnique({ where: { id: 'store_nairobi_cbd' } });
  const storeNakuru = await prisma.store.findUnique({ where: { id: 'store_nakuru' } });
  if (!store || !storeThika || !storeRuiru || !storeNairobiCbd || !storeNakuru) {
    throw new Error('Expected 5 canonical stores missing — aborting (unknown DB state).');
  }
  const org = await prisma.organization.findFirst();
  if (!org) throw new Error('No organization found — aborting.');

  const userIds = new Set((await prisma.user.findMany({ select: { id: true } })).map(u => u.id));
  const productIds = new Set((await prisma.product.findMany({ select: { id: true } })).map(p => p.id));
  const customerIds = new Set((await prisma.customer.findMany({ select: { id: true } })).map(c => c.id));
  const accountCodes = new Set(
    (await prisma.account.findMany({ where: { organizationId: org.id }, select: { code: true } })).map(a => a.code),
  );

  const userOrUndefined = (id: string | null | undefined) =>
    id && userIds.has(id) ? id : null;
  const custOrNull = (id: string | null | undefined) =>
    id && customerIds.has(id) ? id : null;

  // ── 1. SUPPLIERS (11 — Juja 3 + 8 branch) ─────────────────────────────────
  const suppliers = [
    { id: 'sup_juja_bamburi', storeId: store.id, name: 'Bamburi Cement Ltd', email: 'orders@bamburi.co.ke', phone: '0207654321', address: 'Mombasa Road, Nairobi', city: 'Nairobi', contactPerson: 'James Mwangi', taxPin: 'P058765432B', paymentTerms: 'NET_30', rating: 5, notes: 'Primary cement supplier' },
    { id: 'sup_juja_mabati', storeId: store.id, name: 'Mabati Rolling Mills', email: 'sales@mabati.co.ke', phone: '0207654322', address: 'Industrial Area, Nairobi', city: 'Nairobi', contactPerson: 'Ahmed Yusuf', taxPin: 'P058765433C', paymentTerms: 'NET_30', rating: 4, notes: 'Iron sheets and roofing supplier' },
    { id: 'sup_juja_dulux', storeId: store.id, name: 'AkzoNobel Kenya (Dulux)', email: 'orders@akzonobel.co.ke', phone: '0207654323', address: 'Likoni Road, Nairobi', city: 'Nairobi', contactPerson: 'Priti Sharma', taxPin: 'P058765434D', paymentTerms: 'NET_15', rating: 4 },
    { id: 'sup_thk_cement', storeId: storeThika.id, name: 'Simba Cement (National)', email: 'supply@simbacement.co.ke', phone: '0207654324', address: 'Thika Road, Nairobi', city: 'Nairobi', contactPerson: 'Francis Karanja', taxPin: 'P058765435E', paymentTerms: 'NET_30', rating: 4 },
    { id: 'sup_thk_timber', storeId: storeThika.id, name: 'Mount Kenya Timber', email: 'sales@mtkenyatimber.co.ke', phone: '0207654325', address: 'Thika Town', city: 'Thika', contactPerson: 'Ndirangu Gicheha', taxPin: 'P058765436F', paymentTerms: 'IMMEDIATE', rating: 3, notes: 'Local timber supplier' },
    { id: 'sup_ruiru_hardware', storeId: storeRuiru.id, name: 'Ruiru Hardware Wholesalers', email: 'wholesale@ruiruhw.co.ke', phone: '0207654326', address: 'Ruiru Town', city: 'Ruiru', contactPerson: 'Muthoni Kamau', taxPin: 'P058765437G', paymentTerms: 'NET_15', rating: 3 },
    { id: 'sup_ruiru_rebar', storeId: storeRuiru.id, name: 'Devki Steel Mills', email: 'orders@devki.co.ke', phone: '0207654327', address: 'Ruiru Industrial Area', city: 'Ruiru', contactPerson: 'Narendra Raval', taxPin: 'P058765438H', paymentTerms: 'NET_30', rating: 5, notes: 'Steel and rebar supplier' },
    { id: 'sup_nbi_crown', storeId: storeNairobiCbd.id, name: 'Crown Paints Kenya', email: 'orders@crownpaints.co.ke', phone: '0207654328', address: 'Industrial Area, Nairobi', city: 'Nairobi', contactPerson: 'Wangari Ndirangu', taxPin: 'P058765439I', paymentTerms: 'NET_30', rating: 4 },
    { id: 'sup_nbi_safety', storeId: storeNairobiCbd.id, name: 'Safety Kenya Ltd', email: 'supply@safetykenya.co.ke', phone: '0207654329', address: 'Enterprise Road, Nairobi', city: 'Nairobi', contactPerson: 'Thomas Ochieng', taxPin: 'P058765430J', paymentTerms: 'NET_15', rating: 4, notes: 'PPE and safety equipment' },
    { id: 'sup_nkr_cement', storeId: storeNakuru.id, name: 'Bamburi Cement (Nakuru Depot)', email: 'nakuru@bamburi.co.ke', phone: '0207654330', address: 'Nakuru Industrial Area', city: 'Nakuru', contactPerson: 'Kiprono Bett', taxPin: 'P058765431K', paymentTerms: 'NET_30', rating: 5 },
    { id: 'sup_nkr_tanks', storeId: storeNakuru.id, name: 'Kentank Nakuru', email: 'sales@kentank.co.ke', phone: '0207654331', address: 'Nakuru Town', city: 'Nakuru', contactPerson: 'Rachel Tanui', taxPin: 'P058765432L', paymentTerms: 'NET_30', rating: 4, notes: 'Water tanks supplier' },
  ];
  for (const s of suppliers) {
    if (await prisma.supplier.findUnique({ where: { id: s.id } })) { skipped.push(`supplier:${s.id}`); continue; }
    try {
      if (APPLY) await prisma.supplier.create({ data: s });
      created.push(`supplier:${s.id}`);
    } catch (e) { failed.push({ item: `supplier:${s.id}`, err: String(e).slice(0, 160) }); }
  }

  // ── 2. CHART OF ACCOUNTS (missing codes only) ─────────────────────────────
  const accounts = [
    { code: '1400', name: 'Rental Deposits Held', type: 'ASSET', subType: 'CURRENT_ASSET', normalBalance: 'DEBIT' },
    { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { code: '2200', name: 'Customer Deposits', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { code: '2310', name: 'Mabati Rolling Mills - Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { code: '2320', name: 'AkzoNobel (Dulux) - Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { code: '2330', name: 'Simba Cement - Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { code: '2340', name: 'Devki Steel Mills - Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { code: '2350', name: 'Crown Paints - Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { code: '2360', name: 'General Supplier Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { code: '2400', name: 'Gift Cards Outstanding', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { code: '3000', name: 'Owner Equity', type: 'EQUITY', subType: 'OWNERS_EQUITY', normalBalance: 'CREDIT' },
    { code: '3100', name: 'Retained Earnings', type: 'EQUITY', subType: 'RETAINED_EARNINGS', normalBalance: 'CREDIT' },
    { code: '4100', name: 'Rental Revenue', type: 'REVENUE', subType: 'OPERATING_REVENUE', normalBalance: 'CREDIT' },
    { code: '4200', name: 'Late Fee Revenue', type: 'REVENUE', subType: 'OTHER_REVENUE', normalBalance: 'CREDIT' },
    { code: '5100', name: 'Rent Expense', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT' },
    { code: '5300', name: 'Utilities Expense', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT' },
    { code: '5400', name: 'Bad Debt Expense', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT' },
  ];
  for (const a of accounts) {
    if (accountCodes.has(a.code)) { skipped.push(`account:${a.code}`); continue; }
    try {
      if (APPLY) await prisma.account.create({ data: { organizationId: org.id, ...a } });
      created.push(`account:${a.code}`);
    } catch (e) { failed.push({ item: `account:${a.code}`, err: String(e).slice(0, 160) }); }
  }

  // ── 2b. BRANCH CATEGORIES (Nairobi 8 + Nakuru 8) ───────────────────────────
  const branchCategories = [
    { id: 'cat_nbi_cement', storeId: storeNairobiCbd.id, name: 'Cement', description: 'All types of cement', icon: 'building', color: '#8B7355', sortOrder: 1 },
    { id: 'cat_nbi_iron_sheets', storeId: storeNairobiCbd.id, name: 'Iron Sheets', description: 'Roofing iron sheets', icon: 'layout-grid', color: '#4A5568', sortOrder: 2 },
    { id: 'cat_nbi_paints', storeId: storeNairobiCbd.id, name: 'Paints', description: 'Interior and exterior paints', icon: 'palette', color: '#E53E3E', sortOrder: 3 },
    { id: 'cat_nbi_iron_bars', storeId: storeNairobiCbd.id, name: 'Iron Bars', description: 'Reinforcement iron bars', icon: 'minus', color: '#718096', sortOrder: 4 },
    { id: 'cat_nbi_tools', storeId: storeNairobiCbd.id, name: 'Tools', description: 'Construction tools and equipment', icon: 'wrench', color: '#2D3748', sortOrder: 5 },
    { id: 'cat_nbi_plumbing', storeId: storeNairobiCbd.id, name: 'Plumbing', description: 'Pipes, fittings, and plumbing supplies', icon: 'droplets', color: '#3182CE', sortOrder: 6 },
    { id: 'cat_nbi_nails_screws', storeId: storeNairobiCbd.id, name: 'Nails & Screws', description: 'Fasteners, nails, and screws', icon: 'pin', color: '#38A169', sortOrder: 7 },
    { id: 'cat_nbi_safety', storeId: storeNairobiCbd.id, name: 'Safety Equipment', description: 'PPE, helmets, boots, and safety gear', icon: 'shield', color: '#E53E3E', sortOrder: 8 },
    { id: 'cat_nkr_cement', storeId: storeNakuru.id, name: 'Cement', description: 'All types of cement', icon: 'building', color: '#8B7355', sortOrder: 1 },
    { id: 'cat_nkr_iron_sheets', storeId: storeNakuru.id, name: 'Iron Sheets', description: 'Roofing iron sheets', icon: 'layout-grid', color: '#4A5568', sortOrder: 2 },
    { id: 'cat_nkr_paints', storeId: storeNakuru.id, name: 'Paints', description: 'Interior and exterior paints', icon: 'palette', color: '#E53E3E', sortOrder: 3 },
    { id: 'cat_nkr_iron_bars', storeId: storeNakuru.id, name: 'Iron Bars', description: 'Reinforcement iron bars', icon: 'minus', color: '#718096', sortOrder: 4 },
    { id: 'cat_nkr_tools', storeId: storeNakuru.id, name: 'Tools', description: 'Construction tools and equipment', icon: 'wrench', color: '#2D3748', sortOrder: 5 },
    { id: 'cat_nkr_plumbing', storeId: storeNakuru.id, name: 'Plumbing', description: 'Pipes, fittings, and plumbing supplies', icon: 'droplets', color: '#3182CE', sortOrder: 6 },
    { id: 'cat_nkr_nails_screws', storeId: storeNakuru.id, name: 'Nails & Screws', description: 'Fasteners, nails, and screws', icon: 'pin', color: '#38A169', sortOrder: 7 },
    { id: 'cat_nkr_water_tanks', storeId: storeNakuru.id, name: 'Water Tanks', description: 'Water storage tanks and accessories', icon: 'container', color: '#2B6CB0', sortOrder: 8 },
  ];
  const categoryIds = new Set((await prisma.productCategory.findMany({ select: { id: true } })).map(c => c.id));
  for (const c of branchCategories) {
    if (categoryIds.has(c.id)) { skipped.push(`category:${c.id}`); continue; }
    try {
      if (APPLY) await prisma.productCategory.create({ data: c });
      categoryIds.add(c.id);
      created.push(`category:${c.id}`);
    } catch (e) { failed.push({ item: `category:${c.id}`, err: String(e).slice(0, 160) }); }
  }

  // ── 2c. BRANCH PRODUCTS (Nairobi 11 + Nakuru 11) ───────────────────────────
  const branchProducts = [
    { id: 'prod_nbi_cement_bamburi', sku: 'NBI-CEM-0001', name: 'Bamburi Cement 50kg', categoryId: 'cat_nbi_cement', unitType: 'BAG', quantityInStock: 250, pricePerUnit: 760, costPrice: 690, reorderLevel: 50, storeId: storeNairobiCbd.id },
    { id: 'prod_nbi_cement_simba', sku: 'NBI-CEM-0002', name: 'Simba Cement 50kg', categoryId: 'cat_nbi_cement', unitType: 'BAG', quantityInStock: 200, pricePerUnit: 730, costPrice: 660, reorderLevel: 50, storeId: storeNairobiCbd.id },
    { id: 'prod_nbi_mabati_30', sku: 'NBI-IRS-0001', name: 'Mabati 30-Gauge (8ft)', categoryId: 'cat_nbi_iron_sheets', unitType: 'PIECE', quantityInStock: 400, pricePerUnit: 660, costPrice: 590, reorderLevel: 100, storeId: storeNairobiCbd.id },
    { id: 'prod_nbi_dulux_20l', sku: 'NBI-PNT-0001', name: 'Dulux Weathershield 20L', categoryId: 'cat_nbi_paints', unitType: 'PIECE', quantityInStock: 25, pricePerUnit: 8600, costPrice: 7300, reorderLevel: 10, storeId: storeNairobiCbd.id },
    { id: 'prod_nbi_crown_20l', sku: 'NBI-PNT-0002', name: 'Crown Vinyl Silk 20L', categoryId: 'cat_nbi_paints', unitType: 'PIECE', quantityInStock: 20, pricePerUnit: 6600, costPrice: 5600, reorderLevel: 8, storeId: storeNairobiCbd.id },
    { id: 'prod_nbi_rebar_12mm', sku: 'NBI-IRB-0001', name: 'Rebar 12mm x 12m', categoryId: 'cat_nbi_iron_bars', unitType: 'PIECE', quantityInStock: 350, pricePerUnit: 1220, costPrice: 1070, reorderLevel: 100, storeId: storeNairobiCbd.id },
    { id: 'prod_nbi_spade', sku: 'NBI-TL-0001', name: 'Spade (Heavy Duty)', categoryId: 'cat_nbi_tools', unitType: 'PIECE', quantityInStock: 35, pricePerUnit: 1250, costPrice: 950, reorderLevel: 15, storeId: storeNairobiCbd.id },
    { id: 'prod_nbi_pvc_4inch', sku: 'NBI-PLM-0001', name: 'PVC Pipe 4-inch x 3m', categoryId: 'cat_nbi_plumbing', unitType: 'PIECE', quantityInStock: 100, pricePerUnit: 820, costPrice: 620, reorderLevel: 30, storeId: storeNairobiCbd.id },
    { id: 'prod_nbi_nails_4inch', sku: 'NBI-NAS-0001', name: '4-inch Nails', categoryId: 'cat_nbi_nails_screws', unitType: 'KILOGRAM', quantityInStock: 400, pricePerUnit: 155, costPrice: 115, reorderLevel: 100, storeId: storeNairobiCbd.id },
    { id: 'prod_nbi_helmet', sku: 'NBI-SFT-0001', name: 'Safety Helmet (Hard Hat)', categoryId: 'cat_nbi_safety', unitType: 'PIECE', quantityInStock: 50, pricePerUnit: 1500, costPrice: 1000, reorderLevel: 15, storeId: storeNairobiCbd.id },
    { id: 'prod_nbi_boots', sku: 'NBI-SFT-0002', name: 'Safety Boots (Steel Toe)', categoryId: 'cat_nbi_safety', unitType: 'PAIR', quantityInStock: 40, pricePerUnit: 3500, costPrice: 2500, reorderLevel: 10, storeId: storeNairobiCbd.id },
    { id: 'prod_nkr_cement_bamburi', sku: 'NKR-CEM-0001', name: 'Bamburi Cement 50kg', categoryId: 'cat_nkr_cement', unitType: 'BAG', quantityInStock: 130, pricePerUnit: 740, costPrice: 670, reorderLevel: 50, storeId: storeNakuru.id },
    { id: 'prod_nkr_cement_simba', sku: 'NKR-CEM-0002', name: 'Simba Cement 50kg', categoryId: 'cat_nkr_cement', unitType: 'BAG', quantityInStock: 90, pricePerUnit: 710, costPrice: 640, reorderLevel: 50, storeId: storeNakuru.id },
    { id: 'prod_nkr_mabati_30', sku: 'NKR-IRS-0001', name: 'Mabati 30-Gauge (8ft)', categoryId: 'cat_nkr_iron_sheets', unitType: 'PIECE', quantityInStock: 200, pricePerUnit: 640, costPrice: 575, reorderLevel: 100, storeId: storeNakuru.id },
    { id: 'prod_nkr_mabati_28', sku: 'NKR-IRS-0002', name: 'Mabati 28-Gauge (8ft)', categoryId: 'cat_nkr_iron_sheets', unitType: 'PIECE', quantityInStock: 120, pricePerUnit: 790, costPrice: 710, reorderLevel: 80, storeId: storeNakuru.id },
    { id: 'prod_nkr_dulux_20l', sku: 'NKR-PNT-0001', name: 'Dulux Weathershield 20L', categoryId: 'cat_nkr_paints', unitType: 'PIECE', quantityInStock: 12, pricePerUnit: 8400, costPrice: 7100, reorderLevel: 10, storeId: storeNakuru.id },
    { id: 'prod_nkr_rebar_12mm', sku: 'NKR-IRB-0001', name: 'Rebar 12mm x 12m', categoryId: 'cat_nkr_iron_bars', unitType: 'PIECE', quantityInStock: 160, pricePerUnit: 1180, costPrice: 1030, reorderLevel: 100, storeId: storeNakuru.id },
    { id: 'prod_nkr_spade', sku: 'NKR-TL-0001', name: 'Spade (Heavy Duty)', categoryId: 'cat_nkr_tools', unitType: 'PIECE', quantityInStock: 30, pricePerUnit: 1180, costPrice: 880, reorderLevel: 15, storeId: storeNakuru.id },
    { id: 'prod_nkr_pvc_4inch', sku: 'NKR-PLM-0001', name: 'PVC Pipe 4-inch x 3m', categoryId: 'cat_nkr_plumbing', unitType: 'PIECE', quantityInStock: 60, pricePerUnit: 780, costPrice: 580, reorderLevel: 30, storeId: storeNakuru.id },
    { id: 'prod_nkr_nails_4inch', sku: 'NKR-NAS-0001', name: '4-inch Nails', categoryId: 'cat_nkr_nails_screws', unitType: 'KILOGRAM', quantityInStock: 250, pricePerUnit: 145, costPrice: 108, reorderLevel: 100, storeId: storeNakuru.id },
    { id: 'prod_nkr_tank_1000l', sku: 'NKR-WTK-0001', name: 'Water Tank 1000L (Black)', categoryId: 'cat_nkr_water_tanks', unitType: 'PIECE', quantityInStock: 15, pricePerUnit: 8500, costPrice: 6500, reorderLevel: 5, storeId: storeNakuru.id },
    { id: 'prod_nkr_tank_2300l', sku: 'NKR-WTK-0002', name: 'Water Tank 2300L (Green)', categoryId: 'cat_nkr_water_tanks', unitType: 'PIECE', quantityInStock: 8, pricePerUnit: 16000, costPrice: 12500, reorderLevel: 3, storeId: storeNakuru.id },
  ];
  for (const p of branchProducts) {
    if (productIds.has(p.id)) { skipped.push(`product:${p.id}`); continue; }
    try {
      if (APPLY) await prisma.product.create({ data: { ...p, categoryId: categoryIds.has(p.categoryId) ? p.categoryId : null } as any });
      productIds.add(p.id);
      created.push(`product:${p.id}`);
    } catch (e) { failed.push({ item: `product:${p.id}`, err: String(e).slice(0, 160) }); }
  }

  // ── 2d. BRANCH CUSTOMERS (Ruiru 1 + Nairobi 4 + Nakuru 4) ──────────────────
  const branchCustomers = [
    { id: 'cust_ruiru_4', storeId: storeRuiru.id, name: 'Tala Building Solutions', phone: '0727456789', email: 'info@talabuilding.co.ke', idNumber: '43437890', debtLimit: 200000, currentDebtBalance: 35000 },
    { id: 'cust_nbi_1', storeId: storeNairobiCbd.id, name: 'Westlands Contractors Ltd', phone: '0735123456', email: 'info@westlandscontractors.co.ke', idNumber: '50104567', debtLimit: 500000, currentDebtBalance: 125000 },
    { id: 'cust_nbi_2', storeId: storeNairobiCbd.id, name: 'Agnes Wanjiru', phone: '0736234567', email: 'agnes.w@email.com', idNumber: '51215678', debtLimit: 75000, currentDebtBalance: 0 },
    { id: 'cust_nbi_3', storeId: storeNairobiCbd.id, name: 'Kenya Housing Corp.', phone: '0737345678', email: 'procurement@kenyahousing.co.ke', idNumber: '52326789', debtLimit: 1000000, currentDebtBalance: 350000 },
    { id: 'cust_nbi_4', storeId: storeNairobiCbd.id, name: 'Hassan Ali Mohamed', phone: '0738456789', email: 'hassan.ali@email.com', idNumber: '53437890', debtLimit: 100000, currentDebtBalance: 22000 },
    { id: 'cust_nkr_1', storeId: storeNakuru.id, name: 'Naivasha Road Contractors', phone: '0746123456', email: 'info@naivasharoad.co.ke', idNumber: '60104567', debtLimit: 350000, currentDebtBalance: 67000 },
    { id: 'cust_nkr_2', storeId: storeNakuru.id, name: 'Rebecca Chebet', phone: '0747234567', email: 'rebecca.c@email.com', idNumber: '61215678', debtLimit: 55000, currentDebtBalance: 0 },
    { id: 'cust_nkr_3', storeId: storeNakuru.id, name: 'Rift Valley Hardware Distributors', phone: '0748345678', email: 'info@riftvalleyhw.co.ke', idNumber: '62326789', debtLimit: 500000, currentDebtBalance: 180000 },
    { id: 'cust_nkr_4', storeId: storeNakuru.id, name: 'Samuel Kiprono', phone: '0749456789', email: 'samuel.k@email.com', idNumber: '63437890', debtLimit: 90000, currentDebtBalance: 15000 },
  ];
  for (const c of branchCustomers) {
    if (customerIds.has(c.id)) { skipped.push(`customer:${c.id}`); continue; }
    try {
      if (APPLY) await prisma.customer.create({ data: c as any });
      customerIds.add(c.id);
      created.push(`customer:${c.id}`);
    } catch (e) { failed.push({ item: `customer:${c.id}`, err: String(e).slice(0, 160) }); }
  }

  // ── 3. BRANCH SALES (12, with items + payments) ────────────────────────────
  const branchSales = [
    // Thika
    { id: 'tx_thk_001', storeId: storeThika.id, receiptNumber: 'THK-RCPT-001', customerId: 'cust_thk_1', cashierId: 'user_thika_manager', subtotal: 15000, taxAmount: 2400, discountAmount: 0, totalAmount: 17400, paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE', createdAt: daysAgoAtHour(1, 10),
      items: [{ productId: 'prod_thk_cement_bamburi', productName: 'Bamburi Cement 50kg', quantity: 20, unitType: 'BAG', pricePerUnit: 750, costPrice: 680, lineTotal: 15000 }] },
    { id: 'tx_thk_002', storeId: storeThika.id, receiptNumber: 'THK-RCPT-002', customerId: 'cust_thk_2', cashierId: 'user_thika_manager', subtotal: 42000, taxAmount: 6720, discountAmount: 2000, totalAmount: 46720, paymentMethod: 'MPESA', paymentStatus: 'COMPLETED', transactionType: 'SALE', createdAt: daysAgoAtHour(2, 14),
      items: [
        { productId: 'prod_thk_rebar_12mm', productName: 'Rebar 12mm x 12m', quantity: 25, unitType: 'PIECE', pricePerUnit: 1200, costPrice: 1050, lineTotal: 30000 },
        { productId: 'prod_thk_timber_2x4', productName: 'Timber 2x4 x 12ft (Cypress)', quantity: 15, unitType: 'PIECE', pricePerUnit: 800, costPrice: 600, lineTotal: 12000 },
      ] },
    { id: 'tx_thk_003', storeId: storeThika.id, receiptNumber: 'THK-RCPT-003', customerId: null, cashierId: 'user_thika_manager', subtotal: 2600, taxAmount: 416, discountAmount: 0, totalAmount: 3016, paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE', createdAt: daysAgoAtHour(3, 9),
      items: [
        { productId: 'prod_thk_spade', productName: 'Spade (Heavy Duty)', quantity: 1, unitType: 'PIECE', pricePerUnit: 1200, costPrice: 900, lineTotal: 1200 },
        { productId: 'prod_thk_nails_4inch', productName: '4-inch Nails', quantity: 5, unitType: 'KILOGRAM', pricePerUnit: 150, costPrice: 110, lineTotal: 750 },
        { productId: 'prod_thk_mabati_30', productName: 'Mabati 30-Gauge (8ft)', quantity: 1, unitType: 'PIECE', pricePerUnit: 650, costPrice: 580, lineTotal: 650 },
      ] },
    // Ruiru
    { id: 'tx_ruiru_001', storeId: storeRuiru.id, receiptNumber: 'RUR-RCPT-001', customerId: 'cust_ruiru_2', cashierId: 'user_ruiru_manager', subtotal: 32000, taxAmount: 5120, discountAmount: 1500, totalAmount: 35620, paymentMethod: 'MPESA', paymentStatus: 'COMPLETED', transactionType: 'SALE', createdAt: daysAgoAtHour(0, 11),
      items: [
        { productId: 'prod_ruiru_cement_bamburi', productName: 'Bamburi Cement 50kg', quantity: 30, unitType: 'BAG', pricePerUnit: 750, costPrice: 680, lineTotal: 22500 },
        { productId: 'prod_ruiru_mabati_30', productName: 'Mabati 30-Gauge (8ft)', quantity: 10, unitType: 'PIECE', pricePerUnit: 650, costPrice: 580, lineTotal: 6500 },
        { productId: 'prod_ruiru_nails_4inch', productName: '4-inch Nails', quantity: 20, unitType: 'KILOGRAM', pricePerUnit: 150, costPrice: 110, lineTotal: 3000 },
      ] },
    { id: 'tx_ruiru_002', storeId: storeRuiru.id, receiptNumber: 'RUR-RCPT-002', customerId: 'cust_ruiru_1', cashierId: 'user_ruiru_manager', subtotal: 9200, taxAmount: 1472, discountAmount: 0, totalAmount: 10672, paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE', createdAt: daysAgoAtHour(2, 10),
      items: [
        { productId: 'prod_ruiru_rebar_10mm', productName: 'Rebar 10mm x 12m', quantity: 8, unitType: 'PIECE', pricePerUnit: 900, costPrice: 780, lineTotal: 7200 },
        { productId: 'prod_ruiru_pvc_4inch', productName: 'PVC Pipe 4-inch x 3m', quantity: 2, unitType: 'PIECE', pricePerUnit: 800, costPrice: 600, lineTotal: 1600 },
        { productId: 'prod_ruiru_nails_4inch', productName: '4-inch Nails', quantity: 2, unitType: 'KILOGRAM', pricePerUnit: 150, costPrice: 110, lineTotal: 300 },
        { productId: 'prod_ruiru_spade', productName: 'Spade (Heavy Duty)', quantity: 1, unitType: 'PIECE', pricePerUnit: 1200, costPrice: 900, lineTotal: 1200 },
      ] },
    { id: 'tx_ruiru_003', storeId: storeRuiru.id, receiptNumber: 'RUR-RCPT-003', customerId: 'cust_ruiru_4', cashierId: 'user_ruiru_manager', subtotal: 25500, taxAmount: 4080, discountAmount: 1000, totalAmount: 28580, paymentMethod: 'DEBT', paymentStatus: 'PARTIAL', transactionType: 'SALE', createdAt: daysAgoAtHour(4, 15),
      items: [
        { productId: 'prod_ruiru_cement_simba', productName: 'Simba Cement 50kg', quantity: 25, unitType: 'BAG', pricePerUnit: 720, costPrice: 650, lineTotal: 18000 },
        { productId: 'prod_ruiru_mabati_28', productName: 'Mabati 28-Gauge (8ft)', quantity: 5, unitType: 'PIECE', pricePerUnit: 800, costPrice: 720, lineTotal: 4000 },
        { productId: 'prod_ruiru_cable_2_5mm', productName: 'Cable 2.5mm x 100m', quantity: 1, unitType: 'PIECE', pricePerUnit: 8500, costPrice: 7000, lineTotal: 8500 },
      ] },
    // Nairobi CBD
    { id: 'tx_nbi_001', storeId: storeNairobiCbd.id, receiptNumber: 'NBI-RCPT-001', customerId: 'cust_nbi_3', cashierId: 'user_nairobi_manager', subtotal: 96000, taxAmount: 15360, discountAmount: 5000, totalAmount: 106360, paymentMethod: 'MPESA', paymentStatus: 'COMPLETED', transactionType: 'SALE', createdAt: daysAgoAtHour(0, 9),
      items: [
        { productId: 'prod_nbi_cement_bamburi', productName: 'Bamburi Cement 50kg', quantity: 80, unitType: 'BAG', pricePerUnit: 760, costPrice: 690, lineTotal: 60800 },
        { productId: 'prod_nbi_rebar_12mm', productName: 'Rebar 12mm x 12m', quantity: 20, unitType: 'PIECE', pricePerUnit: 1220, costPrice: 1070, lineTotal: 24400 },
        { productId: 'prod_nbi_helmet', productName: 'Safety Helmet (Hard Hat)', quantity: 5, unitType: 'PIECE', pricePerUnit: 1500, costPrice: 1000, lineTotal: 7500 },
        { productId: 'prod_nbi_boots', productName: 'Safety Boots (Steel Toe)', quantity: 2, unitType: 'PAIR', pricePerUnit: 3500, costPrice: 2500, lineTotal: 7000 },
      ] },
    { id: 'tx_nbi_002', storeId: storeNairobiCbd.id, receiptNumber: 'NBI-RCPT-002', customerId: 'cust_nbi_2', cashierId: 'user_nairobi_manager', subtotal: 15200, taxAmount: 2432, discountAmount: 0, totalAmount: 17632, paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE', createdAt: daysAgoAtHour(1, 14),
      items: [
        { productId: 'prod_nbi_dulux_20l', productName: 'Dulux Weathershield 20L', quantity: 1, unitType: 'PIECE', pricePerUnit: 8600, costPrice: 7300, lineTotal: 8600 },
        { productId: 'prod_nbi_crown_20l', productName: 'Crown Vinyl Silk 20L', quantity: 1, unitType: 'PIECE', pricePerUnit: 6600, costPrice: 5600, lineTotal: 6600 },
      ] },
    { id: 'tx_nbi_003', storeId: storeNairobiCbd.id, receiptNumber: 'NBI-RCPT-003', customerId: null, cashierId: 'user_nairobi_manager', subtotal: 7800, taxAmount: 1248, discountAmount: 0, totalAmount: 9048, paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE', createdAt: daysAgoAtHour(3, 11),
      items: [
        { productId: 'prod_nbi_mabati_30', productName: 'Mabati 30-Gauge (8ft)', quantity: 10, unitType: 'PIECE', pricePerUnit: 660, costPrice: 590, lineTotal: 6600 },
        { productId: 'prod_nbi_nails_4inch', productName: '4-inch Nails', quantity: 8, unitType: 'KILOGRAM', pricePerUnit: 155, costPrice: 115, lineTotal: 1240 },
      ] },
    // Nakuru
    { id: 'tx_nkr_001', storeId: storeNakuru.id, receiptNumber: 'NKR-RCPT-001', customerId: 'cust_nkr_1', cashierId: 'user_nakuru_manager', subtotal: 57000, taxAmount: 9120, discountAmount: 3000, totalAmount: 63120, paymentMethod: 'MPESA', paymentStatus: 'COMPLETED', transactionType: 'SALE', createdAt: daysAgoAtHour(0, 12),
      items: [
        { productId: 'prod_nkr_cement_bamburi', productName: 'Bamburi Cement 50kg', quantity: 50, unitType: 'BAG', pricePerUnit: 740, costPrice: 670, lineTotal: 37000 },
        { productId: 'prod_nkr_mabati_28', productName: 'Mabati 28-Gauge (8ft)', quantity: 20, unitType: 'PIECE', pricePerUnit: 790, costPrice: 710, lineTotal: 15800 },
        { productId: 'prod_nkr_tank_1000l', productName: 'Water Tank 1000L (Black)', quantity: 1, unitType: 'PIECE', pricePerUnit: 8500, costPrice: 6500, lineTotal: 8500 },
      ] },
    { id: 'tx_nkr_002', storeId: storeNakuru.id, receiptNumber: 'NKR-RCPT-002', customerId: 'cust_nkr_3', cashierId: 'user_nakuru_manager', subtotal: 35400, taxAmount: 5664, discountAmount: 2000, totalAmount: 39064, paymentMethod: 'DEBT', paymentStatus: 'COMPLETED', transactionType: 'SALE', createdAt: daysAgoAtHour(2, 10),
      items: [
        { productId: 'prod_nkr_rebar_12mm', productName: 'Rebar 12mm x 12m', quantity: 20, unitType: 'PIECE', pricePerUnit: 1180, costPrice: 1030, lineTotal: 23600 },
        { productId: 'prod_nkr_cement_simba', productName: 'Simba Cement 50kg', quantity: 15, unitType: 'BAG', pricePerUnit: 710, costPrice: 640, lineTotal: 10650 },
        { productId: 'prod_nkr_tank_2300l', productName: 'Water Tank 2300L (Green)', quantity: 1, unitType: 'PIECE', pricePerUnit: 16000, costPrice: 12500, lineTotal: 16000 },
      ] },
    { id: 'tx_nkr_003', storeId: storeNakuru.id, receiptNumber: 'NKR-RCPT-003', customerId: 'cust_nkr_4', cashierId: 'user_nakuru_manager', subtotal: 5100, taxAmount: 816, discountAmount: 0, totalAmount: 5916, paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE', createdAt: daysAgoAtHour(4, 14),
      items: [
        { productId: 'prod_nkr_spade', productName: 'Spade (Heavy Duty)', quantity: 2, unitType: 'PIECE', pricePerUnit: 1180, costPrice: 880, lineTotal: 2360 },
        { productId: 'prod_nkr_pvc_4inch', productName: 'PVC Pipe 4-inch x 3m', quantity: 3, unitType: 'PIECE', pricePerUnit: 780, costPrice: 580, lineTotal: 2340 },
        { productId: 'prod_nkr_nails_4inch', productName: '4-inch Nails', quantity: 2, unitType: 'KILOGRAM', pricePerUnit: 145, costPrice: 108, lineTotal: 290 },
      ] },
  ];
  for (const sale of branchSales) {
    if (await prisma.salesTransaction.findUnique({ where: { receiptNumber: sale.receiptNumber } })) { skipped.push(`sale:${sale.receiptNumber}`); continue; }
    // Verify items' products — drop rows with unknown products rather than fail.
    const validItems = sale.items.filter(i => productIds.has(i.productId));
    if (validItems.length < sale.items.length) {
      console.log(`   ⚠️  ${sale.receiptNumber}: dropping ${sale.items.length - validItems.length} item(s) with unknown productId`);
    }
    if (validItems.length === 0) { failed.push({ item: `sale:${sale.receiptNumber}`, err: 'all item productIds unknown' }); continue; }
    const cashierId = userOrUndefined(sale.cashierId);
    if (!cashierId) { failed.push({ item: `sale:${sale.receiptNumber}`, err: 'cashier user missing' }); continue; }
    try {
      if (APPLY) {
        await prisma.salesTransaction.create({
          data: {
            id: sale.id, storeId: sale.storeId, receiptNumber: sale.receiptNumber,
            customerId: custOrNull(sale.customerId), cashierId,
            subtotal: sale.subtotal, taxAmount: sale.taxAmount, discountAmount: sale.discountAmount, totalAmount: sale.totalAmount,
            paymentMethod: sale.paymentMethod, paymentStatus: sale.paymentStatus, transactionType: sale.transactionType,
            createdAt: sale.createdAt,
            items: { create: validItems },
            payments: { create: { storeId: sale.storeId, paymentMethod: sale.paymentMethod === 'SPLIT' ? 'CASH' : sale.paymentMethod, amount: sale.paymentMethod === 'DEBT' ? 0 : sale.totalAmount, status: 'COMPLETED' } },
          },
        });
      }
      created.push(`sale:${sale.receiptNumber}`);
    } catch (e) { failed.push({ item: `sale:${sale.receiptNumber}`, err: String(e).slice(0, 160) }); }
  }

  // ── 4. EXPENSES (Juja 5 + branch 8, fixed IDs) ─────────────────────────────
  const expenses = [
    { id: 'exp_seed_juja_1', storeId: store.id, description: 'Shop rent - January', amount: 25000, category: 'RENT', paidBy: 'user_super_admin', paymentMethod: 'CASH', notes: 'Monthly rent for Juja Main shop' },
    { id: 'exp_seed_juja_2', storeId: store.id, description: 'Electricity bill', amount: 4500, category: 'UTILITIES', paidBy: 'user_accountant_1', paymentMethod: 'MPESA', notes: 'Kenya Power bill for Dec' },
    { id: 'exp_seed_juja_3', storeId: store.id, description: 'Delivery truck fuel', amount: 3500, category: 'TRANSPORT', paidBy: 'user_cashier_1', paymentMethod: 'CASH', notes: 'Fuel for delivery to site' },
    { id: 'exp_seed_juja_4', storeId: store.id, description: 'Staff salary - Grace', amount: 18000, category: 'SALARIES', paidBy: 'user_super_admin', paymentMethod: 'MPESA', notes: 'Monthly salary' },
    { id: 'exp_seed_juja_5', storeId: store.id, description: 'Shop maintenance - door repair', amount: 2500, category: 'MAINTENANCE', paidBy: 'user_cashier_1', paymentMethod: 'CASH' },
    { id: 'exp_seed_br_1', storeId: storeThika.id, description: 'Thika branch rent - January', amount: 20000, category: 'RENT', paidBy: 'user_thika_manager', paymentMethod: 'MPESA', notes: 'Monthly rent for Thika shop' },
    { id: 'exp_seed_br_2', storeId: storeThika.id, description: 'Thika electricity bill', amount: 3500, category: 'UTILITIES', paidBy: 'user_thika_manager', paymentMethod: 'MPESA', notes: 'Kenya Power bill' },
    { id: 'exp_seed_br_3', storeId: storeRuiru.id, description: 'Ruiru branch rent - January', amount: 18000, category: 'RENT', paidBy: 'user_ruiru_manager', paymentMethod: 'MPESA', notes: 'Monthly rent for Ruiru shop' },
    { id: 'exp_seed_br_4', storeId: storeRuiru.id, description: 'Ruiru water bill', amount: 2000, category: 'UTILITIES', paidBy: 'user_ruiru_manager', paymentMethod: 'CASH', notes: 'Ruiru water bill' },
    { id: 'exp_seed_br_5', storeId: storeNairobiCbd.id, description: 'Nairobi CBD branch rent - January', amount: 45000, category: 'RENT', paidBy: 'user_nairobi_manager', paymentMethod: 'MPESA', notes: 'Monthly rent for CBD shop' },
    { id: 'exp_seed_br_6', storeId: storeNairobiCbd.id, description: 'CBD security services', amount: 8000, category: 'SECURITY', paidBy: 'user_nairobi_manager', paymentMethod: 'MPESA', notes: 'Monthly security guard fee' },
    { id: 'exp_seed_br_7', storeId: storeNakuru.id, description: 'Nakuru branch rent - January', amount: 15000, category: 'RENT', paidBy: 'user_nakuru_manager', paymentMethod: 'MPESA', notes: 'Monthly rent for Nakuru shop' },
    { id: 'exp_seed_br_8', storeId: storeNakuru.id, description: 'Nakuru transport costs', amount: 5000, category: 'TRANSPORT', paidBy: 'user_nakuru_manager', paymentMethod: 'CASH', notes: 'Delivery truck fuel' },
  ];
  for (const ex of expenses) {
    if (await prisma.expense.findUnique({ where: { id: ex.id } })) { skipped.push(`expense:${ex.id}`); continue; }
    const paidBy = userOrUndefined(ex.paidBy);
    try {
      if (APPLY) await prisma.expense.create({ data: { ...ex, paidBy: paidBy ?? 'unknown' } });
      created.push(`expense:${ex.id}`);
    } catch (e) { failed.push({ item: `expense:${ex.id}`, err: String(e).slice(0, 160) }); }
  }

  // ── 5. DEBT LEDGERS (6, transaction refs nulled if absent) ─────────────────
  const debtLedgers = [
    { id: 'debt_1', storeId: store.id, customerId: 'cust_2', transactionId: 'tx_004', amountOwed: 15000, amountPaid: 0, balance: 15000, dueDate: new Date('2025-01-15'), status: 'OUTSTANDING', agingBucket: 'DAYS_60' },
    { id: 'debt_2', storeId: store.id, customerId: 'cust_3', transactionId: 'tx_004', amountOwed: 45000, amountPaid: 5000, balance: 40000, dueDate: new Date('2025-01-01'), status: 'OVERDUE', agingBucket: 'DAYS_90_PLUS' },
    { id: 'debt_3', storeId: store.id, customerId: 'cust_4', transactionId: 'tx_009', amountOwed: 120000, amountPaid: 30000, balance: 90000, dueDate: new Date('2025-03-30'), status: 'PARTIAL', agingBucket: 'DAYS_30' },
    { id: 'debt_4', storeId: store.id, customerId: 'cust_5', transactionId: null, amountOwed: 5000, amountPaid: 0, balance: 5000, dueDate: new Date('2025-04-28'), status: 'OUTSTANDING', agingBucket: 'CURRENT' },
    { id: 'debt_5', storeId: store.id, customerId: 'cust_6', transactionId: null, amountOwed: 32000, amountPaid: 8000, balance: 24000, dueDate: new Date('2025-02-15'), status: 'PARTIAL', agingBucket: 'DAYS_30' },
    { id: 'debt_6', storeId: store.id, customerId: 'cust_8', transactionId: 'tx_009', amountOwed: 52680, amountPaid: 26340, balance: 26340, dueDate: new Date('2025-03-15'), status: 'PARTIAL', agingBucket: 'CURRENT' },
  ];
  for (const dl of debtLedgers) {
    if (await prisma.debtLedger.findUnique({ where: { id: dl.id } })) { skipped.push(`debt:${dl.id}`); continue; }
    if (!customerIds.has(dl.customerId)) { failed.push({ item: `debt:${dl.id}`, err: `customer ${dl.customerId} missing` }); continue; }
    const tx = dl.transactionId && (await prisma.salesTransaction.findUnique({ where: { id: dl.transactionId } })) ? dl.transactionId : null;
    try {
      if (APPLY) await prisma.debtLedger.create({
        data: { ...dl, transactionId: tx, notes: tx ? undefined : 'Recovered by top-up: original transaction ref absent in this DB' },
      });
      created.push(`debt:${dl.id}`);
    } catch (e) { failed.push({ item: `debt:${dl.id}`, err: String(e).slice(0, 160) }); }
  }

  // ── 6. EQUIPMENT RENTALS (3) ───────────────────────────────────────────────
  const rentals = [
    { id: 'rental_1', storeId: store.id, productId: 'prod_concrete_mixer', customerId: 'cust_3', status: 'ACTIVE', rentalStartDate: daysAgo(5), expectedReturnDate: daysAgo(-5), securityDeposit: 10000, ratePerDay: 3000, totalRentalCharge: 30000, lateFeeAccumulated: 0 },
    { id: 'rental_2', storeId: store.id, productId: 'prod_scaffolding', customerId: 'cust_4', status: 'OVERDUE', rentalStartDate: daysAgo(20), expectedReturnDate: daysAgo(3), securityDeposit: 15000, ratePerDay: 1500, totalRentalCharge: 30000, lateFeeAccumulated: 4500 },
    { id: 'rental_3', storeId: store.id, productId: 'prod_vibrator', customerId: 'cust_7', status: 'RETURNED', rentalStartDate: daysAgo(10), expectedReturnDate: daysAgo(3), actualReturnDate: daysAgo(4), securityDeposit: 5000, ratePerDay: 2000, totalRentalCharge: 14000, lateFeeAccumulated: 0 },
  ];
  for (const er of rentals) {
    if (await prisma.equipmentRental.findUnique({ where: { id: er.id } })) { skipped.push(`rental:${er.id}`); continue; }
    if (!productIds.has(er.productId) || !customerIds.has(er.customerId)) {
      failed.push({ item: `rental:${er.id}`, err: 'product/customer reference missing' }); continue;
    }
    try {
      if (APPLY) await prisma.equipmentRental.create({ data: er });
      created.push(`rental:${er.id}`);
    } catch (e) { failed.push({ item: `rental:${er.id}`, err: String(e).slice(0, 160) }); }
  }

  // ── 7. PURCHASE ORDERS (5, guarded by poNumber) ────────────────────────────
  const jujaSuppliers = { bamburi: 'sup_juja_bamburi', mabati: 'sup_juja_mabati', dulux: 'sup_juja_dulux' };
  const jujaProducts = {
    cement: 'prod_cement_bamburi', mabati30: 'prod_mabati_30', dulux20l: 'prod_dulux_20l',
    rebar12mm: 'prod_rebar_12mm', mabati28: 'prod_mabati_28', crown20l: 'prod_crown_20l',
    rebar10mm: 'prod_rebar_10mm', nails4inch: 'prod_nails_4inch',
  };
  const pos: { number: string; date: Date; supplierId: string; status: string; expectedDate?: Date; approvedAt?: Date; receivedAt?: Date; cancelledAt?: Date; notes: string; items: { productId: string; productName: string; quantity: number; unitCost: number; receivedQty: number }[] }[] = [
    { number: `PO-${poDateStr(daysAgo(14))}-0001`, date: daysAgo(14), supplierId: jujaSuppliers.bamburi, status: 'RECEIVED', expectedDate: daysAgo(10), approvedAt: daysAgoAtHour(13, 10), receivedAt: daysAgoAtHour(10, 14), notes: 'Routine restocking order — fully received.',
      items: [
        { productId: jujaProducts.cement, productName: 'Bamburi Cement 50kg', quantity: 100, unitCost: 680, receivedQty: 100 },
        { productId: jujaProducts.mabati30, productName: 'Mabati 30-Gauge (8ft)', quantity: 200, unitCost: 580, receivedQty: 200 },
        { productId: jujaProducts.dulux20l, productName: 'Dulux Weathershield 20L', quantity: 20, unitCost: 7200, receivedQty: 20 },
        { productId: jujaProducts.rebar12mm, productName: 'Rebar 12mm x 12m', quantity: 150, unitCost: 1050, receivedQty: 150 },
      ] },
    { number: `PO-${poDateStr(daysAgo(7))}-0002`, date: daysAgo(7), supplierId: jujaSuppliers.mabati, status: 'APPROVED', expectedDate: daysAgo(3), approvedAt: daysAgoAtHour(6, 11), notes: 'Urgent order for upcoming construction season.',
      items: [
        { productId: jujaProducts.mabati28, productName: 'Mabati 28-Gauge (8ft)', quantity: 100, unitCost: 720, receivedQty: 0 },
        { productId: jujaProducts.crown20l, productName: 'Crown Vinyl Silk 20L', quantity: 15, unitCost: 5500, receivedQty: 0 },
        { productId: jujaProducts.rebar10mm, productName: 'Rebar 10mm x 12m', quantity: 80, unitCost: 780, receivedQty: 0 },
      ] },
    { number: `PO-${poDateStr(daysAgo(21))}-0003`, date: daysAgo(21), supplierId: jujaSuppliers.dulux, status: 'PARTIALLY_RECEIVED', expectedDate: daysAgo(14), approvedAt: daysAgoAtHour(20, 9), receivedAt: daysAgoAtHour(14, 15), notes: 'Partial delivery — Dulux paint backordered by supplier. Cement and mabati delivered in full.',
      items: [
        { productId: jujaProducts.cement, productName: 'Bamburi Cement 50kg', quantity: 200, unitCost: 680, receivedQty: 200 },
        { productId: jujaProducts.mabati30, productName: 'Mabati 30-Gauge (8ft)', quantity: 300, unitCost: 580, receivedQty: 300 },
        { productId: jujaProducts.dulux20l, productName: 'Dulux Weathershield 20L', quantity: 30, unitCost: 7200, receivedQty: 12 },
      ] },
    { number: `PO-${poDateStr(new Date())}-0004`, date: new Date(), supplierId: jujaSuppliers.bamburi, status: 'DRAFT', notes: 'Draft — pending review before sending to supplier.',
      items: [
        { productId: jujaProducts.nails4inch, productName: '4-inch Nails', quantity: 200, unitCost: 110, receivedQty: 0 },
        { productId: jujaProducts.rebar10mm, productName: 'Rebar 10mm x 12m', quantity: 50, unitCost: 780, receivedQty: 0 },
      ] },
    { number: `PO-${poDateStr(daysAgo(30))}-0005`, date: daysAgo(30), supplierId: jujaSuppliers.mabati, status: 'CANCELLED', expectedDate: daysAgo(23), approvedAt: daysAgoAtHour(29, 14), cancelledAt: daysAgoAtHour(28, 9), notes: 'Cancelled — supplier could not meet delivery timeline. Will reorder from alternative supplier.',
      items: [
        { productId: jujaProducts.cement, productName: 'Bamburi Cement 50kg', quantity: 50, unitCost: 680, receivedQty: 0 },
        { productId: jujaProducts.mabati30, productName: 'Mabati 30-Gauge (8ft)', quantity: 100, unitCost: 580, receivedQty: 0 },
      ] },
  ];
  for (const po of pos) {
    if (await prisma.purchaseOrder.findUnique({ where: { poNumber: po.number } })) { skipped.push(`po:${po.number}`); continue; }
    if (!userIds.has('user_super_admin')) { failed.push({ item: `po:${po.number}`, err: 'user_super_admin missing' }); continue; }
    const subTotal = po.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
    const tax = Math.round(subTotal * 0.16);
    try {
      if (APPLY) {
        await prisma.purchaseOrder.create({
          data: {
            storeId: store.id, poNumber: po.number, supplierId: po.supplierId, status: po.status,
            orderDate: po.date, expectedDate: po.expectedDate, subTotal, taxAmount: tax, totalAmount: subTotal + tax,
            notes: po.notes, createdById: 'user_super_admin',
            approvedById: po.approvedAt ? 'user_super_admin' : undefined, approvedAt: po.approvedAt,
            receivedById: po.receivedAt ? 'user_super_admin' : undefined, receivedAt: po.receivedAt,
            cancelledById: po.cancelledAt ? 'user_super_admin' : undefined, cancelledAt: po.cancelledAt,
            items: { create: po.items.map(i => ({ ...i, totalCost: i.quantity * i.unitCost })) },
          },
        });
      }
      created.push(`po:${po.number}`);
    } catch (e) { failed.push({ item: `po:${po.number}`, err: String(e).slice(0, 160) }); }
  }

  // ── 8. GIFT CARDS (14) ─────────────────────────────────────────────────────
  const giftCards = [
    { id: 'gc_active_0001', storeId: store.id, code: 'GC-ACTIVE-0001', reason: 'CUSTOMER_LOYALTY', initialBalance: 5000, currentBalance: 3500, status: 'PARTIALLY_REDEEMED', recipientName: 'John Kamau', recipientPhone: '0722123456', issuedTo: 'cust_1', issuedBy: 'user_super_admin', autoAdjustItems: true, createdAt: daysAgo(30) },
    { id: 'gc_active_0002', storeId: store.id, code: 'GC-ACTIVE-0002', reason: 'PROMOTION', initialBalance: 2000, currentBalance: 2000, status: 'ACTIVE', recipientName: 'Walk-in Customer', issuedBy: 'user_cashier_1', autoAdjustItems: true, createdAt: daysAgo(14) },
    { id: 'gc_redeemed_0001', storeId: store.id, code: 'GC-REDEEMED-0001', reason: 'REFUND_CREDIT', initialBalance: 10000, currentBalance: 0, status: 'REDEEMED', recipientName: 'Mary Njeri', recipientPhone: '0733234567', issuedTo: 'cust_2', issuedBy: 'user_super_admin', lastRedeemedAt: daysAgo(1), autoAdjustItems: false, isVisible: false, createdAt: daysAgo(60) },
    { id: 'gc_gift_0001', storeId: store.id, code: 'GC-GIFT-0001', reason: 'GIFT', initialBalance: 15000, currentBalance: 15000, status: 'ACTIVE', recipientName: 'Peter Odhiambo', recipientPhone: '0745345678', issuedTo: 'cust_3', issuedBy: 'user_super_admin', expiresAt: daysFromNow(90), autoAdjustItems: true, createdAt: daysAgo(7) },
    { id: 'gc_thk_0001', storeId: storeThika.id, code: 'GC-THK-0001', reason: 'STORE_CREDIT', initialBalance: 8000, currentBalance: 4500, status: 'PARTIALLY_REDEEMED', recipientName: 'Francis Maina', recipientPhone: '0715123456', issuedTo: 'cust_thk_1', issuedBy: 'user_thika_manager', autoAdjustItems: true, createdAt: daysAgo(20) },
    { id: 'gc_thk_0002', storeId: storeThika.id, code: 'GC-THK-0002', reason: 'EMPLOYEE_AWARD', initialBalance: 3000, currentBalance: 3000, status: 'ACTIVE', recipientName: 'Staff Reward', issuedBy: 'user_thika_manager', autoAdjustItems: false, createdAt: daysAgo(5) },
    { id: 'gc_rur_0001', storeId: storeRuiru.id, code: 'GC-RUR-0001', reason: 'CUSTOMER_LOYALTY', initialBalance: 7500, currentBalance: 7500, status: 'ACTIVE', recipientName: 'Esther Nyambura', recipientPhone: '0724123456', issuedTo: 'cust_ruiru_1', issuedBy: 'user_ruiru_manager', autoAdjustItems: true, createdAt: daysAgo(10) },
    { id: 'gc_rur_0002', storeId: storeRuiru.id, code: 'GC-RUR-0002', reason: 'COMPLAINT_RESOLUTION', initialBalance: 5000, currentBalance: 0, status: 'CANCELLED', recipientName: 'Joseph Gathua', issuedBy: 'user_ruiru_manager', autoAdjustItems: true, isVisible: false, createdAt: daysAgo(45) },
    { id: 'gc_nbi_0001', storeId: storeNairobiCbd.id, code: 'GC-NBI-0001', reason: 'PROMOTION', initialBalance: 20000, currentBalance: 12500, status: 'PARTIALLY_REDEEMED', recipientName: 'Westlands Contractors Ltd', issuedTo: 'cust_nbi_1', issuedBy: 'user_nairobi_manager', autoAdjustItems: true, createdAt: daysAgo(25) },
    { id: 'gc_nbi_0002', storeId: storeNairobiCbd.id, code: 'GC-NBI-0002', reason: 'GIFT', initialBalance: 5000, currentBalance: 5000, status: 'ACTIVE', recipientName: 'Agnes Wanjiru', issuedTo: 'cust_nbi_2', issuedBy: 'user_nairobi_manager', expiresAt: daysFromNow(60), autoAdjustItems: false, createdAt: daysAgo(3) },
    { id: 'gc_nbi_0003', storeId: storeNairobiCbd.id, code: 'GC-NBI-0003', reason: 'REFUND_CREDIT', initialBalance: 3500, currentBalance: 0, status: 'REDEEMED', recipientName: 'Hassan Ali Mohamed', issuedTo: 'cust_nbi_4', issuedBy: 'user_nairobi_manager', lastRedeemedAt: daysAgo(2), autoAdjustItems: false, isVisible: false, createdAt: daysAgo(15) },
    { id: 'gc_nkr_0001', storeId: storeNakuru.id, code: 'GC-NKR-0001', reason: 'CUSTOMER_LOYALTY', initialBalance: 10000, currentBalance: 6700, status: 'PARTIALLY_REDEEMED', recipientName: 'Naivasha Road Contractors', issuedTo: 'cust_nkr_1', issuedBy: 'user_nakuru_manager', autoAdjustItems: true, createdAt: daysAgo(35) },
    { id: 'gc_nkr_0002', storeId: storeNakuru.id, code: 'GC-NKR-0002', reason: 'STORE_CREDIT', initialBalance: 2500, currentBalance: 2500, status: 'ACTIVE', recipientName: 'Rebecca Chebet', issuedTo: 'cust_nkr_2', issuedBy: 'user_nakuru_manager', autoAdjustItems: false, createdAt: daysAgo(8) },
    { id: 'gc_nkr_0003', storeId: storeNakuru.id, code: 'GC-NKR-0003', reason: 'OTHER', initialBalance: 4000, currentBalance: 4000, status: 'ACTIVE', recipientName: 'General Customer', issuedBy: 'user_nakuru_manager', expiresAt: daysFromNow(120), autoAdjustItems: false, createdAt: daysAgo(2) },
  ];
  const gcIdByCode = new Map<string, string>();
  for (const gc of giftCards) {
    if (await prisma.giftCard.findUnique({ where: { id: gc.id } })) { skipped.push(`giftCard:${gc.id}`); gcIdByCode.set(gc.code, gc.id); continue; }
    const issuedBy = userOrUndefined(gc.issuedBy);
    if (!issuedBy) { failed.push({ item: `giftCard:${gc.id}`, err: `issuer ${gc.issuedBy} missing` }); continue; }
    try {
      if (APPLY) await prisma.giftCard.create({ data: { ...gc, issuedBy, issuedTo: custOrNull(gc.issuedTo) } });
      created.push(`giftCard:${gc.id}`);
    } catch (e) { failed.push({ item: `giftCard:${gc.id}`, err: String(e).slice(0, 160) }); }
    gcIdByCode.set(gc.code, gc.id);
  }

  // ── 9. GIFT CARD REDEMPTIONS (11, one guard-set per card) ──────────────────
  const redemptions = [
    { code: 'GC-ACTIVE-0001', rows: [
      { amount: 1000, redeemedBy: 'user_cashier_1', notes: 'Partial redemption - cement purchase', createdAt: daysAgoAtHour(15, 11) },
      { amount: 500, redeemedBy: 'user_cashier_1', notes: 'Partial redemption - nails purchase', createdAt: daysAgoAtHour(10, 14) },
    ] },
    { code: 'GC-THK-0001', rows: [
      { amount: 2000, redeemedBy: 'user_thika_cashier', notes: 'Redemption - cement purchase', createdAt: daysAgoAtHour(12, 10) },
      { amount: 1500, redeemedBy: 'user_thika_cashier', notes: 'Redemption - iron sheets purchase', createdAt: daysAgoAtHour(8, 15) },
    ] },
    { code: 'GC-NBI-0001', rows: [
      { amount: 5000, redeemedBy: 'user_nairobi_cashier', notes: 'Redemption - bulk cement order', createdAt: daysAgoAtHour(20, 9) },
      { amount: 2500, redeemedBy: 'user_nairobi_cashier', notes: 'Redemption - paint supplies', createdAt: daysAgoAtHour(10, 13) },
    ] },
    { code: 'GC-NKR-0001', rows: [
      { amount: 2000, redeemedBy: 'user_nakuru_cashier', notes: 'Redemption - plumbing supplies', createdAt: daysAgoAtHour(25, 10) },
      { amount: 1300, redeemedBy: 'user_nakuru_cashier', notes: 'Redemption - nails and screws', createdAt: daysAgoAtHour(15, 16) },
    ] },
    { code: 'GC-REDEEMED-0001', rows: [
      { amount: 5000, redeemedBy: 'user_cashier_1', notes: 'Redemption - building materials', createdAt: daysAgoAtHour(5, 9) },
      { amount: 5000, redeemedBy: 'user_cashier_1', notes: 'Final redemption - remaining balance', createdAt: daysAgo(1) },
    ] },
    { code: 'GC-NBI-0003', rows: [
      { amount: 3500, redeemedBy: 'user_nairobi_cashier', notes: 'Full redemption - refund credit', createdAt: daysAgo(2) },
    ] },
  ];
  for (const group of redemptions) {
    const giftCardId = gcIdByCode.get(group.code);
    if (!giftCardId) { failed.push({ item: `redemption:${group.code}`, err: 'gift card not present' }); continue; }
    if ((await prisma.giftCardRedemption.count({ where: { giftCardId } })) > 0) {
      skipped.push(`redemption:${group.code}`); continue;
    }
    let any = false;
    for (const r of group.rows) {
      const redeemedBy = userOrUndefined(r.redeemedBy);
      if (!redeemedBy) { failed.push({ item: `redemption:${group.code}/${r.amount}`, err: `user ${r.redeemedBy} missing` }); continue; }
      try {
        if (APPLY) await prisma.giftCardRedemption.create({ data: { giftCardId, ...r, redeemedBy } });
        created.push(`redemption:${group.code}/${r.amount}`);
        any = true;
      } catch (e) { failed.push({ item: `redemption:${group.code}/${r.amount}`, err: String(e).slice(0, 160) }); }
    }
    if (!any) skipped.push(`redemption:${group.code}`);
  }

  // ── 10. AUDIT TRAIL ────────────────────────────────────────────────────────
  if (APPLY && created.length > 0) {
    try {
      await prisma.systemLog.create({
        data: {
          storeId: store.id, userId: userOrUndefined('user_super_admin'),
          action: 'DEMO_DATA_TOPUP', component: 'SYSTEM', severity: 'INFO',
          message: `Guarded demo-data top-up applied (${created.length} records) via scripts/topup-demo-data.ts`,
          metadata: JSON.stringify({ created: created.length, skipped: skipped.length, failed: failed.length }),
        },
      });
      console.log('\n📝 systemLog audit entry written.');
    } catch (e) {
      console.log(`\n⚠️ systemLog entry failed: ${String(e).slice(0, 120)}`);
    }
  }

  // ── summary ────────────────────────────────────────────────────────────────
  console.log(`\n=== SUMMARY: ${created.length} to create, ${skipped.length} skipped (already present), ${failed.length} failed ===`);
  if (failed.length) console.log('Failures:', JSON.stringify(failed, null, 1));
  const after = await snapshot();
  console.log('\nTable              before → after');
  for (const k of Object.keys(before)) {
    console.log(`${k.padEnd(24)} ${String(before[k]).padStart(5)} → ${after[k]}`);
  }
  console.log(`\n${APPLY ? '✅ APPLY complete.' : '🟡 Dry run only — re-run with APPLY=1 to write.'}`);
}

async function snapshot(): Promise<Record<string, number>> {
  const models: [string, keyof typeof prisma][] = [
    ['product_categories', 'productCategory'], ['products', 'product'], ['customers', 'customer'],
    ['suppliers', 'supplier'], ['accounts', 'account'], ['sales_transactions', 'salesTransaction'],
    ['expenses', 'expense'], ['debt_ledgers', 'debtLedger'], ['equipment_rentals', 'equipmentRental'],
    ['purchase_orders', 'purchaseOrder'], ['gift_cards', 'giftCard'], ['gift_card_redemptions', 'giftCardRedemption'],
  ];
  const out: Record<string, number> = {};
  for (const [label, model] of models) {
    // @ts-expect-error — dynamic delegate access for the summary only
    out[label] = await prisma[model].count();
  }
  return out;
}

main()
  .catch(e => { console.error('❌ Top-up failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
