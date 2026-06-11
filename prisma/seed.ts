/**
 * MBUMAH HARDWARE POS - Database Seed Script
 * Automated initialization: seeds Super Admin, demo store, products, and accounts
 * Runs on first boot if no users exist
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Helper: generate a date N days ago
function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

// Helper: generate a date N days ago at a specific hour
function daysAgoAtHour(n: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, Math.floor(Math.random() * 50) + 5, Math.floor(Math.random() * 60), 0);
  return d;
}

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

  // 9. Seed Demo Customers (expanded with more variety)
  const customers = [
    { id: 'cust_1', storeId: store.id, name: 'John Kamau', phone: '0722123456', email: 'john.kamau@email.com', idNumber: '12345678', debtLimit: 100000, currentDebtBalance: 0 },
    { id: 'cust_2', storeId: store.id, name: 'Mary Njeri', phone: '0733234567', email: 'mary.njeri@email.com', idNumber: '23456789', debtLimit: 50000, currentDebtBalance: 15000 },
    { id: 'cust_3', storeId: store.id, name: 'Peter Odhiambo', phone: '0745345678', email: 'peter.o@email.com', idNumber: '34567890', debtLimit: 200000, currentDebtBalance: 45000 },
    { id: 'cust_4', storeId: store.id, name: 'Akinyi Builders Ltd', phone: '0756456789', email: 'info@akinyibuilders.co.ke', idNumber: '45678901', debtLimit: 500000, currentDebtBalance: 120000 },
    { id: 'cust_5', storeId: store.id, name: 'Fatima Hassan', phone: '0767567890', email: 'fatima.h@email.com', idNumber: '56789012', debtLimit: 30000, currentDebtBalance: 5000 },
    // Additional customers with various debt states
    { id: 'cust_6', storeId: store.id, name: 'Samuel Mwangi', phone: '0711223344', email: 'samuel.m@email.com', idNumber: '67890123', debtLimit: 80000, currentDebtBalance: 32000 },
    { id: 'cust_7', storeId: store.id, name: 'Grace Achieng', phone: '0722334455', email: 'grace.a@email.com', idNumber: '78901234', debtLimit: 40000, currentDebtBalance: 0 },
    { id: 'cust_8', storeId: store.id, name: 'Nairobi Contractors Co.', phone: '0733445566', email: 'info@nairobiddeners.co.ke', idNumber: '89012345', debtLimit: 750000, currentDebtBalance: 250000 },
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

  // ==========================================================================
  // 11. SEED SALES TRANSACTIONS (15-20 over past 7 days)
  // ==========================================================================
  console.log('📋 Seeding sales transactions...');

  const salesData: {
    id: string; receiptNumber: string; customerId: string | null; cashierId: string;
    subtotal: number; taxAmount: number; discountAmount: number; totalAmount: number;
    paymentMethod: string; paymentStatus: string; transactionType: string;
    createdAt: Date; items: { productId: string; productName: string; quantity: number; unitType: string; pricePerUnit: number; costPrice: number; lineTotal: number }[];
  }[] = [
    {
      id: 'tx_001', receiptNumber: 'MBM-RCPT-001', customerId: 'cust_1', cashierId: 'user_cashier_1',
      subtotal: 7500, taxAmount: 1200, discountAmount: 0, totalAmount: 8700,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(0, 10),
      items: [
        { productId: 'prod_cement_bamburi', productName: 'Bamburi Cement 50kg', quantity: 10, unitType: 'BAG', pricePerUnit: 750, costPrice: 680, lineTotal: 7500 },
      ],
    },
    {
      id: 'tx_002', receiptNumber: 'MBM-RCPT-002', customerId: 'cust_4', cashierId: 'user_cashier_1',
      subtotal: 45000, taxAmount: 7200, discountAmount: 2000, totalAmount: 50200,
      paymentMethod: 'MPESA', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(0, 11),
      items: [
        { productId: 'prod_rebar_12mm', productName: 'Rebar 12mm x 12m', quantity: 30, unitType: 'PIECE', pricePerUnit: 1200, costPrice: 1050, lineTotal: 36000 },
        { productId: 'prod_mabati_30', productName: 'Mabati 30-Gauge (8ft)', quantity: 15, unitType: 'PIECE', pricePerUnit: 650, costPrice: 580, lineTotal: 9750 },
      ],
    },
    {
      id: 'tx_003', receiptNumber: 'MBM-RCPT-003', customerId: null, cashierId: 'user_cashier_1',
      subtotal: 3250, taxAmount: 520, discountAmount: 0, totalAmount: 3770,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(1, 9),
      items: [
        { productId: 'prod_nails_4inch', productName: '4-inch Nails', quantity: 10, unitType: 'KILOGRAM', pricePerUnit: 150, costPrice: 110, lineTotal: 1500 },
        { productId: 'prod_nails_3inch', productName: '3-inch Nails', quantity: 5, unitType: 'KILOGRAM', pricePerUnit: 140, costPrice: 100, lineTotal: 700 },
        { productId: 'prod_screws_wood', productName: 'Wood Screws Assorted (Box)', quantity: 2, unitType: 'BOX', pricePerUnit: 500, costPrice: 380, lineTotal: 1000 },
      ],
    },
    {
      id: 'tx_004', receiptNumber: 'MBM-RCPT-004', customerId: 'cust_3', cashierId: 'user_cashier_1',
      subtotal: 28000, taxAmount: 4480, discountAmount: 1000, totalAmount: 31480,
      paymentMethod: 'DEBT', paymentStatus: 'PARTIAL', transactionType: 'SALE',
      createdAt: daysAgoAtHour(1, 14),
      items: [
        { productId: 'prod_cement_simba', productName: 'Simba Cement 50kg', quantity: 20, unitType: 'BAG', pricePerUnit: 720, costPrice: 650, lineTotal: 14400 },
        { productId: 'prod_rebar_10mm', productName: 'Rebar 10mm x 12m', quantity: 15, unitType: 'PIECE', pricePerUnit: 900, costPrice: 780, lineTotal: 13500 },
      ],
    },
    {
      id: 'tx_005', receiptNumber: 'MBM-RCPT-005', customerId: 'cust_5', cashierId: 'user_super_admin',
      subtotal: 17000, taxAmount: 2720, discountAmount: 0, totalAmount: 19720,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(2, 10),
      items: [
        { productId: 'prod_dulux_20l', productName: 'Dulux Weathershield 20L', quantity: 2, unitType: 'PIECE', pricePerUnit: 8500, costPrice: 7200, lineTotal: 17000 },
      ],
    },
    {
      id: 'tx_006', receiptNumber: 'MBM-RCPT-006', customerId: null, cashierId: 'user_cashier_1',
      subtotal: 5500, taxAmount: 880, discountAmount: 0, totalAmount: 6380,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(2, 15),
      items: [
        { productId: 'prod_wheelbarrow_std', productName: 'Standard Wheelbarrow', quantity: 1, unitType: 'PIECE', pricePerUnit: 5500, costPrice: 4500, lineTotal: 5500 },
      ],
    },
    {
      id: 'tx_007', receiptNumber: 'MBM-RCPT-007', customerId: 'cust_6', cashierId: 'user_cashier_1',
      subtotal: 36000, taxAmount: 5760, discountAmount: 1500, totalAmount: 40260,
      paymentMethod: 'MPESA', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(3, 8),
      items: [
        { productId: 'prod_chainlink_6ft', productName: 'Chain Link 6ft x 50m', quantity: 8, unitType: 'PIECE', pricePerUnit: 4500, costPrice: 3800, lineTotal: 36000 },
      ],
    },
    {
      id: 'tx_008', receiptNumber: 'MBM-RCPT-008', customerId: null, cashierId: 'user_cashier_1',
      subtotal: 8500, taxAmount: 1360, discountAmount: 0, totalAmount: 9860,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(3, 12),
      items: [
        { productId: 'prod_cable_2_5mm', productName: 'Cable 2.5mm x 100m', quantity: 1, unitType: 'PIECE', pricePerUnit: 8500, costPrice: 7000, lineTotal: 8500 },
      ],
    },
    {
      id: 'tx_009', receiptNumber: 'MBM-RCPT-009', customerId: 'cust_8', cashierId: 'user_super_admin',
      subtotal: 48000, taxAmount: 7680, discountAmount: 3000, totalAmount: 52680,
      paymentMethod: 'DEBT', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(3, 16),
      items: [
        { productId: 'prod_cement_bamburi', productName: 'Bamburi Cement 50kg', quantity: 40, unitType: 'BAG', pricePerUnit: 750, costPrice: 680, lineTotal: 30000 },
        { productId: 'prod_rebar_12mm', productName: 'Rebar 12mm x 12m', quantity: 15, unitType: 'PIECE', pricePerUnit: 1200, costPrice: 1050, lineTotal: 18000 },
      ],
    },
    {
      id: 'tx_010', receiptNumber: 'MBM-RCPT-010', customerId: 'cust_1', cashierId: 'user_cashier_1',
      subtotal: 13000, taxAmount: 2080, discountAmount: 0, totalAmount: 15080,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(4, 9),
      items: [
        { productId: 'prod_mabati_28', productName: 'Mabati 28-Gauge (8ft)', quantity: 10, unitType: 'PIECE', pricePerUnit: 800, costPrice: 720, lineTotal: 8000 },
        { productId: 'prod_crown_20l', productName: 'Crown Vinyl Silk 20L', quantity: 1, unitType: 'PIECE', pricePerUnit: 6500, costPrice: 5500, lineTotal: 6500 },
      ],
    },
    {
      id: 'tx_011', receiptNumber: 'MBM-RCPT-011', customerId: null, cashierId: 'user_cashier_1',
      subtotal: 9500, taxAmount: 1520, discountAmount: 0, totalAmount: 11020,
      paymentMethod: 'MPESA', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(4, 14),
      items: [
        { productId: 'prod_mabati_26', productName: 'Mabati 26-Gauge (8ft)', quantity: 10, unitType: 'PIECE', pricePerUnit: 950, costPrice: 860, lineTotal: 9500 },
      ],
    },
    {
      id: 'tx_012', receiptNumber: 'MBM-RCPT-012', customerId: 'cust_7', cashierId: 'user_cashier_1',
      subtotal: 22000, taxAmount: 3520, discountAmount: 1000, totalAmount: 24520,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(5, 10),
      items: [
        { productId: 'prod_welded_mesh', productName: 'Welded Mesh 8x4ft', quantity: 10, unitType: 'PIECE', pricePerUnit: 1800, costPrice: 1500, lineTotal: 18000 },
        { productId: 'prod_pvc_4inch', productName: 'PVC Pipe 4-inch x 3m', quantity: 5, unitType: 'PIECE', pricePerUnit: 800, costPrice: 600, lineTotal: 4000 },
      ],
    },
    {
      id: 'tx_013', receiptNumber: 'MBM-RCPT-013', customerId: 'cust_2', cashierId: 'user_super_admin',
      subtotal: 2400, taxAmount: 384, discountAmount: 0, totalAmount: 2784,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(5, 16),
      items: [
        { productId: 'prod_dulux_4l', productName: 'Dulux Weathershield 4L', quantity: 1, unitType: 'PIECE', pricePerUnit: 2400, costPrice: 2000, lineTotal: 2400 },
      ],
    },
    {
      id: 'tx_014', receiptNumber: 'MBM-RCPT-014', customerId: null, cashierId: 'user_cashier_1',
      subtotal: 6800, taxAmount: 1088, discountAmount: 0, totalAmount: 7888,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(6, 9),
      items: [
        { productId: 'prod_pvc_2inch', productName: 'PVC Pipe 2-inch x 3m', quantity: 10, unitType: 'PIECE', pricePerUnit: 400, costPrice: 300, lineTotal: 4000 },
        { productId: 'prod_spade', productName: 'Spade (Heavy Duty)', quantity: 2, unitType: 'PIECE', pricePerUnit: 1200, costPrice: 900, lineTotal: 2400 },
        { productId: 'prod_pickaxe', productName: 'Pickaxe', quantity: 1, unitType: 'PIECE', pricePerUnit: 1000, costPrice: 750, lineTotal: 1000 },
      ],
    },
    {
      id: 'tx_015', receiptNumber: 'MBM-RCPT-015', customerId: 'cust_4', cashierId: 'user_cashier_1',
      subtotal: 50400, taxAmount: 8064, discountAmount: 5000, totalAmount: 53464,
      paymentMethod: 'SPLIT', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(6, 13),
      items: [
        { productId: 'prod_cement_bamburi', productName: 'Bamburi Cement 50kg', quantity: 50, unitType: 'BAG', pricePerUnit: 750, costPrice: 680, lineTotal: 37500 },
        { productId: 'prod_rebar_8mm', productName: 'Rebar 8mm x 12m', quantity: 20, unitType: 'PIECE', pricePerUnit: 650, costPrice: 560, lineTotal: 13000 },
      ],
    },
    {
      id: 'tx_016', receiptNumber: 'MBM-RCPT-016', customerId: null, cashierId: 'user_cashier_1',
      subtotal: 1200, taxAmount: 192, discountAmount: 0, totalAmount: 1392,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(6, 17),
      items: [
        { productId: 'prod_spade', productName: 'Spade (Heavy Duty)', quantity: 1, unitType: 'PIECE', pricePerUnit: 1200, costPrice: 900, lineTotal: 1200 },
      ],
    },
    {
      id: 'tx_017', receiptNumber: 'MBM-RCPT-017', customerId: 'cust_6', cashierId: 'user_super_admin',
      subtotal: 16000, taxAmount: 2560, discountAmount: 500, totalAmount: 18060,
      paymentMethod: 'MPESA', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(2, 11),
      items: [
        { productId: 'prod_dulux_20l', productName: 'Dulux Weathershield 20L', quantity: 1, unitType: 'PIECE', pricePerUnit: 8500, costPrice: 7200, lineTotal: 8500 },
        { productId: 'prod_crown_20l', productName: 'Crown Vinyl Silk 20L', quantity: 1, unitType: 'PIECE', pricePerUnit: 6500, costPrice: 5500, lineTotal: 6500 },
      ],
    },
    {
      id: 'tx_018', receiptNumber: 'MBM-RCPT-018', customerId: null, cashierId: 'user_cashier_1',
      subtotal: 2600, taxAmount: 416, discountAmount: 0, totalAmount: 3016,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(4, 11),
      items: [
        { productId: 'prod_dulux_4l', productName: 'Dulux Weathershield 4L', quantity: 1, unitType: 'PIECE', pricePerUnit: 2400, costPrice: 2000, lineTotal: 2400 },
        { productId: 'prod_nails_2inch', productName: '2-inch Nails', quantity: 2, unitType: 'KILOGRAM', pricePerUnit: 130, costPrice: 95, lineTotal: 260 },
      ],
    },
  ];

  for (const sale of salesData) {
    await prisma.salesTransaction.create({
      data: {
        id: sale.id,
        storeId: store.id,
        receiptNumber: sale.receiptNumber,
        customerId: sale.customerId,
        cashierId: sale.cashierId,
        subtotal: sale.subtotal,
        taxAmount: sale.taxAmount,
        discountAmount: sale.discountAmount,
        totalAmount: sale.totalAmount,
        paymentMethod: sale.paymentMethod,
        paymentStatus: sale.paymentStatus,
        transactionType: sale.transactionType,
        createdAt: sale.createdAt,
        items: {
          create: sale.items.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            unitType: item.unitType,
            pricePerUnit: item.pricePerUnit,
            costPrice: item.costPrice,
            lineTotal: item.lineTotal,
          })),
        },
        payments: {
          create: {
            storeId: store.id,
            paymentMethod: sale.paymentMethod === 'SPLIT' ? 'CASH' : sale.paymentMethod,
            amount: sale.paymentMethod === 'DEBT' ? 0 : sale.totalAmount,
            status: 'COMPLETED',
          },
        },
      },
    });
  }

  // ==========================================================================
  // 12. SEED DEBT LEDGERS (3-4 with different aging buckets)
  // ==========================================================================
  console.log('📋 Seeding debt ledgers...');

  await prisma.debtLedger.createMany({
    data: [
      { id: 'debt_1', storeId: store.id, customerId: 'cust_2', transactionId: 'tx_004', amountOwed: 15000, amountPaid: 0, balance: 15000, dueDate: new Date('2025-01-15'), status: 'OUTSTANDING', agingBucket: 'DAYS_60' },
      { id: 'debt_2', storeId: store.id, customerId: 'cust_3', transactionId: 'tx_004', amountOwed: 45000, amountPaid: 5000, balance: 40000, dueDate: new Date('2025-01-01'), status: 'OVERDUE', agingBucket: 'DAYS_90_PLUS' },
      { id: 'debt_3', storeId: store.id, customerId: 'cust_4', transactionId: 'tx_009', amountOwed: 120000, amountPaid: 30000, balance: 90000, dueDate: new Date('2025-03-30'), status: 'PARTIAL', agingBucket: 'DAYS_30' },
      { id: 'debt_4', storeId: store.id, customerId: 'cust_5', transactionId: null, amountOwed: 5000, amountPaid: 0, balance: 5000, dueDate: new Date('2025-04-28'), status: 'OUTSTANDING', agingBucket: 'CURRENT' },
      { id: 'debt_5', storeId: store.id, customerId: 'cust_6', transactionId: null, amountOwed: 32000, amountPaid: 8000, balance: 24000, dueDate: new Date('2025-02-15'), status: 'PARTIAL', agingBucket: 'DAYS_30' },
      { id: 'debt_6', storeId: store.id, customerId: 'cust_8', transactionId: 'tx_009', amountOwed: 52680, amountPaid: 26340, balance: 26340, dueDate: new Date('2025-03-15'), status: 'PARTIAL', agingBucket: 'CURRENT' },
    ],
  });

  // ==========================================================================
  // 13. SEED EQUIPMENT RENTALS (3: active, overdue, returned)
  // ==========================================================================
  console.log('📋 Seeding equipment rentals...');

  await prisma.equipmentRental.createMany({
    data: [
      {
        id: 'rental_1', storeId: store.id, productId: 'prod_concrete_mixer', customerId: 'cust_3',
        status: 'ACTIVE', rentalStartDate: daysAgo(5), expectedReturnDate: daysAgo(-5),
        securityDeposit: 10000, ratePerDay: 3000, totalRentalCharge: 30000, lateFeeAccumulated: 0,
      },
      {
        id: 'rental_2', storeId: store.id, productId: 'prod_scaffolding', customerId: 'cust_4',
        status: 'OVERDUE', rentalStartDate: daysAgo(20), expectedReturnDate: daysAgo(3),
        securityDeposit: 15000, ratePerDay: 1500, totalRentalCharge: 30000, lateFeeAccumulated: 4500,
      },
      {
        id: 'rental_3', storeId: store.id, productId: 'prod_vibrator', customerId: 'cust_7',
        status: 'RETURNED', rentalStartDate: daysAgo(10), expectedReturnDate: daysAgo(3),
        actualReturnDate: daysAgo(4),
        securityDeposit: 5000, ratePerDay: 2000, totalRentalCharge: 14000, lateFeeAccumulated: 0,
      },
    ],
  });

  // ==========================================================================
  // 14. SEED STOCK MOVEMENTS (past week)
  // ==========================================================================
  console.log('📋 Seeding stock movements...');

  const stockMovements = [
    { storeId: store.id, productId: 'prod_cement_bamburi', movementType: 'SALE', quantity: -10, referenceId: 'tx_001', performedBy: 'user_cashier_1', createdAt: daysAgoAtHour(0, 10) },
    { storeId: store.id, productId: 'prod_rebar_12mm', movementType: 'SALE', quantity: -30, referenceId: 'tx_002', performedBy: 'user_cashier_1', createdAt: daysAgoAtHour(0, 11) },
    { storeId: store.id, productId: 'prod_mabati_30', movementType: 'SALE', quantity: -15, referenceId: 'tx_002', performedBy: 'user_cashier_1', createdAt: daysAgoAtHour(0, 11) },
    { storeId: store.id, productId: 'prod_nails_4inch', movementType: 'SALE', quantity: -10, referenceId: 'tx_003', performedBy: 'user_cashier_1', createdAt: daysAgoAtHour(1, 9) },
    { storeId: store.id, productId: 'prod_nails_3inch', movementType: 'SALE', quantity: -5, referenceId: 'tx_003', performedBy: 'user_cashier_1', createdAt: daysAgoAtHour(1, 9) },
    { storeId: store.id, productId: 'prod_cement_simba', movementType: 'SALE', quantity: -20, referenceId: 'tx_004', performedBy: 'user_cashier_1', createdAt: daysAgoAtHour(1, 14) },
    { storeId: store.id, productId: 'prod_rebar_10mm', movementType: 'SALE', quantity: -15, referenceId: 'tx_004', performedBy: 'user_cashier_1', createdAt: daysAgoAtHour(1, 14) },
    { storeId: store.id, productId: 'prod_dulux_20l', movementType: 'SALE', quantity: -2, referenceId: 'tx_005', performedBy: 'user_super_admin', createdAt: daysAgoAtHour(2, 10) },
    { storeId: store.id, productId: 'prod_cement_bamburi', movementType: 'PURCHASE', quantity: 100, referenceId: null, performedBy: 'user_super_admin', notes: 'Restocking from Bamburi supplier', createdAt: daysAgoAtHour(2, 8) },
    { storeId: store.id, productId: 'prod_mabati_28', movementType: 'PURCHASE', quantity: 200, referenceId: null, performedBy: 'user_super_admin', notes: 'Restocking mabati from manufacturer', createdAt: daysAgoAtHour(3, 7) },
    { storeId: store.id, productId: 'prod_rebar_12mm', movementType: 'SALE', quantity: -15, referenceId: 'tx_009', performedBy: 'user_super_admin', createdAt: daysAgoAtHour(3, 16) },
    { storeId: store.id, productId: 'prod_cement_bamburi', movementType: 'SALE', quantity: -40, referenceId: 'tx_009', performedBy: 'user_super_admin', createdAt: daysAgoAtHour(3, 16) },
    { storeId: store.id, productId: 'prod_chainlink_6ft', movementType: 'SALE', quantity: -8, referenceId: 'tx_007', performedBy: 'user_cashier_1', createdAt: daysAgoAtHour(3, 8) },
    { storeId: store.id, productId: 'prod_wheelbarrow_std', movementType: 'SALE', quantity: -1, referenceId: 'tx_006', performedBy: 'user_cashier_1', createdAt: daysAgoAtHour(2, 15) },
    { storeId: store.id, productId: 'prod_concrete_mixer', movementType: 'RENTAL_OUT', quantity: -1, referenceId: 'rental_1', performedBy: 'user_super_admin', createdAt: daysAgo(5) },
    { storeId: store.id, productId: 'prod_vibrator', movementType: 'RENTAL_RETURN', quantity: 1, referenceId: 'rental_3', performedBy: 'user_super_admin', createdAt: daysAgo(4) },
    { storeId: store.id, productId: 'prod_scaffolding', movementType: 'RENTAL_OUT', quantity: -1, referenceId: 'rental_2', performedBy: 'user_super_admin', createdAt: daysAgo(20) },
    { storeId: store.id, productId: 'prod_cement_bamburi', movementType: 'SALE', quantity: -50, referenceId: 'tx_015', performedBy: 'user_cashier_1', createdAt: daysAgoAtHour(6, 13) },
    { storeId: store.id, productId: 'prod_rebar_8mm', movementType: 'SALE', quantity: -20, referenceId: 'tx_015', performedBy: 'user_cashier_1', createdAt: daysAgoAtHour(6, 13) },
  ];

  for (const movement of stockMovements) {
    await prisma.stockMovement.create({ data: movement });
  }

  // ==========================================================================
  // 15. SEED CASH DRAWER LOGS (opening + sales events)
  // ==========================================================================
  console.log('📋 Seeding cash drawer logs...');

  const cashDrawerLogs = [
    { storeId: store.id, userId: 'user_cashier_1', action: 'OPEN', amount: 20000, balance: 20000, notes: 'Opening float', createdAt: daysAgoAtHour(0, 7) },
    { storeId: store.id, userId: 'user_cashier_1', action: 'SALE', amount: 8700, balance: 28700, notes: 'Cash sale - MBM-RCPT-001', createdAt: daysAgoAtHour(0, 10) },
    { storeId: store.id, userId: 'user_cashier_1', action: 'CASH_OUT', amount: 5000, balance: 23700, notes: 'Transport expense', createdAt: daysAgoAtHour(0, 12) },
    { storeId: store.id, userId: 'user_cashier_1', action: 'SALE', amount: 3770, balance: 27470, notes: 'Cash sale - MBM-RCPT-003', createdAt: daysAgoAtHour(1, 9) },
    { storeId: store.id, userId: 'user_cashier_1', action: 'SALE', amount: 19720, balance: 47190, notes: 'Cash sale - MBM-RCPT-005', createdAt: daysAgoAtHour(2, 10) },
    { storeId: store.id, userId: 'user_cashier_1', action: 'SALE', amount: 6380, balance: 53570, notes: 'Cash sale - MBM-RCPT-006', createdAt: daysAgoAtHour(2, 15) },
    { storeId: store.id, userId: 'user_cashier_1', action: 'CASH_OUT', amount: 20000, balance: 33570, notes: 'Bank deposit', createdAt: daysAgoAtHour(2, 17) },
    { storeId: store.id, userId: 'user_cashier_1', action: 'SALE', amount: 9860, balance: 43430, notes: 'Cash sale - MBM-RCPT-008', createdAt: daysAgoAtHour(3, 12) },
    { storeId: store.id, userId: 'user_cashier_1', action: 'SALE', amount: 24520, balance: 67950, notes: 'Cash sale - MBM-RCPT-012', createdAt: daysAgoAtHour(5, 10) },
    { storeId: store.id, userId: 'user_cashier_1', action: 'SALE', amount: 2784, balance: 70734, notes: 'Cash sale - MBM-RCPT-013', createdAt: daysAgoAtHour(5, 16) },
    { storeId: store.id, userId: 'user_cashier_1', action: 'CASH_OUT', amount: 30000, balance: 40734, notes: 'Bank deposit', createdAt: daysAgoAtHour(5, 18) },
    { storeId: store.id, userId: 'user_cashier_1', action: 'SALE', amount: 7888, balance: 48622, notes: 'Cash sale - MBM-RCPT-014', createdAt: daysAgoAtHour(6, 9) },
    { storeId: store.id, userId: 'user_cashier_1', action: 'SALE', amount: 1392, balance: 50014, notes: 'Cash sale - MBM-RCPT-016', createdAt: daysAgoAtHour(6, 17) },
  ];

  for (const log of cashDrawerLogs) {
    await prisma.cashDrawerLog.create({ data: log });
  }

  // ==========================================================================
  // 16. SEED EXPENSES
  // ==========================================================================
  console.log('📋 Seeding expenses...');

  const expenses = [
    { storeId: store.id, description: 'Shop rent - January', amount: 25000, category: 'RENT', paidBy: 'user_super_admin', paymentMethod: 'CASH', notes: 'Monthly rent for Juja Main shop' },
    { storeId: store.id, description: 'Electricity bill', amount: 4500, category: 'UTILITIES', paidBy: 'user_accountant_1', paymentMethod: 'MPESA', notes: 'Kenya Power bill for Dec' },
    { storeId: store.id, description: 'Delivery truck fuel', amount: 3500, category: 'TRANSPORT', paidBy: 'user_cashier_1', paymentMethod: 'CASH', notes: 'Fuel for delivery to site' },
    { storeId: store.id, description: 'Staff salary - Grace', amount: 18000, category: 'SALARIES', paidBy: 'user_super_admin', paymentMethod: 'MPESA', notes: 'Monthly salary' },
    { storeId: store.id, description: 'Shop maintenance - door repair', amount: 2500, category: 'MAINTENANCE', paidBy: 'user_cashier_1', paymentMethod: 'CASH' },
  ];

  for (const expense of expenses) {
    await prisma.expense.create({ data: expense });
  }

  // ==========================================================================
  // 17. SEED SYSTEM LOGS (for recent activity feed)
  // ==========================================================================
  console.log('📋 Seeding system logs...');

  const systemLogs = [
    { storeId: store.id, userId: 'user_cashier_1', action: 'SALE_COMPLETED', component: 'POS', severity: 'INFO', message: 'Sale MBM-RCPT-001 completed: KES 8,700 (CASH)', metadata: JSON.stringify({ receiptNumber: 'MBM-RCPT-001', amount: 8700 }) },
    { storeId: store.id, userId: 'user_cashier_1', action: 'SALE_COMPLETED', component: 'POS', severity: 'INFO', message: 'Sale MBM-RCPT-002 completed: KES 50,200 (MPESA)', metadata: JSON.stringify({ receiptNumber: 'MBM-RCPT-002', amount: 50200 }) },
    { storeId: store.id, userId: 'user_super_admin', action: 'RENTAL_CREATED', component: 'RENTAL', severity: 'INFO', message: 'Concrete Mixer rented to Peter Odhiambo', metadata: JSON.stringify({ rentalId: 'rental_1', customer: 'cust_3' }) },
    { storeId: store.id, userId: 'user_super_admin', action: 'RENTAL_CREATED', component: 'RENTAL', severity: 'INFO', message: 'Scaffolding Set rented to Akinyi Builders Ltd', metadata: JSON.stringify({ rentalId: 'rental_2', customer: 'cust_4' }) },
    { storeId: store.id, userId: 'user_super_admin', action: 'STOCK_RECEIVED', component: 'INVENTORY', severity: 'INFO', message: 'Received 100 bags Bamburi Cement from supplier', metadata: JSON.stringify({ productId: 'prod_cement_bamburi', quantity: 100 }) },
    { storeId: store.id, userId: null, action: 'LOW_STOCK_ALERT', component: 'INVENTORY', severity: 'WARN', message: 'Heavy Duty Wheelbarrow stock low (10 remaining, reorder level: 3)', metadata: JSON.stringify({ productId: 'prod_wheelbarrow_heavy' }) },
    { storeId: store.id, userId: 'user_super_admin', action: 'EXPENSE_CREATED', component: 'FINANCIAL', severity: 'INFO', message: 'Rent expense recorded: KES 25,000', metadata: JSON.stringify({ amount: 25000, category: 'RENT' }) },
    { storeId: store.id, userId: 'user_super_admin', action: 'DEBT_REMINDER', component: 'FINANCIAL', severity: 'WARN', message: 'Debt reminder sent to Peter Odhiambo (KES 40,000 overdue)', metadata: JSON.stringify({ customerId: 'cust_3', balance: 40000 }) },
  ];

  for (const log of systemLogs) {
    await prisma.systemLog.create({ data: log });
  }

  // ==========================================================================
  // 18. Log the initialization event
  // ==========================================================================
  await prisma.initializationLog.create({
    data: {
      event: 'SYSTEM_INITIALIZED',
      details: 'MBUMAH HARDWARE POS system initialized with default Super Admin, demo store, products, sales transactions, and accounts.',
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
  console.log('   💰 Sales transactions seeded: ' + salesData.length);
  console.log('   📋 Stock movements seeded: ' + stockMovements.length);
  console.log('   🏗️ Equipment rentals seeded: 3');
  console.log('   🗄️ Cash drawer logs seeded: ' + cashDrawerLogs.length);
  console.log('   📝 Expenses seeded: ' + expenses.length);
}

main()
  .catch(e => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
