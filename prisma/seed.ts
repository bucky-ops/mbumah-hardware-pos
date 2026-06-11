/**
 * MBUMAH HARDWARE POS - Database Seed Script
 * Automated initialization: seeds Super Admin, demo store, products, and accounts
 * Runs on first boot if no users exist
 */

import { PrismaClient } from '@prisma/client';
import { hash } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 MBUMAH HARDWARE POS - Checking initialization status...');

  // Check if already initialized
  const userCount = await prisma.user.count();

  if (userCount > 0) {
    console.log('✅ Database already initialized. Skipping seed.');
    return;
  }

  console.log('📋 First boot detected. Initializing system...');

  // 1. Create Organization
  const org = await prisma.organization.create({
    data: {
      id: 'org_mbumah',
      name: 'MBUMAH HARDWARE',
      taxPin: 'P051234567A',
      status: 'ACTIVE',
    },
  });

  // 2. Create Store
  const store = await prisma.store.create({
    data: {
      id: 'store_juja_main',
      organizationId: org.id,
      name: 'MBUMAH HARDWARE - Juja Main',
      location: 'Salama M-Store, Juja',
      address: 'P.O. Box 9101-00300, Nairobi',
      phone: '0795191909',
      email: 'info@mbumahhardware.co.ke',
      taxPin: 'P051234567A',
      status: 'ACTIVE',
    },
  });

  // 3. Seed Super Admin
  const adminPasswordHash = 'hashed_password123_2024'; // In production, use bcrypt
  const superAdmin = await prisma.user.create({
    data: {
      id: 'user_super_admin',
      organizationId: org.id,
      storeId: store.id,
      email: 'admin@mbumahhardware.co.ke',
      name: 'System Administrator',
      passwordHash: adminPasswordHash,
      role: 'SUPER_ADMIN',
      phone: '0795191909',
      isActive: true,
    },
  });

  // 4. Seed additional demo users
  const cashier = await prisma.user.create({
    data: {
      id: 'user_cashier_1',
      organizationId: org.id,
      storeId: store.id,
      email: 'cashier@mbumahhardware.co.ke',
      name: 'Grace Wanjiku',
      passwordHash: 'hashed_password123_2024',
      role: 'CASHIER',
      phone: '0759963601',
      isActive: true,
    },
  });

  const accountant = await prisma.user.create({
    data: {
      id: 'user_accountant_1',
      organizationId: org.id,
      storeId: store.id,
      email: 'accountant@mbumahhardware.co.ke',
      name: 'James Otieno',
      passwordHash: 'hashed_password123_2024',
      role: 'ACCOUNTANT',
      phone: '0787485104',
      isActive: true,
    },
  });

  // 5. Seed RBAC Permissions
  const permissions = [
    // SUPER_ADMIN has all
    ...['products', 'transactions', 'customers', 'financials', 'rentals', 'admin', 'reports', 'debt'].flatMap(resource =>
      ['create', 'read', 'update', 'delete', 'approve', 'refund', 'export', 'void', 'manage_users', 'manage_stores', 'system_config', 'write_off', 'remind', 'adjust'].map(action => ({
        role: 'SUPER_ADMIN' as string,
        resource,
        action,
      }))
    ),
    // CASHIER basic permissions
    { role: 'CASHIER', resource: 'products', action: 'read' },
    { role: 'CASHIER', resource: 'transactions', action: 'create' },
    { role: 'CASHIER', resource: 'transactions', action: 'read' },
    { role: 'CASHIER', resource: 'customers', action: 'read' },
    // ACCOUNTANT permissions
    { role: 'ACCOUNTANT', resource: 'financials', action: 'read' },
    { role: 'ACCOUNTANT', resource: 'financials', action: 'export' },
    { role: 'ACCOUNTANT', resource: 'reports', action: 'read' },
    { role: 'ACCOUNTANT', resource: 'debt', action: 'read' },
    { role: 'ACCOUNTANT', resource: 'debt', action: 'update' },
  ];

  for (const perm of permissions) {
    await prisma.rolePermission.upsert({
      where: { role_resource_action: { role: perm.role, resource: perm.resource, action: perm.action } },
      update: {},
      create: perm,
    });
  }

  // 6. Seed Product Categories
  const categories = await Promise.all([
    prisma.productCategory.create({ data: { id: 'cat_cement', storeId: store.id, name: 'Cement', description: 'All types of cement', icon: 'building', color: '#8B7355', sortOrder: 1 } }),
    prisma.productCategory.create({ data: { id: 'cat_iron_sheets', storeId: store.id, name: 'Iron Sheets', description: 'Roofing iron sheets', icon: 'layout-grid', color: '#4A5568', sortOrder: 2 } }),
    prisma.productCategory.create({ data: { id: 'cat_paints', storeId: store.id, name: 'Paints', description: 'Interior and exterior paints', icon: 'palette', color: '#E53E3E', sortOrder: 3 } }),
    prisma.productCategory.create({ data: { id: 'cat_iron_bars', storeId: store.id, name: 'Iron Bars', description: 'Reinforcement iron bars', icon: 'minus', color: '#718096', sortOrder: 4 } }),
    prisma.productCategory.create({ data: { id: 'cat_wheelbarrows', storeId: store.id, name: 'Wheelbarrows', description: 'Wheelbarrows and carts', icon: 'shopping-cart', color: '#DD6B20', sortOrder: 5 } }),
    prisma.productCategory.create({ data: { id: 'cat_mesh_wires', storeId: store.id, name: 'Mesh Wires', description: 'Chain link and mesh wires', icon: 'grid-3x3', color: '#A0AEC0', sortOrder: 6 } }),
    prisma.productCategory.create({ data: { id: 'cat_tools', storeId: store.id, name: 'Tools', description: 'Construction tools and equipment', icon: 'wrench', color: '#2D3748', sortOrder: 7 } }),
    prisma.productCategory.create({ data: { id: 'cat_plumbing', storeId: store.id, name: 'Plumbing', description: 'Pipes, fittings, and plumbing supplies', icon: 'droplets', color: '#3182CE', sortOrder: 8 } }),
    prisma.productCategory.create({ data: { id: 'cat_electrical', storeId: store.id, name: 'Electrical', description: 'Wiring, switches, and electrical supplies', icon: 'zap', color: '#ECC94B', sortOrder: 9 } }),
    prisma.productCategory.create({ data: { id: 'cat_nails_screws', storeId: store.id, name: 'Nails & Screws', description: 'Fasteners, nails, and screws', icon: 'pin', color: '#38A169', sortOrder: 10 } }),
  ]);

  // 7. Seed Products
  const products = [
    // Cement
    { id: 'prod_cement_bamburi', sku: 'MBM-CEM-0001', name: 'Bamburi Cement 50kg', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 200, pricePerUnit: 750, costPrice: 680, reorderLevel: 50 },
    { id: 'prod_cement_simba', sku: 'MBM-CEM-0002', name: 'Simba Cement 50kg', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 150, pricePerUnit: 720, costPrice: 650, reorderLevel: 50 },
    { id: 'prod_cement_savanna', sku: 'MBM-CEM-0003', name: 'Savanna Cement 50kg', categoryId: 'cat_cement', unitType: 'BAG', quantityInStock: 100, pricePerUnit: 700, costPrice: 620, reorderLevel: 30 },
    // Iron Sheets
    { id: 'prod_mabati_30', sku: 'MBM-IRS-0001', name: 'Mabati 30-Gauge (8ft)', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 500, pricePerUnit: 650, costPrice: 580, reorderLevel: 100 },
    { id: 'prod_mabati_28', sku: 'MBM-IRS-0002', name: 'Mabati 28-Gauge (8ft)', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 300, pricePerUnit: 800, costPrice: 720, reorderLevel: 80 },
    { id: 'prod_mabati_26', sku: 'MBM-IRS-0003', name: 'Mabati 26-Gauge (8ft)', categoryId: 'cat_iron_sheets', unitType: 'PIECE', quantityInStock: 200, pricePerUnit: 950, costPrice: 860, reorderLevel: 50 },
    // Paints
    { id: 'prod_dulux_20l', sku: 'MBM-PNT-0001', name: 'Dulux Weathershield 20L', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 30, pricePerUnit: 8500, costPrice: 7200, reorderLevel: 10 },
    { id: 'prod_crown_20l', sku: 'MBM-PNT-0002', name: 'Crown Vinyl Silk 20L', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 25, pricePerUnit: 6500, costPrice: 5500, reorderLevel: 8 },
    { id: 'prod_dulux_4l', sku: 'MBM-PNT-0003', name: 'Dulux Weathershield 4L', categoryId: 'cat_paints', unitType: 'PIECE', quantityInStock: 60, pricePerUnit: 2400, costPrice: 2000, reorderLevel: 20 },
    // Iron Bars
    { id: 'prod_rebar_12mm', sku: 'MBM-IRB-0001', name: 'Rebar 12mm x 12m', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 400, pricePerUnit: 1200, costPrice: 1050, reorderLevel: 100 },
    { id: 'prod_rebar_10mm', sku: 'MBM-IRB-0002', name: 'Rebar 10mm x 12m', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 350, pricePerUnit: 900, costPrice: 780, reorderLevel: 100 },
    { id: 'prod_rebar_8mm', sku: 'MBM-IRB-0003', name: 'Rebar 8mm x 12m', categoryId: 'cat_iron_bars', unitType: 'PIECE', quantityInStock: 500, pricePerUnit: 650, costPrice: 560, reorderLevel: 150 },
    // Wheelbarrows
    { id: 'prod_wheelbarrow_std', sku: 'MBM-WHL-0001', name: 'Standard Wheelbarrow', categoryId: 'cat_wheelbarrows', unitType: 'PIECE', quantityInStock: 15, pricePerUnit: 5500, costPrice: 4500, reorderLevel: 5 },
    { id: 'prod_wheelbarrow_heavy', sku: 'MBM-WHL-0002', name: 'Heavy Duty Wheelbarrow', categoryId: 'cat_wheelbarrows', unitType: 'PIECE', quantityInStock: 10, pricePerUnit: 7500, costPrice: 6000, reorderLevel: 3 },
    // Mesh Wires
    { id: 'prod_chainlink_6ft', sku: 'MBM-MSH-0001', name: 'Chain Link 6ft x 50m', categoryId: 'cat_mesh_wires', unitType: 'PIECE', quantityInStock: 40, pricePerUnit: 4500, costPrice: 3800, reorderLevel: 10 },
    { id: 'prod_welded_mesh', sku: 'MBM-MSH-0002', name: 'Welded Mesh 8x4ft', categoryId: 'cat_mesh_wires', unitType: 'PIECE', quantityInStock: 60, pricePerUnit: 1800, costPrice: 1500, reorderLevel: 20 },
    // Tools (Rental Items)
    { id: 'prod_concrete_mixer', sku: 'MBM-TL-0001', name: 'Concrete Mixer', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 5, pricePerUnit: 85000, costPrice: 65000, isRental: true, reorderLevel: 1 },
    { id: 'prod_vibrator', sku: 'MBM-TL-0002', name: 'Poker Vibrator', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 4, pricePerUnit: 35000, costPrice: 25000, isRental: true, reorderLevel: 1 },
    { id: 'prod_scaffolding', sku: 'MBM-TL-0003', name: 'Scaffolding Set', categoryId: 'cat_tools', unitType: 'SET', quantityInStock: 10, pricePerUnit: 25000, costPrice: 18000, isRental: true, reorderLevel: 2 },
    { id: 'prod_spade', sku: 'MBM-TL-0004', name: 'Spade (Heavy Duty)', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 50, pricePerUnit: 1200, costPrice: 900, reorderLevel: 15 },
    { id: 'prod_pickaxe', sku: 'MBM-TL-0005', name: 'Pickaxe', categoryId: 'cat_tools', unitType: 'PIECE', quantityInStock: 30, pricePerUnit: 1000, costPrice: 750, reorderLevel: 10 },
    // Plumbing
    { id: 'prod_pvc_4inch', sku: 'MBM-PLM-0001', name: 'PVC Pipe 4-inch x 3m', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 100, pricePerUnit: 800, costPrice: 600, reorderLevel: 30 },
    { id: 'prod_pvc_2inch', sku: 'MBM-PLM-0002', name: 'PVC Pipe 2-inch x 3m', categoryId: 'cat_plumbing', unitType: 'PIECE', quantityInStock: 150, pricePerUnit: 400, costPrice: 300, reorderLevel: 40 },
    // Electrical
    { id: 'prod_cable_2_5mm', sku: 'MBM-ELC-0001', name: 'Cable 2.5mm x 100m', categoryId: 'cat_electrical', unitType: 'PIECE', quantityInStock: 30, pricePerUnit: 8500, costPrice: 7000, reorderLevel: 10 },
    // Nails & Screws (fractional quantity items)
    { id: 'prod_nails_4inch', sku: 'MBM-NAS-0001', name: '4-inch Nails', categoryId: 'cat_nails_screws', unitType: 'KILOGRAM', quantityInStock: 500, pricePerUnit: 150, costPrice: 110, reorderLevel: 100 },
    { id: 'prod_nails_3inch', sku: 'MBM-NAS-0002', name: '3-inch Nails', categoryId: 'cat_nails_screws', unitType: 'KILOGRAM', quantityInStock: 450, pricePerUnit: 140, costPrice: 100, reorderLevel: 100 },
    { id: 'prod_nails_2inch', sku: 'MBM-NAS-0003', name: '2-inch Nails', categoryId: 'cat_nails_screws', unitType: 'KILOGRAM', quantityInStock: 400, pricePerUnit: 130, costPrice: 95, reorderLevel: 100 },
    { id: 'prod_screws_wood', sku: 'MBM-NAS-0004', name: 'Wood Screws Assorted (Box)', categoryId: 'cat_nails_screws', unitType: 'BOX', quantityInStock: 80, pricePerUnit: 500, costPrice: 380, reorderLevel: 20 },
  ];

  for (const product of products) {
    await prisma.product.create({ data: { ...product, storeId: store.id } as any });
  }

  // 8. Seed Product Bundle - "Construction Starter Kit"
  const bundleProduct = await prisma.product.create({
    data: {
      id: 'prod_construction_kit',
      sku: 'MBM-BDL-0001',
      name: 'Construction Starter Kit',
      description: 'Complete kit: 5 bags cement, 2 spades, 5kg 4-inch nails, 1 wheelbarrow',
      storeId: store.id,
      categoryId: 'cat_cement',
      unitType: 'SET',
      quantityInStock: 999,
      pricePerUnit: 8950,
      costPrice: 7090,
      isBundle: true,
      reorderLevel: 0,
    },
  });

  await prisma.productBundle.createMany({
    data: [
      { parentProductId: bundleProduct.id, childProductId: 'prod_cement_bamburi', quantityRequired: 5 },
      { parentProductId: bundleProduct.id, childProductId: 'prod_spade', quantityRequired: 2 },
      { parentProductId: bundleProduct.id, childProductId: 'prod_nails_4inch', quantityRequired: 5 },
      { parentProductId: bundleProduct.id, childProductId: 'prod_wheelbarrow_std', quantityRequired: 1 },
    ],
  });

  // 9. Seed Demo Customers
  const customers = [
    { id: 'cust_1', storeId: store.id, name: 'John Kamau', phone: '0722123456', email: 'john.kamau@email.com', idNumber: '12345678', debtLimit: 100000, currentDebtBalance: 0 },
    { id: 'cust_2', storeId: store.id, name: 'Mary Njeri', phone: '0733234567', email: 'mary.njeri@email.com', idNumber: '23456789', debtLimit: 50000, currentDebtBalance: 15000 },
    { id: 'cust_3', storeId: store.id, name: 'Peter Odhiambo', phone: '0745345678', email: 'peter.o@email.com', idNumber: '34567890', debtLimit: 200000, currentDebtBalance: 45000 },
    { id: 'cust_4', storeId: store.id, name: 'Akinyi Builders Ltd', phone: '0756456789', email: 'info@akinyibuilders.co.ke', idNumber: '45678901', debtLimit: 500000, currentDebtBalance: 120000 },
    { id: 'cust_5', storeId: store.id, name: 'Fatima Hassan', phone: '0767567890', email: 'fatima.h@email.com', idNumber: '56789012', debtLimit: 30000, currentDebtBalance: 5000 },
  ];

  for (const cust of customers) {
    await prisma.customer.create({ data: cust });
  }

  // 10. Seed Chart of Accounts
  const accounts = [
    { organizationId: org.id, code: '1000', name: 'Cash on Hand', type: 'ASSET', subType: 'CURRENT_ASSET', normalBalance: 'DEBIT' },
    { organizationId: org.id, code: '1100', name: 'M-Pesa Account', type: 'ASSET', subType: 'CURRENT_ASSET', normalBalance: 'DEBIT' },
    { organizationId: org.id, code: '1200', name: 'Accounts Receivable', type: 'ASSET', subType: 'CURRENT_ASSET', normalBalance: 'DEBIT' },
    { organizationId: org.id, code: '1300', name: 'Inventory', type: 'ASSET', subType: 'CURRENT_ASSET', normalBalance: 'DEBIT' },
    { organizationId: org.id, code: '1400', name: 'Rental Deposits Held', type: 'ASSET', subType: 'CURRENT_ASSET', normalBalance: 'DEBIT' },
    { organizationId: org.id, code: '2000', name: 'Accounts Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { organizationId: org.id, code: '2100', name: 'VAT Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { organizationId: org.id, code: '2200', name: 'Customer Deposits', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { organizationId: org.id, code: '3000', name: 'Owner Equity', type: 'EQUITY', subType: 'OWNERS_EQUITY', normalBalance: 'CREDIT' },
    { organizationId: org.id, code: '3100', name: 'Retained Earnings', type: 'EQUITY', subType: 'RETAINED_EARNINGS', normalBalance: 'CREDIT' },
    { organizationId: org.id, code: '4000', name: 'Sales Revenue', type: 'REVENUE', subType: 'OPERATING_REVENUE', normalBalance: 'CREDIT' },
    { organizationId: org.id, code: '4100', name: 'Rental Revenue', type: 'REVENUE', subType: 'OPERATING_REVENUE', normalBalance: 'CREDIT' },
    { organizationId: org.id, code: '4200', name: 'Late Fee Revenue', type: 'REVENUE', subType: 'OTHER_REVENUE', normalBalance: 'CREDIT' },
    { organizationId: org.id, code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE', subType: 'COST_OF_SALES', normalBalance: 'DEBIT' },
    { organizationId: org.id, code: '5100', name: 'Rent Expense', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT' },
    { organizationId: org.id, code: '5200', name: 'Salaries Expense', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT' },
    { organizationId: org.id, code: '5300', name: 'Utilities Expense', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT' },
    { organizationId: org.id, code: '5400', name: 'Bad Debt Expense', type: 'EXPENSE', subType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT' },
  ];

  for (const acct of accounts) {
    await prisma.account.create({ data: acct });
  }

  // 11. Seed Demo Debt Ledgers
  await prisma.debtLedger.createMany({
    data: [
      { id: 'debt_1', storeId: store.id, customerId: 'cust_2', amountOwed: 15000, amountPaid: 0, balance: 15000, dueDate: new Date('2024-12-15'), status: 'OUTSTANDING', agingBucket: 'DAYS_60' },
      { id: 'debt_2', storeId: store.id, customerId: 'cust_3', amountOwed: 45000, amountPaid: 0, balance: 45000, dueDate: new Date('2024-11-01'), status: 'OVERDUE', agingBucket: 'DAYS_90_PLUS' },
      { id: 'debt_3', storeId: store.id, customerId: 'cust_4', amountOwed: 120000, amountPaid: 30000, balance: 90000, dueDate: new Date('2025-01-30'), status: 'PARTIAL', agingBucket: 'DAYS_30' },
      { id: 'debt_4', storeId: store.id, customerId: 'cust_5', amountOwed: 5000, amountPaid: 0, balance: 5000, dueDate: new Date('2025-02-28'), status: 'OUTSTANDING', agingBucket: 'CURRENT' },
    ],
  });

  // 12. Seed Demo Rentals
  await prisma.equipmentRental.createMany({
    data: [
      {
        id: 'rental_1', storeId: store.id, productId: 'prod_concrete_mixer', customerId: 'cust_3',
        status: 'ACTIVE', rentalStartDate: new Date('2024-12-01'), expectedReturnDate: new Date('2025-01-01'),
        securityDeposit: 10000, ratePerDay: 3000, totalRentalCharge: 93000, lateFeeAccumulated: 0
      },
      {
        id: 'rental_2', storeId: store.id, productId: 'prod_scaffolding', customerId: 'cust_4',
        status: 'OVERDUE', rentalStartDate: new Date('2024-11-15'), expectedReturnDate: new Date('2024-12-15'),
        securityDeposit: 15000, ratePerDay: 1500, totalRentalCharge: 45000, lateFeeAccumulated: 15000
      },
    ],
  });

  // 13. Log the initialization event
  await prisma.initializationLog.create({
    data: {
      event: 'SYSTEM_INITIALIZED',
      details: 'MBUMAH HARDWARE POS system initialized with default Super Admin, demo store, products, and accounts.',
    },
  });

  await prisma.systemLog.create({
    data: {
      storeId: store.id,
      userId: superAdmin.id,
      action: 'SYSTEM_INITIALIZED',
      component: 'SYSTEM',
      severity: 'INFO',
      message: 'System initialized successfully with seed data',
      metadata: JSON.stringify({ orgId: org.id, storeId: store.id, adminId: superAdmin.id }),
    },
  });

  console.log('✅ MBUMAH HARDWARE POS - System initialized successfully!');
  console.log('   📧 Super Admin: admin@mbumahhardware.co.ke');
  console.log('   🏪 Store: MBUMAH HARDWARE - Juja Main');
  console.log('   📦 Products seeded: ' + products.length + 1);
  console.log('   👥 Customers seeded: ' + customers.length);
  console.log('   📊 Accounts seeded: ' + accounts.length);
}

main()
  .catch(e => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
