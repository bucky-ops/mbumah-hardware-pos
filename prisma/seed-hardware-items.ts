// =============================================================================
// MBUMAH Hardware POS — Bulk Hardware Catalog Seed
// -----------------------------------------------------------------------------
// Task 3 / Feature 2: Database Population
// Branch: security/v1.1.0-hardening
//
// Standalone bulk-insert script that populates the Juja Main store with a large,
// realistic catalog of Kenyan hardware items (~195 SKUs across 15 categories).
//
// Run via:
//   npx tsx prisma/seed-hardware-items.ts
//   or
//   pnpm db:seed-hardware   (after adding the script to package.json)
//
// Idempotent: re-running will skip products whose SKU already exists.
// Safe: a single product failure is logged and does not abort the run.
// =============================================================================

import { db } from '../src/lib/db';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------
// Reuse the EXISTING store + category IDs created by prisma/seed.ts so this
// script can be run on top of a freshly-seeded database without collisions.
const STORE_ID = 'store_juja_main';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Generate a valid EAN-13 barcode from a numeric seed.
 *
 * Uses the GS1 "restricted" prefix `200` (in-house numbering) plus a 9-digit
 * zero-padded seed and a correctly-computed EAN-13 check digit. The result is
 * always exactly 13 digits and is deterministic for a given seed — so re-runs
 * of the script produce stable barcodes that won't violate the @unique
 * constraint during upserts.
 */
function genBarcode(seed: number): string {
  const prefix = '200'; // GS1 reserved for internal numbering
  const body = String(seed).padStart(9, '0').slice(-9); // 9 digits
  const partial = `${prefix}${body}`; // 12 digits
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(partial[i], 10);
    sum += i % 2 === 0 ? d : d * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return `${partial}${check}`; // 13 digits
}

// -----------------------------------------------------------------------------
// New Categories
// -----------------------------------------------------------------------------
// Categories that do NOT exist in prisma/seed.ts. These are created (upserted)
// before any products reference them. IDs follow the existing `cat_*` pattern.

interface NewCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  sortOrder: number;
}

const NEW_CATEGORIES: NewCategory[] = [
  {
    id: 'cat_timber',
    name: 'Timber & Boards',
    description: 'Softwood, hardwood, plywood, MDF and blockboard',
    icon: 'tree-pine',
    color: '#92400E',
    sortOrder: 11,
  },
  {
    id: 'cat_fasteners',
    name: 'Fasteners',
    description: 'Coach screws, anchors, rivets, threaded rod and wall plugs',
    icon: 'screwdriver',
    color: '#0891B2',
    sortOrder: 12,
  },
  {
    id: 'cat_safety',
    name: 'Safety Equipment',
    description: 'Helmets, gloves, goggles, boots, harnesses and PPE',
    icon: 'hard-hat',
    color: '#DC2626',
    sortOrder: 13,
  },
  {
    id: 'cat_roofing_acc',
    name: 'Roofing Accessories',
    description: 'Ridges, flashings, gutters, fascia and downpipes',
    icon: 'warehouse',
    color: '#7C3AED',
    sortOrder: 14,
  },
  {
    id: 'cat_adhesives',
    name: 'Adhesives & Sealants',
    description: 'Wood glue, contact adhesive, silicone, putty and tile adhesive',
    icon: 'droplet',
    color: '#059669',
    sortOrder: 15,
  },
];

// -----------------------------------------------------------------------------
// Products
// -----------------------------------------------------------------------------
// All prices are realistic 2026 Kenyan retail prices in KES. costPrice is set
// at roughly 70–85% of the selling price to mirror typical hardware margins.

interface SeedProduct {
  sku: string;
  name: string;
  description: string;
  categoryId: string;
  unitType: string; // PIECE | KILOGRAM | METER | LITER | BAG | BOX | SET | PACKET
  quantityInStock: number;
  reorderLevel: number;
  pricePerUnit: number;
  costPrice: number;
}

const PRODUCTS: SeedProduct[] = [
  // ===========================================================================
  // 1. CEMENT & CONSTRUCTION  (cat_cement)
  // ===========================================================================
  { sku: 'BAM-CEM-50KG', name: 'Bamburi Tembo OPC 50kg', description: 'Bamburi Ordinary Portland Cement 50kg bag', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 220, reorderLevel: 50, pricePerUnit: 780, costPrice: 680 },
  { sku: 'BAM-CEM-25KG', name: 'Bamburi Tembo OPC 25kg', description: 'Bamburi Ordinary Portland Cement 25kg bag', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 120, reorderLevel: 30, pricePerUnit: 420, costPrice: 360 },
  { sku: 'BAM-FND-50KG', name: 'Bamburi Fundi Masonry 50kg', description: 'Bamburi Fundi masonry cement for plaster and mortar', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 90, reorderLevel: 25, pricePerUnit: 720, costPrice: 620 },
  { sku: 'BAM-DUR-50KG', name: 'Bamburi Duracem 50kg', description: 'Bamburi Duracem slag cement for marine and aggressive soils', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 40, reorderLevel: 15, pricePerUnit: 820, costPrice: 710 },
  { sku: 'SIM-CEM-50KG', name: 'Simba OPC 50kg', description: 'National Cement Simba brand OPC 50kg bag', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 180, reorderLevel: 50, pricePerUnit: 740, costPrice: 645 },
  { sku: 'SIM-CEM-25KG', name: 'Simba OPC 25kg', description: 'Simba OPC 25kg bag', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 100, reorderLevel: 30, pricePerUnit: 400, costPrice: 340 },
  { sku: 'SAV-CEM-50KG', name: 'Savanna Cement 50kg', description: 'Savanna (Mombasa Cement) OPC 50kg bag', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 140, reorderLevel: 40, pricePerUnit: 720, costPrice: 625 },
  { sku: 'SAV-CEM-25KG', name: 'Savanna Cement 25kg', description: 'Savanna Cement 25kg bag', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 80, reorderLevel: 25, pricePerUnit: 390, costPrice: 335 },
  { sku: 'BLT-CEM-50KG', name: 'Blue Triangle Cement 50kg', description: 'ARM Cement Blue Triangle OPC 50kg bag', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 110, reorderLevel: 30, pricePerUnit: 730, costPrice: 635 },
  { sku: 'BLT-CEM-25KG', name: 'Blue Triangle Cement 25kg', description: 'Blue Triangle 25kg bag', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 60, reorderLevel: 20, pricePerUnit: 395, costPrice: 340 },
  { sku: 'DAN-CEM-50KG', name: 'Dangote Cement 50kg', description: 'Dangote OPC 42.5N 50kg bag', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 75, reorderLevel: 25, pricePerUnit: 745, costPrice: 650 },
  { sku: 'NAT-CEM-50KG', name: 'National Cement 50kg', description: 'National Cement (Mombasa) 50kg bag', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 65, reorderLevel: 20, pricePerUnit: 725, costPrice: 630 },
  { sku: 'EAP-CEM-50KG', name: 'EAPCC Limestone Cement 50kg', description: 'East African Portland Cement limestone blend 50kg', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 30, reorderLevel: 10, pricePerUnit: 760, costPrice: 660 },
  { sku: 'LIM-CEM-50KG', name: 'Mombasa Limestone Cement 50kg', description: 'Mombasa Cement limestone blend 50kg', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 45, reorderLevel: 15, pricePerUnit: 715, costPrice: 620 },

  // ===========================================================================
  // 2. IRON SHEETS / MABATI  (cat_iron_sheets)
  // ===========================================================================
  // MRM Versatile box profile — gauge 30
  { sku: 'MRM-VER-G30-2M', name: 'MRM Versatile 0.4mm (G30) 2m', description: 'Mabati Rolling Mills Versatile box profile, gauge 30, 2m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 280, reorderLevel: 80, pricePerUnit: 780, costPrice: 660 },
  { sku: 'MRM-VER-G30-2.5M', name: 'MRM Versatile 0.4mm (G30) 2.5m', description: 'MRM Versatile box profile, gauge 30, 2.5m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 240, reorderLevel: 70, pricePerUnit: 950, costPrice: 800 },
  { sku: 'MRM-VER-G30-3M', name: 'MRM Versatile 0.4mm (G30) 3m', description: 'MRM Versatile box profile, gauge 30, 3m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 200, reorderLevel: 60, pricePerUnit: 1150, costPrice: 970 },
  // MRM Versatile — gauge 28 (thicker)
  { sku: 'MRM-VER-G28-2M', name: 'MRM Versatile 0.5mm (G28) 2m', description: 'MRM Versatile, gauge 28, 2m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 160, reorderLevel: 50, pricePerUnit: 950, costPrice: 810 },
  { sku: 'MRM-VER-G28-3M', name: 'MRM Versatile 0.5mm (G28) 3m', description: 'MRM Versatile, gauge 28, 3m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 120, reorderLevel: 40, pricePerUnit: 1380, costPrice: 1180 },
  // MRM Dumuzas (tile profile)
  { sku: 'MRM-DUM-G30-2M', name: 'MRM Dumuzas Tile Profile G30 2m', description: 'MRM Dumuzas tile profile, gauge 30, 2m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 90, reorderLevel: 30, pricePerUnit: 920, costPrice: 780 },
  { sku: 'MRM-DUM-G30-3M', name: 'MRM Dumuzas Tile Profile G30 3m', description: 'MRM Dumuzas tile profile, gauge 30, 3m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 70, reorderLevel: 25, pricePerUnit: 1320, costPrice: 1130 },
  // MRM Orika (tile profile, premium)
  { sku: 'MRM-ORI-G28-3M', name: 'MRM Orika Tile Profile G28 3m', description: 'MRM Orika premium tile profile, gauge 28, 3m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 50, reorderLevel: 20, pricePerUnit: 1480, costPrice: 1260 },
  // MRM Box Profile plain
  { sku: 'MRM-BOX-G30-3M', name: 'MRM Box Profile G30 3m', description: 'MRM classic box profile, gauge 30, 3m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 110, reorderLevel: 35, pricePerUnit: 1180, costPrice: 1000 },
  // Safbuild Versatile
  { sku: 'SAF-VER-G30-3M', name: 'Safbuild Versatile G30 3m', description: 'Safbuild Versatile box profile, gauge 30, 3m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 80, reorderLevel: 25, pricePerUnit: 1080, costPrice: 920 },
  { sku: 'SAF-VER-G28-3M', name: 'Safbuild Versatile G28 3m', description: 'Safbuild Versatile box profile, gauge 28, 3m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 55, reorderLevel: 20, pricePerUnit: 1280, costPrice: 1090 },
  // Royal Mabati
  { sku: 'ROY-BOX-G30-3M', name: 'Royal Mabati Box Profile G30 3m', description: 'Royal Mabati box profile, gauge 30, 3m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 70, reorderLevel: 20, pricePerUnit: 1120, costPrice: 950 },
  { sku: 'ROY-BOX-G30-3M-RED', name: 'Royal Mabati Box Profile G30 3m (Red)', description: 'Royal Mabati pre-painted red box profile, gauge 30, 3m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 60, reorderLevel: 20, pricePerUnit: 1220, costPrice: 1040 },
  { sku: 'ROY-BOX-G30-3M-GRN', name: 'Royal Mabati Box Profile G30 3m (Green)', description: 'Royal Mabati pre-painted green box profile, gauge 30, 3m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 45, reorderLevel: 15, pricePerUnit: 1220, costPrice: 1040 },
  // Ncolor Mabati (coloured)
  { sku: 'NCO-VER-G30-3M-BLU', name: 'Ncolor Versatile G30 3m (Blue)', description: 'Ncolor pre-painted blue Versatile profile, gauge 30, 3m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 35, reorderLevel: 12, pricePerUnit: 1260, costPrice: 1070 },
  // Standard gauge 28 plain
  { sku: 'MBM-MAB-G28-3M', name: 'Plain Mabati G28 3m', description: 'Standard plain corrugated mabati, gauge 28, 3m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 150, reorderLevel: 40, pricePerUnit: 1050, costPrice: 890 },
  { sku: 'MBM-MAB-G30-3M', name: 'Plain Mabati G30 3m', description: 'Standard plain corrugated mabati, gauge 30, 3m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 220, reorderLevel: 60, pricePerUnit: 880, costPrice: 745 },
  { sku: 'MBM-MAB-G32-3M', name: 'Plain Mabati G32 3m', description: 'Light-gauge plain corrugated mabati, gauge 32, 3m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 90, reorderLevel: 30, pricePerUnit: 740, costPrice: 620 },
  { sku: 'MBM-MAB-G30-2M', name: 'Plain Mabati G30 2m', description: 'Standard plain corrugated mabati, gauge 30, 2m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 130, reorderLevel: 40, pricePerUnit: 620, costPrice: 525 },
  { sku: 'MBM-MAB-G28-2M', name: 'Plain Mabati G28 2m', description: 'Standard plain corrugated mabati, gauge 28, 2m length', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 95, reorderLevel: 30, pricePerUnit: 760, costPrice: 645 },

  // ===========================================================================
  // 3. PAINTS  (cat_paints)
  // ===========================================================================
  { sku: 'CRW-VSL-4L', name: 'Crown Vinyl Silk Emulsion 4L', description: 'Crown Vinyl Silk interior emulsion, 4L can', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 80, reorderLevel: 20, pricePerUnit: 1850, costPrice: 1540 },
  { sku: 'CRW-VSL-20L', name: 'Crown Vinyl Silk Emulsion 20L', description: 'Crown Vinyl Silk interior emulsion, 20L drum', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 25, reorderLevel: 8, pricePerUnit: 6800, costPrice: 5700 },
  { sku: 'CRW-WSH-4L', name: 'Crown Weathershield 4L', description: 'Crown Weathershield exterior masonry paint, 4L can', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 60, reorderLevel: 18, pricePerUnit: 2450, costPrice: 2050 },
  { sku: 'CRW-WSH-20L', name: 'Crown Weathershield 20L', description: 'Crown Weathershield exterior masonry paint, 20L drum', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 20, reorderLevel: 6, pricePerUnit: 8900, costPrice: 7500 },
  { sku: 'CRW-PRM-4L', name: 'Crown Wall Primer 4L', description: 'Crown alkaline-resisting wall primer, 4L can', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 50, reorderLevel: 15, pricePerUnit: 1650, costPrice: 1380 },
  { sku: 'CRW-PRM-20L', name: 'Crown Wall Primer 20L', description: 'Crown wall primer, 20L drum', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 15, reorderLevel: 5, pricePerUnit: 5800, costPrice: 4850 },
  { sku: 'DLX-VMT-4L', name: 'Dulux Vinyl Matt 4L', description: 'Dulux Vinyl Matt interior emulsion, 4L can', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 55, reorderLevel: 15, pricePerUnit: 2600, costPrice: 2180 },
  { sku: 'DLX-VMT-20L', name: 'Dulux Vinyl Matt 20L', description: 'Dulux Vinyl Matt interior emulsion, 20L drum', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 18, reorderLevel: 6, pricePerUnit: 9500, costPrice: 8000 },
  { sku: 'DLX-WSH-4L', name: 'Dulux Weathershield 4L', description: 'Dulux Weathershield exterior paint, 4L can', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 50, reorderLevel: 15, pricePerUnit: 2950, costPrice: 2480 },
  { sku: 'DLX-WSH-20L', name: 'Dulux Weathershield 20L', description: 'Dulux Weathershield exterior paint, 20L drum', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 12, reorderLevel: 5, pricePerUnit: 10800, costPrice: 9100 },
  { sku: 'DLX-GLO-4L', name: 'Dulux Gloss Enamel 4L', description: 'Dulux high-gloss enamel for wood and metal, 4L can', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 45, reorderLevel: 12, pricePerUnit: 2800, costPrice: 2350 },
  { sku: 'DLX-UNC-4L', name: 'Dulux Undercoat 4L', description: 'Dulux universal undercoat for enamel systems, 4L can', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 40, reorderLevel: 12, pricePerUnit: 2200, costPrice: 1850 },
  { sku: 'SAF-PNT-4L', name: 'Safari Silk Emulsion 4L', description: 'Safari Paints silk emulsion, 4L can', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 70, reorderLevel: 18, pricePerUnit: 1700, costPrice: 1420 },
  { sku: 'SAF-PNT-20L', name: 'Safari Silk Emulsion 20L', description: 'Safari Paints silk emulsion, 20L drum', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 22, reorderLevel: 6, pricePerUnit: 6200, costPrice: 5200 },
  { sku: 'BRG-EMI-4L', name: 'Berger Luxol Emulsion 4L', description: 'Berger Luxol Silk emulsion, 4L can', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 35, reorderLevel: 10, pricePerUnit: 2400, costPrice: 2010 },
  { sku: 'SLR-EMI-4L', name: 'Solarbird Emulsion 4L', description: 'Solarbird economy interior emulsion, 4L can', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 90, reorderLevel: 20, pricePerUnit: 1400, costPrice: 1160 },

  // ===========================================================================
  // 4. IRON BARS / RODS  (cat_iron_bars)
  // ===========================================================================
  // Devki / Radiant Y-bars, 6m lengths
  { sku: 'DEV-Y08-6M', name: 'Y8 Deformed Bar 6m', description: 'Devki Y8 high-tensile deformed reinforcement bar, 6m length', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 400, reorderLevel: 100, pricePerUnit: 540, costPrice: 460 },
  { sku: 'DEV-Y10-6M', name: 'Y10 Deformed Bar 6m', description: 'Devki Y10 high-tensile deformed bar, 6m length', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 380, reorderLevel: 100, pricePerUnit: 780, costPrice: 660 },
  { sku: 'DEV-Y12-6M', name: 'Y12 Deformed Bar 6m', description: 'Devki Y12 high-tensile deformed bar, 6m length', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 350, reorderLevel: 100, pricePerUnit: 1050, costPrice: 890 },
  { sku: 'DEV-Y16-6M', name: 'Y16 Deformed Bar 6m', description: 'Devki Y16 high-tensile deformed bar, 6m length', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 220, reorderLevel: 60, pricePerUnit: 1850, costPrice: 1570 },
  { sku: 'DEV-Y20-6M', name: 'Y20 Deformed Bar 6m', description: 'Devki Y20 high-tensile deformed bar, 6m length', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 140, reorderLevel: 40, pricePerUnit: 2900, costPrice: 2460 },
  { sku: 'DEV-Y25-6M', name: 'Y25 Deformed Bar 6m', description: 'Devki Y25 high-tensile deformed bar, 6m length', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 80, reorderLevel: 25, pricePerUnit: 4520, costPrice: 3840 },
  { sku: 'DEV-Y12-12M', name: 'Y12 Deformed Bar 12m', description: 'Devki Y12 high-tensile deformed bar, 12m length', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 60, reorderLevel: 20, pricePerUnit: 2100, costPrice: 1780 },
  // Round bars (mild steel)
  { sku: 'MS-R12-6M', name: 'Mild Steel Round Bar 12mm x 6m', description: 'Mild steel round bar 12mm diameter, 6m length', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 120, reorderLevel: 30, pricePerUnit: 920, costPrice: 780 },
  { sku: 'MS-R16-6M', name: 'Mild Steel Round Bar 16mm x 6m', description: 'Mild steel round bar 16mm diameter, 6m length', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 90, reorderLevel: 25, pricePerUnit: 1650, costPrice: 1400 },
  { sku: 'MS-R20-6M', name: 'Mild Steel Round Bar 20mm x 6m', description: 'Mild steel round bar 20mm diameter, 6m length', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 50, reorderLevel: 15, pricePerUnit: 2580, costPrice: 2190 },
  // Square bars
  { sku: 'MS-S16-6M', name: 'Mild Steel Square Bar 16mm x 6m', description: 'Mild steel square bar 16mm, 6m length', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 40, reorderLevel: 12, pricePerUnit: 1480, costPrice: 1260 },
  // Flat bars
  { sku: 'MS-F25X5-6M', name: 'Mild Steel Flat Bar 25x5mm x 6m', description: 'Mild steel flat bar 25x5mm, 6m length', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 110, reorderLevel: 30, pricePerUnit: 980, costPrice: 830 },
  { sku: 'MS-F40X6-6M', name: 'Mild Steel Flat Bar 40x6mm x 6m', description: 'Mild steel flat bar 40x6mm, 6m length', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 70, reorderLevel: 20, pricePerUnit: 1680, costPrice: 1420 },
  // Hollow sections
  { sku: 'MS-H50X50X2-6M', name: 'Square Hollow Section 50x50x2mm x 6m', description: 'Mild steel square hollow section 50x50x2mm, 6m length', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 60, reorderLevel: 18, pricePerUnit: 2950, costPrice: 2500 },
  { sku: 'MS-H76X38-6M', name: 'Rectangular Hollow Section 76x38x1.6mm x 6m', description: 'Rectangular hollow section 76x38x1.6mm, 6m length', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 35, reorderLevel: 10, pricePerUnit: 3680, costPrice: 3120 },

  // ===========================================================================
  // 5. WHEELBARROWS  (cat_wheelbarrows)
  // ===========================================================================
  { sku: 'WHL-STD-85L', name: 'Standard Wheelbarrow 85L', description: "Builder's standard wheelbarrow, 85L steel tray, pneumatic wheel", categoryId: 'cat_wheelbarrows', unitType: 'PIECE', quantityInStock: 25, reorderLevel: 8, pricePerUnit: 5500, costPrice: 4600 },
  { sku: 'WHL-HVY-100L', name: 'Heavy Duty Wheelbarrow 100L', description: 'Heavy-duty wheelbarrow, 100L reinforced tray, 4.00-8 pneumatic wheel', categoryId: 'cat_wheelbarrows', unitType: 'PIECE', quantityInStock: 15, reorderLevel: 5, pricePerUnit: 7500, costPrice: 6300 },
  { sku: 'WHL-GRD-120L', name: 'Garden Cart 120L', description: 'Four-wheel garden cart, 120L capacity, removable sides', categoryId: 'cat_wheelbarrows', unitType: 'PIECE', quantityInStock: 8, reorderLevel: 3, pricePerUnit: 9800, costPrice: 8200 },
  { sku: 'WHL-BLD-90L', name: "Builder's Wheelbarrow 90L", description: "Builder's wheelbarrow with deep tray, 90L, solid rubber wheel option", categoryId: 'cat_wheelbarrows', unitType: 'PIECE', quantityInStock: 18, reorderLevel: 6, pricePerUnit: 6200, costPrice: 5200 },
  { sku: 'WHL-PNE-WHEEL', name: 'Wheelbarrow Pneumatic Wheel 4.00-8', description: 'Replacement pneumatic wheelbarrow wheel 4.00-8 with bearing', categoryId: 'cat_wheelbarrows', unitType: 'PIECE', quantityInStock: 60, reorderLevel: 15, pricePerUnit: 1500, costPrice: 1150 },

  // ===========================================================================
  // 6. MESH WIRES  (cat_mesh_wires)
  // ===========================================================================
  { sku: 'CHN-4FT-30M', name: 'Chain Link Mesh 4ft x 30m', description: 'Galvanised chain link fence mesh, 4ft height, 30m roll', categoryId: 'cat_mesh_wires', unitType: 'PIECE', quantityInStock: 30, reorderLevel: 10, pricePerUnit: 4500, costPrice: 3800 },
  { sku: 'CHN-6FT-30M', name: 'Chain Link Mesh 6ft x 30m', description: 'Galvanised chain link fence mesh, 6ft height, 30m roll', categoryId: 'cat_mesh_wires', unitType: 'PIECE', quantityInStock: 40, reorderLevel: 12, pricePerUnit: 6200, costPrice: 5250 },
  { sku: 'CHN-8FT-30M', name: 'Chain Link Mesh 8ft x 30m', description: 'Galvanised chain link fence mesh, 8ft height, 30m roll', categoryId: 'cat_mesh_wires', unitType: 'PIECE', quantityInStock: 15, reorderLevel: 5, pricePerUnit: 8400, costPrice: 7100 },
  { sku: 'WLD-6X3', name: 'Welded Mesh 6x3ft', description: 'Galvanised welded wire mesh, 6x3ft panel, 1.5mm wire', categoryId: 'cat_mesh_wires', unitType: 'PIECE', quantityInStock: 80, reorderLevel: 20, pricePerUnit: 850, costPrice: 720 },
  { sku: 'WLD-8X4', name: 'Welded Mesh 8x4ft', description: 'Galvanised welded wire mesh, 8x4ft panel, 2mm wire', categoryId: 'cat_mesh_wires', unitType: 'PIECE', quantityInStock: 60, reorderLevel: 18, pricePerUnit: 1450, costPrice: 1230 },
  { sku: 'BRC-A142', name: 'BRC Mesh A142 (6mm) 4.8x2.4m', description: 'BRC welded reinforcement mesh A142, 6mm bars, 4.8x2.4m sheet', categoryId: 'cat_mesh_wires', unitType: 'PIECE', quantityInStock: 45, reorderLevel: 15, pricePerUnit: 2800, costPrice: 2370 },
  { sku: 'BRC-A193', name: 'BRC Mesh A193 (7mm) 4.8x2.4m', description: 'BRC welded reinforcement mesh A193, 7mm bars, 4.8x2.4m sheet', categoryId: 'cat_mesh_wires', unitType: 'PIECE', quantityInStock: 30, reorderLevel: 10, pricePerUnit: 3650, costPrice: 3090 },
  { sku: 'BRC-A252', name: 'BRC Mesh A252 (8mm) 4.8x2.4m', description: 'BRC welded reinforcement mesh A252, 8mm bars, 4.8x2.4m sheet', categoryId: 'cat_mesh_wires', unitType: 'PIECE', quantityInStock: 22, reorderLevel: 8, pricePerUnit: 4700, costPrice: 3980 },
  { sku: 'RZR-18-50M', name: 'Razor Wire 18" x 50m', description: 'Galvanised razor wire concertina, 18 inch coil, 50m length', categoryId: 'cat_mesh_wires', unitType: 'PIECE', quantityInStock: 25, reorderLevel: 8, pricePerUnit: 4200, costPrice: 3550 },
  { sku: 'BRB-1.6-500M', name: 'Barbed Wire 1.6mm x 500m', description: 'Double-strand galvanised barbed wire, 1.6mm wire, 500m coil', categoryId: 'cat_mesh_wires', unitType: 'PIECE', quantityInStock: 18, reorderLevel: 5, pricePerUnit: 5800, costPrice: 4900 },

  // ===========================================================================
  // 7. TOOLS  (cat_tools)
  // ===========================================================================
  { sku: 'TL-HMR-CLW-16', name: 'Claw Hammer 16oz', description: 'Fibreglass-handle claw hammer, 16oz head', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 60, reorderLevel: 15, pricePerUnit: 850, costPrice: 700 },
  { sku: 'TL-HMR-CLW-20', name: 'Claw Hammer 20oz', description: 'Fibreglass-handle claw hammer, 20oz head', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 45, reorderLevel: 12, pricePerUnit: 980, costPrice: 810 },
  { sku: 'TL-HMR-BALL-1KG', name: 'Ball Peen Hammer 1kg', description: 'Ball peen hammer with wooden handle, 1kg head', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 30, reorderLevel: 10, pricePerUnit: 720, costPrice: 595 },
  { sku: 'TL-HMR-SLD-4KG', name: 'Sledge Hammer 4kg', description: 'Sledge hammer with fibreglass handle, 4kg head', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 18, reorderLevel: 6, pricePerUnit: 2450, costPrice: 2050 },
  { sku: 'TL-HMR-SLD-8KG', name: 'Sledge Hammer 8kg', description: 'Sledge hammer with fibreglass handle, 8kg head', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 10, reorderLevel: 4, pricePerUnit: 3650, costPrice: 3050 },
  { sku: 'TL-SDR-SET-6', name: 'Screwdriver Set 6pc', description: '6-piece insulated screwdriver set (3 Phillips + 3 flat)', categoryId: 'cat_tools', unitType: 'SET', quantityInStock: 50, reorderLevel: 15, pricePerUnit: 1200, costPrice: 980 },
  { sku: 'TL-SPN-ADJ-10', name: 'Adjustable Spanner 10"', description: 'Chrome-vanadium adjustable spanner, 10 inch', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 40, reorderLevel: 12, pricePerUnit: 1450, costPrice: 1200 },
  { sku: 'TL-SPN-ADJ-12', name: 'Adjustable Spanner 12"', description: 'Chrome-vanadium adjustable spanner, 12 inch', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 25, reorderLevel: 8, pricePerUnit: 1850, costPrice: 1540 },
  { sku: 'TL-PWR-14', name: 'Pipe Wrench 14"', description: 'Heavy-duty cast iron pipe wrench, 14 inch', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 22, reorderLevel: 8, pricePerUnit: 2200, costPrice: 1850 },
  { sku: 'TL-PWR-18', name: 'Pipe Wrench 18"', description: 'Heavy-duty cast iron pipe wrench, 18 inch', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 15, reorderLevel: 5, pricePerUnit: 2950, costPrice: 2480 },
  { sku: 'TL-HSW-FRM', name: 'Hacksaw Frame 12"', description: 'Adjustable hacksaw frame, 12 inch blade', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 55, reorderLevel: 15, pricePerUnit: 850, costPrice: 700 },
  { sku: 'TL-HSW-BLD-24T', name: 'Hacksaw Blades 24T (10pc)', description: 'Bi-metal hacksaw blades 24 TPI, pack of 10', categoryId: 'cat_tools', unitType: 'PACKET', quantityInStock: 40, reorderLevel: 12, pricePerUnit: 750, costPrice: 600 },
  { sku: 'TL-HSAW-22', name: 'Handsaw 22"', description: 'Hardpoint handsaw 22 inch, 8 TPI for wood', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 35, reorderLevel: 10, pricePerUnit: 1350, costPrice: 1130 },
  { sku: 'TL-MSW-600', name: 'Masonry Saw 600mm', description: 'Masonry / trowel saw blade, 600mm for cutting blocks', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 18, reorderLevel: 6, pricePerUnit: 1650, costPrice: 1380 },
  { sku: 'TL-TAP-5M', name: 'Measuring Tape 5m', description: 'Locking measuring tape, 5m x 25mm blade', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 80, reorderLevel: 20, pricePerUnit: 480, costPrice: 380 },
  { sku: 'TL-TAP-30M', name: "Measuring Tape 30m Open Frame", description: "Open-frame surveyor's measuring tape, 30m", categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 22, reorderLevel: 8, pricePerUnit: 1850, costPrice: 1550 },
  { sku: 'TL-LVL-600', name: 'Spirit Level 24"', description: 'Aluminium spirit level, 24 inch / 600mm, 3 vials', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 30, reorderLevel: 10, pricePerUnit: 1650, costPrice: 1380 },
  { sku: 'TL-LVL-1200', name: 'Spirit Level 48"', description: 'Aluminium spirit level, 48 inch / 1200mm, 3 vials', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 18, reorderLevel: 6, pricePerUnit: 2450, costPrice: 2050 },
  { sku: 'TL-TRL-PNT', name: 'Pointing Trowel', description: 'Bricklaying pointing trowel, 5 inch forged blade', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 70, reorderLevel: 20, pricePerUnit: 450, costPrice: 360 },
  { sku: 'TL-TRL-BRK', name: 'Brick Trowel 11"', description: 'Philadelphia-pattern brick trowel, 11 inch forged blade', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 40, reorderLevel: 12, pricePerUnit: 1250, costPrice: 1040 },
  { sku: 'TL-PLR-CMB', name: 'Combination Pliers 8"', description: 'Insulated combination pliers, 8 inch', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 50, reorderLevel: 15, pricePerUnit: 950, costPrice: 790 },
  { sku: 'TL-PLR-CUT', name: 'Side Cutting Pliers 8"', description: 'Insulated side-cutting pliers, 8 inch', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 45, reorderLevel: 12, pricePerUnit: 1050, costPrice: 880 },
  { sku: 'TL-PLR-NOS', name: 'Long Nose Pliers 6"', description: 'Insulated long-nose pliers, 6 inch', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 50, reorderLevel: 15, pricePerUnit: 850, costPrice: 700 },
  { sku: 'TL-DBT-SET-25', name: 'Masonry Drill Bit Set 25pc', description: '25-piece masonry drill bit set, 4mm-16mm in plastic case', categoryId: 'cat_tools', unitType: 'SET', quantityInStock: 25, reorderLevel: 8, pricePerUnit: 2800, costPrice: 2350 },
  { sku: 'TL-CHS-COLD', name: 'Cold Chisel 3/4"', description: 'Forged cold chisel 3/4 inch, 8 inch length', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 30, reorderLevel: 10, pricePerUnit: 580, costPrice: 470 },
  { sku: 'TL-CRB-5FT', name: 'Crowbar 5ft', description: 'Hexagonal-section wrecking crowbar, 5 foot', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 12, reorderLevel: 4, pricePerUnit: 1950, costPrice: 1630 },

  // ===========================================================================
  // 8. PLUMBING  (cat_plumbing)
  // ===========================================================================
  { sku: 'PVC-0.5-6M', name: 'PVC Pipe 1/2" x 6m', description: 'PVC pressure pipe 1/2 inch, 6m length', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 180, reorderLevel: 40, pricePerUnit: 320, costPrice: 260 },
  { sku: 'PVC-0.75-6M', name: 'PVC Pipe 3/4" x 6m', description: 'PVC pressure pipe 3/4 inch, 6m length', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 160, reorderLevel: 40, pricePerUnit: 420, costPrice: 340 },
  { sku: 'PVC-1-6M', name: 'PVC Pipe 1" x 6m', description: 'PVC pressure pipe 1 inch, 6m length', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 140, reorderLevel: 35, pricePerUnit: 540, costPrice: 440 },
  { sku: 'PVC-2-6M', name: 'PVC Pipe 2" x 6m', description: 'PVC pressure pipe 2 inch, 6m length', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 110, reorderLevel: 30, pricePerUnit: 880, costPrice: 720 },
  { sku: 'PVC-3-6M', name: 'PVC Pipe 3" x 6m', description: 'PVC sewer pipe 3 inch, 6m length', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 80, reorderLevel: 25, pricePerUnit: 1250, costPrice: 1030 },
  { sku: 'PVC-4-6M', name: 'PVC Pipe 4" x 6m', description: 'PVC sewer pipe 4 inch, 6m length', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 90, reorderLevel: 25, pricePerUnit: 1650, costPrice: 1370 },
  { sku: 'PPR-20-4M', name: 'PPR Pipe 20mm x 4m', description: 'Hot/cold PPR pipe 20mm, 4m length', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 70, reorderLevel: 20, pricePerUnit: 480, costPrice: 390 },
  { sku: 'PPR-25-4M', name: 'PPR Pipe 25mm x 4m', description: 'Hot/cold PPR pipe 25mm, 4m length', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 55, reorderLevel: 18, pricePerUnit: 620, costPrice: 510 },
  { sku: 'GI-0.5-6M', name: 'GI Pipe 1/2" x 6m', description: 'Galvanised iron pipe 1/2 inch, 6m length', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 45, reorderLevel: 12, pricePerUnit: 1450, costPrice: 1230 },
  { sku: 'GI-0.75-6M', name: 'GI Pipe 3/4" x 6m', description: 'Galvanised iron pipe 3/4 inch, 6m length', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 38, reorderLevel: 10, pricePerUnit: 1850, costPrice: 1570 },
  { sku: 'ELB-90-PVC-0.5', name: 'PVC Elbow 90 deg 1/2"', description: 'PVC 90-degree elbow, 1/2 inch', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 200, reorderLevel: 50, pricePerUnit: 35, costPrice: 22 },
  { sku: 'ELB-90-PVC-0.75', name: 'PVC Elbow 90 deg 3/4"', description: 'PVC 90-degree elbow, 3/4 inch', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 180, reorderLevel: 50, pricePerUnit: 45, costPrice: 28 },
  { sku: 'TEE-PVC-0.5', name: 'PVC Tee 1/2"', description: 'PVC equal tee, 1/2 inch', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 150, reorderLevel: 40, pricePerUnit: 45, costPrice: 28 },
  { sku: 'VAL-BLL-0.5', name: 'Ball Valve 1/2"', description: 'Brass ball valve, 1/2 inch threaded', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 80, reorderLevel: 20, pricePerUnit: 380, costPrice: 310 },
  { sku: 'VAL-BLL-0.75', name: 'Ball Valve 3/4"', description: 'Brass ball valve, 3/4 inch threaded', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 70, reorderLevel: 20, pricePerUnit: 450, costPrice: 370 },
  { sku: 'TAP-BIB-0.5', name: 'Bib Tap 1/2"', description: 'Heavy-duty brass bib tap, 1/2 inch', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 95, reorderLevel: 25, pricePerUnit: 520, costPrice: 430 },
  { sku: 'TAP-PLR-0.5', name: 'Pillar Tap 1/2" Pair', description: 'Pillar tap pair (hot/cold), 1/2 inch', categoryId: 'cat_plumbing', unitType: 'SET', quantityInStock: 40, reorderLevel: 12, pricePerUnit: 950, costPrice: 790 },
  { sku: 'SOL-PVC-500', name: 'PVC Solvent Cement 500ml', description: 'PVC pipe jointing solvent cement, 500ml tin', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 60, reorderLevel: 18, pricePerUnit: 480, costPrice: 380 },
  { sku: 'TNK-PVC-1000', name: 'PVC Water Tank 1000L', description: 'Vertical PVC water storage tank, 1000L, black', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 12, reorderLevel: 4, pricePerUnit: 12500, costPrice: 10500 },

  // ===========================================================================
  // 9. ELECTRICAL  (cat_electrical)
  // ===========================================================================
  { sku: 'CBL-1.5-100M', name: 'Cable 1.5mm x 100m', description: 'Single-core 1.5mm copper cable, 100m roll', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 35, reorderLevel: 10, pricePerUnit: 5500, costPrice: 4650 },
  { sku: 'CBL-2.5-100M', name: 'Cable 2.5mm x 100m', description: 'Single-core 2.5mm copper cable, 100m roll', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 30, reorderLevel: 10, pricePerUnit: 8500, costPrice: 7200 },
  { sku: 'CBL-4.0-100M', name: 'Cable 4mm x 100m', description: 'Single-core 4mm copper cable, 100m roll', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 20, reorderLevel: 6, pricePerUnit: 12500, costPrice: 10500 },
  { sku: 'CBL-6.0-100M', name: 'Cable 6mm x 100m', description: 'Single-core 6mm copper cable, 100m roll', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 12, reorderLevel: 4, pricePerUnit: 18500, costPrice: 15700 },
  { sku: 'CBL-TWIN-2.5-50M', name: 'Twin & Earth Cable 2.5mm x 50m', description: 'Twin & earth flat cable 2.5mm, 50m roll', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 18, reorderLevel: 6, pricePerUnit: 7200, costPrice: 6100 },
  { sku: 'SWT-1G-WHT', name: '1-Gang 1-Way Switch White', description: '1-gang 1-way rocker switch, white', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 120, reorderLevel: 30, pricePerUnit: 180, costPrice: 130 },
  { sku: 'SWT-2G-WHT', name: '2-Gang 1-Way Switch White', description: '2-gang 1-way rocker switch, white', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 100, reorderLevel: 25, pricePerUnit: 240, costPrice: 180 },
  { sku: 'SOCK-13A-WHT', name: '13A Socket White', description: '13A switched wall socket outlet, white', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 110, reorderLevel: 30, pricePerUnit: 280, costPrice: 215 },
  { sku: 'BLB-LED-9W', name: 'LED Bulb 9W E27', description: 'LED bulb 9W, E27 base, cool white 6500K', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 250, reorderLevel: 60, pricePerUnit: 180, costPrice: 130 },
  { sku: 'BLB-LED-12W', name: 'LED Bulb 12W E27', description: 'LED bulb 12W, E27 base, daylight 6500K', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 200, reorderLevel: 50, pricePerUnit: 240, costPrice: 180 },
  { sku: 'BLB-LED-18W', name: 'LED Bulb 18W E27', description: 'LED bulb 18W, E27 base, daylight 6500K', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 120, reorderLevel: 30, pricePerUnit: 320, costPrice: 245 },
  { sku: 'TUB-LED-4FT', name: 'LED Tube Light 4ft', description: 'LED tube light 4ft / 1200mm, 18W, cool white', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 90, reorderLevel: 25, pricePerUnit: 650, costPrice: 510 },
  { sku: 'CON-20-4M', name: 'Conduit Pipe 20mm x 4m', description: 'Rigid PVC electrical conduit, 20mm, 4m length', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 150, reorderLevel: 40, pricePerUnit: 280, costPrice: 220 },
  { sku: 'CON-25-4M', name: 'Conduit Pipe 25mm x 4m', description: 'Rigid PVC electrical conduit, 25mm, 4m length', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 110, reorderLevel: 30, pricePerUnit: 360, costPrice: 290 },
  { sku: 'JBX-RND-PVC', name: 'Junction Box Round PVC', description: 'Round PVC junction box with lid, 75mm', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 200, reorderLevel: 50, pricePerUnit: 85, costPrice: 60 },
  { sku: 'BRK-32A-1P', name: 'MCB 32A 1-Pole', description: 'Single-pole miniature circuit breaker, 32A, 6kA', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 45, reorderLevel: 12, pricePerUnit: 850, costPrice: 700 },

  // ===========================================================================
  // 10. NAILS & SCREWS  (cat_nails_screws)
  // ===========================================================================
  { sku: 'NAIL-WIRE-2IN-KG', name: 'Wire Nails 2" (per kg)', description: 'Galvanised wire nails 2 inch / 50mm, sold per kg', categoryId: 'cat_nails_screws', unitType: 'KILOGRAM', quantityInStock: 380, reorderLevel: 100, pricePerUnit: 180, costPrice: 130 },
  { sku: 'NAIL-WIRE-3IN-KG', name: 'Wire Nails 3" (per kg)', description: 'Galvanised wire nails 3 inch / 75mm, sold per kg', categoryId: 'cat_nails_screws', unitType: 'KILOGRAM', quantityInStock: 420, reorderLevel: 100, pricePerUnit: 175, costPrice: 125 },
  { sku: 'NAIL-WIRE-4IN-KG', name: 'Wire Nails 4" (per kg)', description: 'Galvanised wire nails 4 inch / 100mm, sold per kg', categoryId: 'cat_nails_screws', unitType: 'KILOGRAM', quantityInStock: 500, reorderLevel: 120, pricePerUnit: 170, costPrice: 120 },
  { sku: 'NAIL-WIRE-5IN-KG', name: 'Wire Nails 5" (per kg)', description: 'Galvanised wire nails 5 inch / 125mm, sold per kg', categoryId: 'cat_nails_screws', unitType: 'KILOGRAM', quantityInStock: 220, reorderLevel: 60, pricePerUnit: 185, costPrice: 135 },
  { sku: 'NAIL-WIRE-6IN-KG', name: 'Wire Nails 6" (per kg)', description: 'Galvanised wire nails 6 inch / 150mm, sold per kg', categoryId: 'cat_nails_screws', unitType: 'KILOGRAM', quantityInStock: 90, reorderLevel: 30, pricePerUnit: 200, costPrice: 150 },
  { sku: 'NAIL-PNL-25MM-BOX', name: 'Panel Pins 25mm (Box)', description: 'Steel panel pins 25mm, 500g box', categoryId: 'cat_nails_screws', unitType: 'BOX', quantityInStock: 80, reorderLevel: 20, pricePerUnit: 320, costPrice: 240 },
  { sku: 'NAIL-PNL-40MM-BOX', name: 'Panel Pins 40mm (Box)', description: 'Steel panel pins 40mm, 500g box', categoryId: 'cat_nails_screws', unitType: 'BOX', quantityInStock: 70, reorderLevel: 18, pricePerUnit: 360, costPrice: 280 },
  { sku: 'NAIL-ROOF-2.5IN-KG', name: 'Roofing Nails 2.5" (per kg)', description: 'Umbrella-head galvanised roofing nails with washer, 2.5 inch, per kg', categoryId: 'cat_nails_screws', unitType: 'KILOGRAM', quantityInStock: 180, reorderLevel: 50, pricePerUnit: 240, costPrice: 195 },
  { sku: 'SCR-WD-1IN-BOX', name: 'Wood Screws 1" (Box)', description: 'Phillips wood screws 1 inch, 200pc box', categoryId: 'cat_nails_screws', unitType: 'BOX', quantityInStock: 60, reorderLevel: 18, pricePerUnit: 540, costPrice: 420 },
  { sku: 'SCR-WD-1.5IN-BOX', name: 'Wood Screws 1.5" (Box)', description: 'Phillips wood screws 1.5 inch, 200pc box', categoryId: 'cat_nails_screws', unitType: 'BOX', quantityInStock: 55, reorderLevel: 15, pricePerUnit: 620, costPrice: 490 },
  { sku: 'SCR-DWL-35MM-BOX', name: 'Drywall Screws 3.5x35mm (Box)', description: 'Phosphate-coated drywall screws 3.5x35mm, 1000pc box', categoryId: 'cat_nails_screws', unitType: 'BOX', quantityInStock: 70, reorderLevel: 20, pricePerUnit: 980, costPrice: 780 },
  { sku: 'BLT-M8-100MM', name: 'Hex Bolt M8 x 100mm', description: 'Galvanised hex head bolt M8 x 100mm with nut', categoryId: 'cat_nails_screws', unitType: 'PIECE', quantityInStock: 250, reorderLevel: 60, pricePerUnit: 65, costPrice: 45 },
  { sku: 'BLT-M10-100MM', name: 'Hex Bolt M10 x 100mm', description: 'Galvanised hex head bolt M10 x 100mm with nut', categoryId: 'cat_nails_screws', unitType: 'PIECE', quantityInStock: 220, reorderLevel: 50, pricePerUnit: 95, costPrice: 70 },
  { sku: 'WSH-M10-100PC', name: 'Flat Washers M10 (100pc)', description: 'Galvanised flat washers M10, 100pc pack', categoryId: 'cat_nails_screws', unitType: 'PACKET', quantityInStock: 90, reorderLevel: 25, pricePerUnit: 280, costPrice: 215 },

  // ===========================================================================
  // 11. TIMBER & BOARDS  (cat_timber)  [NEW CATEGORY]
  // ===========================================================================
  { sku: 'CYP-2X2-14FT', name: 'Cypress 2x2 x 14ft', description: 'Seasoned cypress timber 2x2 inch, 14ft length', categoryId: 'cat_timber', unitType: 'PIECE', quantityInStock: 180, reorderLevel: 50, pricePerUnit: 320, costPrice: 260 },
  { sku: 'CYP-2X4-14FT', name: 'Cypress 2x4 x 14ft', description: 'Seasoned cypress timber 2x4 inch, 14ft length', categoryId: 'cat_timber', unitType: 'PIECE', quantityInStock: 140, reorderLevel: 40, pricePerUnit: 580, costPrice: 480 },
  { sku: 'CYP-4X2-14FT', name: 'Cypress 4x2 x 14ft', description: 'Seasoned cypress timber 4x2 inch, 14ft length', categoryId: 'cat_timber', unitType: 'PIECE', quantityInStock: 130, reorderLevel: 40, pricePerUnit: 580, costPrice: 480 },
  { sku: 'CYP-6X1-14FT', name: 'Cypress 6x1 x 14ft', description: 'Seasoned cypress timber 6x1 inch, 14ft length (planking)', categoryId: 'cat_timber', unitType: 'PIECE', quantityInStock: 110, reorderLevel: 30, pricePerUnit: 680, costPrice: 565 },
  { sku: 'CYP-4X4-14FT', name: 'Cypress 4x4 x 14ft', description: 'Seasoned cypress timber 4x4 inch, 14ft length (post)', categoryId: 'cat_timber', unitType: 'PIECE', quantityInStock: 60, reorderLevel: 18, pricePerUnit: 1180, costPrice: 985 },
  { sku: 'PIN-4X2-14FT', name: 'Pine 4x2 x 14ft', description: 'Seasoned pine timber 4x2 inch, 14ft length', categoryId: 'cat_timber', unitType: 'PIECE', quantityInStock: 80, reorderLevel: 25, pricePerUnit: 520, costPrice: 430 },
  { sku: 'PLY-9MM-8X4', name: 'Plywood 9mm 8x4ft', description: 'Commercial plywood 9mm thickness, 8x4ft sheet', categoryId: 'cat_timber', unitType: 'PIECE', quantityInStock: 70, reorderLevel: 20, pricePerUnit: 2200, costPrice: 1850 },
  { sku: 'PLY-12MM-8X4', name: 'Plywood 12mm 8x4ft', description: 'Commercial plywood 12mm thickness, 8x4ft sheet', categoryId: 'cat_timber', unitType: 'PIECE', quantityInStock: 65, reorderLevel: 18, pricePerUnit: 2680, costPrice: 2250 },
  { sku: 'PLY-18MM-8X4', name: 'Plywood 18mm 8x4ft', description: 'Commercial plywood 18mm thickness, 8x4ft sheet', categoryId: 'cat_timber', unitType: 'PIECE', quantityInStock: 50, reorderLevel: 15, pricePerUnit: 3650, costPrice: 3080 },
  { sku: 'MDF-9MM-8X4', name: 'MDF Board 9mm 8x4ft', description: 'Standard MDF board 9mm thickness, 8x4ft sheet', categoryId: 'cat_timber', unitType: 'PIECE', quantityInStock: 45, reorderLevel: 12, pricePerUnit: 2350, costPrice: 1970 },
  { sku: 'MDF-18MM-8X4', name: 'MDF Board 18mm 8x4ft', description: 'Standard MDF board 18mm thickness, 8x4ft sheet', categoryId: 'cat_timber', unitType: 'PIECE', quantityInStock: 38, reorderLevel: 12, pricePerUnit: 3850, costPrice: 3250 },
  { sku: 'BLB-18MM-8X4', name: 'Blockboard 18mm 8x4ft', description: 'Blockboard 18mm thickness, 8x4ft sheet', categoryId: 'cat_timber', unitType: 'PIECE', quantityInStock: 30, reorderLevel: 10, pricePerUnit: 4250, costPrice: 3580 },
  { sku: 'HDB-3MM-8X4', name: 'Hardboard 3mm 8x4ft', description: 'Tempered hardboard 3mm thickness, 8x4ft sheet', categoryId: 'cat_timber', unitType: 'PIECE', quantityInStock: 55, reorderLevel: 15, pricePerUnit: 1450, costPrice: 1220 },

  // ===========================================================================
  // 12. FASTENERS  (cat_fasteners)  [NEW CATEGORY]
  // ===========================================================================
  { sku: 'FST-CS-6X50-BOX', name: 'Coach Screws 6x50mm (Box 50)', description: 'Hex-head coach screws 6x50mm, box of 50', categoryId: 'cat_fasteners', unitType: 'BOX', quantityInStock: 60, reorderLevel: 18, pricePerUnit: 780, costPrice: 640 },
  { sku: 'FST-CS-8X60-BOX', name: 'Coach Screws 8x60mm (Box 50)', description: 'Hex-head coach screws 8x60mm, box of 50', categoryId: 'cat_fasteners', unitType: 'BOX', quantityInStock: 50, reorderLevel: 15, pricePerUnit: 980, costPrice: 810 },
  { sku: 'FST-CS-10X100-BOX', name: 'Coach Screws 10x100mm (Box 25)', description: 'Hex-head coach screws 10x100mm, box of 25', categoryId: 'cat_fasteners', unitType: 'BOX', quantityInStock: 35, reorderLevel: 10, pricePerUnit: 1250, costPrice: 1040 },
  { sku: 'FST-CRB-M10-100', name: 'Carriage Bolts M10 x 100mm (Box 50)', description: 'Domed-head carriage bolts M10 x 100mm with nuts, box of 50', categoryId: 'cat_fasteners', unitType: 'BOX', quantityInStock: 40, reorderLevel: 12, pricePerUnit: 1480, costPrice: 1240 },
  { sku: 'FST-TR-M10-1M', name: 'Threaded Rod M10 x 1m', description: 'Zinc-plated threaded rod M10, 1m length', categoryId: 'cat_fasteners', unitType: 'PIECE', quantityInStock: 90, reorderLevel: 25, pricePerUnit: 380, costPrice: 310 },
  { sku: 'FST-WPL-8MM-100', name: 'Wall Plugs 8mm (Packet 100)', description: 'Nylon wall plugs 8mm, packet of 100', categoryId: 'cat_fasteners', unitType: 'PACKET', quantityInStock: 120, reorderLevel: 30, pricePerUnit: 320, costPrice: 240 },
  { sku: 'FST-AB-M12-100', name: 'Anchor Bolt M12 x 100mm', description: 'Wedge anchor bolt M12 x 100mm for concrete', categoryId: 'cat_fasteners', unitType: 'PIECE', quantityInStock: 150, reorderLevel: 40, pricePerUnit: 120, costPrice: 90 },
  { sku: 'FST-HWA-BOX', name: 'Hollow Wall Anchors (Box 50)', description: 'Cavity wall anchors M8, box of 50 with screws', categoryId: 'cat_fasteners', unitType: 'BOX', quantityInStock: 55, reorderLevel: 15, pricePerUnit: 920, costPrice: 760 },

  // ===========================================================================
  // 13. SAFETY EQUIPMENT  (cat_safety)  [NEW CATEGORY]
  // ===========================================================================
  { sku: 'SAF-HLM-YEL', name: 'Safety Helmet Yellow', description: 'ABS safety helmet with ratchet harness, yellow', categoryId: 'cat_safety', unitType: 'PIECE', quantityInStock: 60, reorderLevel: 18, pricePerUnit: 850, costPrice: 700 },
  { sku: 'SAF-HLM-WHT', name: 'Safety Helmet White', description: 'ABS safety helmet with ratchet harness, white', categoryId: 'cat_safety', unitType: 'PIECE', quantityInStock: 55, reorderLevel: 18, pricePerUnit: 850, costPrice: 700 },
  { sku: 'SAF-HLM-RED', name: 'Safety Helmet Red', description: 'ABS safety helmet with ratchet harness, red', categoryId: 'cat_safety', unitType: 'PIECE', quantityInStock: 40, reorderLevel: 12, pricePerUnit: 850, costPrice: 700 },
  { sku: 'SAF-GLV-LTR', name: 'Leather Gloves Pair', description: 'Cowhide leather work gloves, pair', categoryId: 'cat_safety', unitType: 'PIECE', quantityInStock: 120, reorderLevel: 30, pricePerUnit: 480, costPrice: 380 },
  { sku: 'SAF-GLV-CNV', name: 'Canvas Gloves Pair', description: 'Heavy-duty canvas work gloves with PVC dots, pair', categoryId: 'cat_safety', unitType: 'PIECE', quantityInStock: 150, reorderLevel: 40, pricePerUnit: 220, costPrice: 170 },
  { sku: 'SAF-GLV-RBR', name: 'Rubber Gloves Pair', description: 'Chemical-resistant rubber gloves, pair', categoryId: 'cat_safety', unitType: 'PIECE', quantityInStock: 80, reorderLevel: 20, pricePerUnit: 380, costPrice: 300 },
  { sku: 'SAF-GGL-CLR', name: 'Safety Goggles Clear', description: 'Polycarbonate impact-resistant safety goggles, clear', categoryId: 'cat_safety', unitType: 'PIECE', quantityInStock: 90, reorderLevel: 25, pricePerUnit: 350, costPrice: 270 },
  { sku: 'SAF-BOT-9', name: 'Safety Boots Size 9', description: 'Steel-toe safety boots with steel midsole, size 9', categoryId: 'cat_safety', unitType: 'PIECE', quantityInStock: 30, reorderLevel: 10, pricePerUnit: 2800, costPrice: 2350 },
  { sku: 'SAF-BOT-10', name: 'Safety Boots Size 10', description: 'Steel-toe safety boots with steel midsole, size 10', categoryId: 'cat_safety', unitType: 'PIECE', quantityInStock: 30, reorderLevel: 10, pricePerUnit: 2800, costPrice: 2350 },
  { sku: 'SAF-VST-REF', name: 'Reflective Vest', description: 'Hi-vis reflective safety vest, yellow with 2" tape', categoryId: 'cat_safety', unitType: 'PIECE', quantityInStock: 70, reorderLevel: 20, pricePerUnit: 450, costPrice: 350 },
  { sku: 'SAF-MSK-N95-20', name: 'N95 Dust Masks (Packet 20)', description: 'N95 particulate respirator masks, packet of 20', categoryId: 'cat_safety', unitType: 'PACKET', quantityInStock: 50, reorderLevel: 15, pricePerUnit: 950, costPrice: 760 },
  { sku: 'SAF-HRS-FUL', name: 'Full Body Harness', description: 'Full-body fall arrest harness with dorsal D-ring', categoryId: 'cat_safety', unitType: 'PIECE', quantityInStock: 15, reorderLevel: 5, pricePerUnit: 4800, costPrice: 4050 },

  // ===========================================================================
  // 14. ROOFING ACCESSORIES  (cat_roofing_acc)  [NEW CATEGORY]
  // ===========================================================================
  { sku: 'ROF-RDG-1M', name: 'Ridge Cap 1m', description: 'Galvanised ridge cap for corrugated/profiled sheets, 1m length', categoryId: 'cat_roofing_acc', unitType: 'PIECE', quantityInStock: 120, reorderLevel: 30, pricePerUnit: 650, costPrice: 545 },
  { sku: 'ROF-APR-3M', name: 'Apron Flashing 3m', description: 'Galvanised apron flashing, 3m length', categoryId: 'cat_roofing_acc', unitType: 'PIECE', quantityInStock: 60, reorderLevel: 18, pricePerUnit: 980, costPrice: 825 },
  { sku: 'ROF-VLY-3M', name: 'Valley Gutter 3m', description: 'Galvanised valley gutter, 3m length', categoryId: 'cat_roofing_acc', unitType: 'PIECE', quantityInStock: 40, reorderLevel: 12, pricePerUnit: 1250, costPrice: 1050 },
  { sku: 'ROF-VRG-3M', name: 'Verge Flashing 3m', description: 'Galvanised verge flashing, 3m length', categoryId: 'cat_roofing_acc', unitType: 'PIECE', quantityInStock: 35, reorderLevel: 10, pricePerUnit: 1100, costPrice: 925 },
  { sku: 'ROF-END-CAP', name: 'Ridge End Cap', description: 'Galvanised ridge end cap, fits MRM/Safbuild profiles', categoryId: 'cat_roofing_acc', unitType: 'PIECE', quantityInStock: 80, reorderLevel: 20, pricePerUnit: 280, costPrice: 215 },
  { sku: 'ROF-GUT-4IN-4M', name: 'PVC Gutter 4" x 4m', description: 'PVC rainwater gutter, 4 inch, 4m length', categoryId: 'cat_roofing_acc', unitType: 'PIECE', quantityInStock: 90, reorderLevel: 25, pricePerUnit: 850, costPrice: 710 },
  { sku: 'ROF-GBR-4IN', name: 'Gutter Bracket 4"', description: 'PVC gutter bracket / fascia bracket, 4 inch', categoryId: 'cat_roofing_acc', unitType: 'PIECE', quantityInStock: 200, reorderLevel: 50, pricePerUnit: 85, costPrice: 60 },
  { sku: 'ROF-DPN-3IN-4M', name: 'Downpipe 3" x 4m', description: 'PVC rainwater downpipe, 3 inch, 4m length', categoryId: 'cat_roofing_acc', unitType: 'PIECE', quantityInStock: 80, reorderLevel: 20, pricePerUnit: 780, costPrice: 650 },
  { sku: 'ROF-SCR-BOX', name: 'Roofing Screws 5.5x65mm (Box 250)', description: 'Self-drilling roofing screws 5.5x65mm with EPDM washer, box of 250', categoryId: 'cat_roofing_acc', unitType: 'BOX', quantityInStock: 50, reorderLevel: 15, pricePerUnit: 1850, costPrice: 1550 },
  { sku: 'ROF-FLT-1M', name: 'Roofing Felt 1m wide (per m)', description: 'Underlay bituminous roofing felt, 1m wide, sold per linear metre', categoryId: 'cat_roofing_acc', unitType: 'METER', quantityInStock: 150, reorderLevel: 40, pricePerUnit: 220, costPrice: 175 },

  // ===========================================================================
  // 15. ADHESIVES & SEALANTS  (cat_adhesives)  [NEW CATEGORY]
  // ===========================================================================
  { sku: 'ADH-WGD-500ML', name: 'Wood Glue 500ml', description: 'PVA wood glue, water-resistant, 500ml bottle', categoryId: 'cat_adhesives', unitType: 'PIECE', quantityInStock: 90, reorderLevel: 25, pricePerUnit: 480, costPrice: 380 },
  { sku: 'ADH-WGD-1L', name: 'Wood Glue 1L', description: 'PVA wood glue, water-resistant, 1L bottle', categoryId: 'cat_adhesives', unitType: 'PIECE', quantityInStock: 70, reorderLevel: 20, pricePerUnit: 820, costPrice: 650 },
  { sku: 'ADH-WGD-5L', name: 'Wood Glue 5L', description: 'PVA wood glue, water-resistant, 5L jerrycan', categoryId: 'cat_adhesives', unitType: 'PIECE', quantityInStock: 25, reorderLevel: 8, pricePerUnit: 3200, costPrice: 2680 },
  { sku: 'ADH-CTC-500ML', name: 'Contact Adhesive 500ml', description: 'Synthetic rubber contact adhesive, 500ml tin', categoryId: 'cat_adhesives', unitType: 'PIECE', quantityInStock: 80, reorderLevel: 20, pricePerUnit: 720, costPrice: 590 },
  { sku: 'ADH-CTC-4L', name: 'Contact Adhesive 4L', description: 'Synthetic rubber contact adhesive, 4L tin', categoryId: 'cat_adhesives', unitType: 'PIECE', quantityInStock: 30, reorderLevel: 10, pricePerUnit: 4200, costPrice: 3520 },
  { sku: 'ADH-SLC-CLR-280', name: 'Silicone Sealant Clear 280ml', description: 'Acetic-cure silicone sealant, clear, 280ml cartridge', categoryId: 'cat_adhesives', unitType: 'PIECE', quantityInStock: 110, reorderLevel: 30, pricePerUnit: 580, costPrice: 460 },
  { sku: 'ADH-SLC-WHT-280', name: 'Silicone Sealant White 280ml', description: 'Acetic-cure silicone sealant, white, 280ml cartridge', categoryId: 'cat_adhesives', unitType: 'PIECE', quantityInStock: 100, reorderLevel: 30, pricePerUnit: 580, costPrice: 460 },
  { sku: 'ADH-PTY-5KG', name: 'Wall Putty 5kg', description: 'Interior wall putty powder, 5kg bag', categoryId: 'cat_adhesives', unitType: 'BAG', quantityInStock: 60, reorderLevel: 18, pricePerUnit: 980, costPrice: 810 },
  { sku: 'ADH-TLE-20KG', name: 'Tile Adhesive 20kg', description: 'Cement-based ceramic tile adhesive, 20kg bag', categoryId: 'cat_adhesives', unitType: 'BAG', quantityInStock: 45, reorderLevel: 15, pricePerUnit: 1850, costPrice: 1550 },
  { sku: 'ADH-WPR-5L', name: 'Waterproofing Compound 5L', description: 'Liquid waterproofing additive for mortar, 5L jerrycan', categoryId: 'cat_adhesives', unitType: 'PIECE', quantityInStock: 28, reorderLevel: 10, pricePerUnit: 2600, costPrice: 2180 },
  { sku: 'ADH-GUN', name: 'Caulking Gun', description: 'Heavy-duty skeleton caulking gun for 280-310ml cartridges', categoryId: 'cat_adhesives', unitType: 'PIECE', quantityInStock: 50, reorderLevel: 15, pricePerUnit: 580, costPrice: 460 },
];

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const startedAt = Date.now();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' MBUMAH Hardware POS — Bulk Hardware Catalog Seed');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` Store:          ${STORE_ID}`);
  console.log(` Products:       ${PRODUCTS.length} SKUs defined`);
  console.log(` New categories: ${NEW_CATEGORIES.length}`);
  console.log('');

  // ---------------------------------------------------------------------------
  // 1. Upsert new categories
  // ---------------------------------------------------------------------------
  console.log(`Creating ${NEW_CATEGORIES.length} new categories...`);
  let categoriesCreated = 0;
  for (const cat of NEW_CATEGORIES) {
    try {
      await db.productCategory.upsert({
        where: { id: cat.id },
        update: {
          name: cat.name,
          description: cat.description,
          icon: cat.icon,
          color: cat.color,
          sortOrder: cat.sortOrder,
          isActive: true,
        },
        create: {
          id: cat.id,
          storeId: STORE_ID,
          name: cat.name,
          description: cat.description,
          icon: cat.icon,
          color: cat.color,
          sortOrder: cat.sortOrder,
          isActive: true,
        },
      });
      categoriesCreated++;
    } catch (err) {
      console.warn(`  ⚠ Failed to upsert category '${cat.id}' (${cat.name}):`, (err as Error).message);
    }
  }
  console.log(`  ✓ ${categoriesCreated}/${NEW_CATEGORIES.length} categories ready.`);

  // ---------------------------------------------------------------------------
  // 2. Find which SKUs already exist so we can skip them (idempotency)
  // ---------------------------------------------------------------------------
  const allSkus = PRODUCTS.map(p => p.sku);
  const existing = await db.product.findMany({
    where: { sku: { in: allSkus } },
    select: { sku: true },
  });
  const existingSkus = new Set(existing.map(r => r.sku));
  const toInsert = PRODUCTS.filter(p => !existingSkus.has(p.sku));
  console.log('');
  console.log(`Inserting ${toInsert.length} products (${existingSkus.size} already exist, skipped)...`);

  // ---------------------------------------------------------------------------
  // 3. Insert products one-by-one with per-item error isolation.
  //    createMany would be faster but does not surface per-row errors and
  //    would fail the whole batch on the first unique-constraint violation.
  // ---------------------------------------------------------------------------
  let created = 0;
  let failed = 0;
  for (let i = 0; i < toInsert.length; i++) {
    const p = toInsert[i];
    const seed = i + 1; // stable barcode seed
    try {
      await db.product.create({
        data: {
          id: `prod_bulk_${String(seed).padStart(3, '0')}`,
          storeId: STORE_ID,
          categoryId: p.categoryId,
          sku: p.sku,
          barcode: genBarcode(seed),
          name: p.name,
          description: p.description,
          unitType: p.unitType,
          quantityInStock: p.quantityInStock,
          reorderLevel: p.reorderLevel,
          pricePerUnit: p.pricePerUnit,
          costPrice: p.costPrice,
          taxRate: 16,
          isRental: false,
          isBundle: false,
          isActive: true,
        },
      });
      created++;
    } catch (err) {
      // Most likely a unique-constraint violation on sku or barcode from a
      // previous partial run. Log and continue — the script stays idempotent.
      failed++;
      console.warn(`  ⚠ Failed to insert '${p.sku}' (${p.name}):`, (err as Error).message);
    }
  }
  const skipped = existingSkus.size;

  // ---------------------------------------------------------------------------
  // 4. Summary
  // ---------------------------------------------------------------------------
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Done!');
  console.log('──────────────────────────────────────────────────────────────');
  console.log(`  Categories upserted : ${categoriesCreated}/${NEW_CATEGORIES.length}`);
  console.log(`  Products created    : ${created}`);
  console.log(`  Products skipped    : ${skipped}  (already existed)`);
  console.log(`  Products failed     : ${failed}  (see warnings above)`);
  console.log(`  Total in catalog    : ${PRODUCTS.length}`);
  console.log(`  Elapsed             : ${elapsed}s`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((err) => {
    console.error('❌ Bulk seed failed catastrophically:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
