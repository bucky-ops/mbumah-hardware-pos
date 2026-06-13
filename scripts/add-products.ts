import { db } from '../src/lib/db';

const storeId = 'store_juja_main';

const newProducts = [
  { sku: 'MBM-CEM-0004', name: 'Mombasa Cement 50kg', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 80, pricePerUnit: 710, costPrice: 630, reorderLevel: 30 },
  { sku: 'MBM-CEM-0005', name: 'Portland Cement 50kg', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 120, pricePerUnit: 690, costPrice: 600, reorderLevel: 40 },
  { sku: 'MBM-IRS-0004', name: 'Mabati 32-Gauge (8ft)', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 400, pricePerUnit: 550, costPrice: 480, reorderLevel: 100 },
  { sku: 'MBM-IRS-0005', name: 'Mabati Colored 30-Gauge (8ft)', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 250, pricePerUnit: 750, costPrice: 650, reorderLevel: 60 },
  { sku: 'MBM-PNT-0004', name: 'Crown Budjet 20L', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 40, pricePerUnit: 5200, costPrice: 4300, reorderLevel: 15 },
  { sku: 'MBM-PNT-0005', name: 'Dulux Velvet Touch 4L', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 45, pricePerUnit: 2800, costPrice: 2300, reorderLevel: 15 },
  { sku: 'MBM-PNT-0006', name: 'Hempel Undercoat 20L', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 15, pricePerUnit: 6000, costPrice: 5000, reorderLevel: 5 },
  { sku: 'MBM-IRB-0004', name: 'Rebar 16mm x 12m', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 200, pricePerUnit: 1800, costPrice: 1550, reorderLevel: 60 },
  { sku: 'MBM-IRB-0005', name: 'Rebar 20mm x 12m', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 150, pricePerUnit: 2800, costPrice: 2400, reorderLevel: 40 },
  { sku: 'MBM-IRB-0006', name: 'Flat Bar 3x1 inch x 6m', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 80, pricePerUnit: 1500, costPrice: 1250, reorderLevel: 25 },
  { sku: 'MBM-PLM-0003', name: 'GI Pipe 1-inch x 3m', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 60, pricePerUnit: 1200, costPrice: 950, reorderLevel: 20 },
  { sku: 'MBM-PLM-0004', name: 'PVC Elbow 4-inch', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 200, pricePerUnit: 120, costPrice: 80, reorderLevel: 50 },
  { sku: 'MBM-PLM-0005', name: 'Water Tank 1000L', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 8, pricePerUnit: 9500, costPrice: 7500, reorderLevel: 3 },
  { sku: 'MBM-ELC-0002', name: 'Cable 1.5mm x 100m', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 40, pricePerUnit: 5500, costPrice: 4500, reorderLevel: 12 },
  { sku: 'MBM-ELC-0003', name: 'Switch Socket (Double)', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 100, pricePerUnit: 350, costPrice: 250, reorderLevel: 30 },
  { sku: 'MBM-ELC-0004', name: 'DB Box 8-Way', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 15, pricePerUnit: 2800, costPrice: 2100, reorderLevel: 5 },
  { sku: 'MBM-ELC-0005', name: 'Conduit Pipe 20mm x 3m', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 120, pricePerUnit: 120, costPrice: 85, reorderLevel: 30 },
  { sku: 'MBM-NAS-0002', name: '2-inch Nails', categoryId: 'cat_nails_screws', unitType: 'KILOGRAM', quantityInStock: 400, pricePerUnit: 130, costPrice: 95, reorderLevel: 100 },
  { sku: 'MBM-NAS-0003', name: '6-inch Nails', categoryId: 'cat_nails_screws', unitType: 'KILOGRAM', quantityInStock: 300, pricePerUnit: 170, costPrice: 130, reorderLevel: 80 },
  { sku: 'MBM-NAS-0004', name: 'Wood Screws 3-inch (Box 200)', categoryId: 'cat_nails_screws', unitType: 'BOX', quantityInStock: 50, pricePerUnit: 800, costPrice: 600, reorderLevel: 15 },
  { sku: 'MBM-TL-0006', name: 'Hacksaw Frame', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 25, pricePerUnit: 800, costPrice: 600, reorderLevel: 8 },
  { sku: 'MBM-TL-0007', name: 'Tape Measure 30m', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 40, pricePerUnit: 600, costPrice: 400, reorderLevel: 12 },
  { sku: 'MBM-TL-0008', name: 'Spirit Level 60cm', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 20, pricePerUnit: 1500, costPrice: 1100, reorderLevel: 8 },
  { sku: 'MBM-MSH-0003', name: 'Binding Wire 1kg', categoryId: 'cat_mesh_wires', unitType: 'KILOGRAM', quantityInStock: 200, pricePerUnit: 200, costPrice: 150, reorderLevel: 50 },
  { sku: 'MBM-MSH-0004', name: 'Barbed Wire 50m Roll', categoryId: 'cat_mesh_wires', unitType: 'PIECE', quantityInStock: 25, pricePerUnit: 3200, costPrice: 2700, reorderLevel: 8 },
  { sku: 'MBM-MSH-0005', name: 'Chicken Wire 1m x 30m', categoryId: 'cat_mesh_wires', unitType: 'PIECE', quantityInStock: 30, pricePerUnit: 2500, costPrice: 2000, reorderLevel: 10 },
  { sku: 'MBM-CEM-0006', name: 'Sand (Per Ton)', categoryId: 'cat_cement', unitType: 'KILOGRAM', quantityInStock: 50000, pricePerUnit: 2000, costPrice: 1500, reorderLevel: 10000 },
  { sku: 'MBM-CEM-0007', name: 'Ballast (Per Ton)', categoryId: 'cat_cement', unitType: 'KILOGRAM', quantityInStock: 40000, pricePerUnit: 2500, costPrice: 1800, reorderLevel: 8000 },
];

async function main() {
  let added = 0;
  for (const product of newProducts) {
    try {
      await db.product.create({
        data: { ...product, storeId } as any,
      });
      added++;
      console.log(`Added: ${product.name}`);
    } catch (e: any) {
      if (e.code === 'P2002') console.log(`Skip: ${product.sku}`);
      else console.error(`Error: ${product.name}: ${e.message}`);
    }
  }
  console.log(`\nDone! Added ${added} new products.`);
}

main().catch(console.error);
