// Database seed script - runs on first boot if no users exist
//
// H-07: Seed Default Passwords
// ----------------------------------------------------------------------------
// All seeded users are now given a UNIQUE, cryptographically-random password
// generated with `crypto.randomBytes`. The passwords are written to
// `<project_root>/.seed-passwords.local` (gitignored) AND printed to stdout
// with a warning banner. They are NOT hardcoded in source.
//
// RECOMMENDED FULL FIX (requires schema change, tracked as follow-up):
//  - Add `mustChangePassword Boolean @default(false)` to the User model.
//  - Set `mustChangePassword: true` for all seeded users so the auth layer
//    forces a password reset on first login.
//  - The login route (Task 5-a) already returns `requiresReset` for legacy
//    `hashed_`-prefixed hashes; wiring that flag to a real DB column is the
//    remaining piece. See Task 5-a follow-up items in the worklog.
// ----------------------------------------------------------------------------

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// H-07: Secure password generation + credential journaling
// ---------------------------------------------------------------------------
// Collects (email, plaintext) pairs so we can write them all to
// `.seed-passwords.local` and print them at the end of the seed run.
const seededCredentials: Array<{ email: string; password: string; role: string }> = [];

/**
 * Generate a cryptographically-secure password of the given length using
 * `crypto.randomBytes`. The character set is chosen so the output satisfies
 * the M-03 password policy (min 8 chars + uppercase + lowercase + digit +
 * special) introduced in Task 6-a.
 *
 * The password is built by rejection-sampling bytes into a curated alphabet
 * (no modulo bias). At least one character from each required class is then
 * force-injected and the result is shuffled (Fisher-Yates, also driven by
 * `randomBytes`) so the injected characters do not occupy fixed positions.
 */
function generateSecurePassword(length: number = 16): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';  // no I, O
  const lower = 'abcdefghijkmnopqrstuvwxyz';  // no l
  const digits = '23456789';                  // no 0, 1
  const special = '!@#$%^&*-_=+';
  const all = upper + lower + digits + special;

  function sampleFrom(alphabet: string, n: number): string {
    const k = alphabet.length;
    const limit = Math.floor(256 / k) * k;
    let out = '';
    let buf = randomBytes(n * 2 + 8);
    let i = 0;
    while (out.length < n) {
      if (i >= buf.length) { buf = randomBytes(n * 2 + 8); i = 0; }
      const b = buf[i++];
      if (b < limit) out += alphabet[b % k];
    }
    return out;
  }

  // Force one char from each required class so the policy is always met.
  const parts = [
    sampleFrom(upper, 1),
    sampleFrom(lower, 1),
    sampleFrom(digits, 1),
    sampleFrom(special, 1),
    sampleFrom(all, length - 4),
  ];

  // Fisher-Yates shuffle driven by randomBytes.
  const arr = parts.join('').split('');
  const shuffleBuf = randomBytes(arr.length * 2);
  for (let j = arr.length - 1; j > 0; j--) {
    const limit = Math.floor(256 / (j + 1)) * (j + 1);
    let idx = shuffleBuf[j * 2] + (j * 2 + 1 < shuffleBuf.length ? shuffleBuf[j * 2 + 1] << 8 : 0);
    while (idx >= limit) {
      idx = randomBytes(2).readUInt16BE(0);
    }
    const swapWith = idx % (j + 1);
    const tmp = arr[j]; arr[j] = arr[swapWith]; arr[swapWith] = tmp;
  }
  return arr.join('');
}

/**
 * Generate a fresh secure password, hash it, and journal the plaintext for
 * operator retrieval. Returns the bcrypt hash for storage on the User row.
 */
async function makeHashedPasswordFor(email: string, role: string): Promise<string> {
  const password = generateSecurePassword(16);
  const hash = await bcrypt.hash(password, 12);
  seededCredentials.push({ email, password, role });
  return hash;
}

/**
 * Print + persist all seeded credentials at the end of the run. The file is
 * written to `<project_root>/.seed-passwords.local` (gitignored). The same
 * data is also printed to stdout with a hard-to-miss warning banner so
 * anyone watching the seed output captures the passwords.
 */
function dumpSeededCredentials(): void {
  if (seededCredentials.length === 0) return;

  const banner =
    '\n' +
    '============================================================\n' +
    '  SEEDED USER CREDENTIALS — CHANGE THESE IMMEDIATELY ON FIRST LOGIN\n' +
    '  (H-07: random per-user passwords generated with crypto.randomBytes)\n' +
    '============================================================\n';
  const lines = seededCredentials.map(
    (c) => `${c.email.padEnd(36)} | ${c.role.padEnd(16)} | ${c.password}`
  );
  const body = banner + lines.join('\n') + '\n' +
    '------------------------------------------------------------\n' +
    'These credentials have ALSO been written to <project_root>/.seed-passwords.local\n' +
    '(gitignored). Delete that file after distributing/rotating the passwords.\n';
  console.warn(body);

  try {
    // Use process.cwd() (not __dirname) so the file lands in a
    // predictable location regardless of whether Prisma runs the seed
    // via ts-node (CommonJS) or via tsx/esbuild (ESM, where __dirname
    // is undefined). When run via `npm run db:seed` from the project
    // root, this writes to <project_root>/.seed-passwords.local.
    const outPath = join(process.cwd(), '.seed-passwords.local');
    writeFileSync(outPath, body, { mode: 0o600 });
    console.log(`[seed] Credentials written to ${outPath}`);
  } catch (err) {
    console.error('[seed] Failed to write .seed-passwords.local:', err);
  }
}

// Generate date N days ago
function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

// Generate date N days from now
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

// Generate date N days ago at hour
function daysAgoAtHour(n: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, Math.floor(Math.random() * 50) + 5, Math.floor(Math.random() * 60), 0);
  return d;
}

async function main() {
  console.log('MBUMAH HARDWARE POS - Checking initialization status...');

    const userCount = await prisma.user.count();

  if (userCount > 0) {
    console.log('Database already initialized. Skipping seed.');
    return;
  }

  console.log('First boot detected. Initializing system...');

  // 1. Create Organization
  const org = await prisma.organization.create({
    data: {
      id: 'org_mbumah',
      name: 'MBUMAH HARDWARE',
      taxPin: 'P051234567A',
      status: 'ACTIVE',
    },
  });

  // 2. Create Stores
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

  const storeThika = await prisma.store.create({
    data: {
      id: 'store_thika',
      organizationId: org.id,
      name: 'MBUMAH HARDWARE - Thika Branch',
      location: 'Thika Town, Kiambu County',
      address: 'Thika Town, Kiambu County',
      phone: '0712345678',
      email: 'thika@mbumahhardware.co.ke',
      taxPin: 'P051234567A',
      status: 'ACTIVE',
    },
  });

  const storeRuiru = await prisma.store.create({
    data: {
      id: 'store_ruiru',
      organizationId: org.id,
      name: 'MBUMAH HARDWARE - Ruiru Branch',
      location: 'Ruiru Town, Kiambu County',
      address: 'Ruiru Town, Kiambu County',
      phone: '0723456789',
      email: 'ruiru@mbumahhardware.co.ke',
      taxPin: 'P051234567A',
      status: 'ACTIVE',
    },
  });

  const storeNairobiCbd = await prisma.store.create({
    data: {
      id: 'store_nairobi_cbd',
      organizationId: org.id,
      name: 'MBUMAH HARDWARE - Nairobi CBD Branch',
      location: 'Kenyatta Avenue, Nairobi',
      address: 'Kenyatta Avenue, Nairobi',
      phone: '0734567890',
      email: 'nairobi@mbumahhardware.co.ke',
      taxPin: 'P051234567A',
      status: 'ACTIVE',
    },
  });

  const storeNakuru = await prisma.store.create({
    data: {
      id: 'store_nakuru',
      organizationId: org.id,
      name: 'MBUMAH HARDWARE - Nakuru Branch',
      location: 'Nakuru Town, Nakuru County',
      address: 'Nakuru Town, Nakuru County',
      phone: '0745678901',
      email: 'nakuru@mbumahhardware.co.ke',
      taxPin: 'P051234567A',
      status: 'ACTIVE',
    },
  });

  // 3. Seed Super Admin
  const superAdmin = await prisma.user.create({
    data: {
      id: 'user_super_admin',
      organizationId: org.id,
      storeId: store.id,
      email: 'admin@mbumahhardware.co.ke',
      name: 'System Administrator',
      passwordHash: await makeHashedPasswordFor('admin@mbumahhardware.co.ke', 'SUPER_ADMIN'),
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
      passwordHash: await makeHashedPasswordFor('cashier@mbumahhardware.co.ke', 'CASHIER'),
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
      passwordHash: await makeHashedPasswordFor('accountant@mbumahhardware.co.ke', 'ACCOUNTANT'),
      role: 'ACCOUNTANT',
      phone: '0787485104',
      isActive: true,
    },
  });

  // 4b. Seed Branch Managers
  const thikaManager = await prisma.user.create({
    data: {
      id: 'user_thika_manager',
      organizationId: org.id,
      storeId: storeThika.id,
      email: 'thika.manager@mbumahhardware.co.ke',
      name: 'David Njoroge',
      passwordHash: await makeHashedPasswordFor('thika.manager@mbumahhardware.co.ke', 'BRANCH_MANAGER'),
      role: 'BRANCH_MANAGER',
      phone: '0712345678',
      isActive: true,
    },
  });

  const ruiruManager = await prisma.user.create({
    data: {
      id: 'user_ruiru_manager',
      organizationId: org.id,
      storeId: storeRuiru.id,
      email: 'ruiru.manager@mbumahhardware.co.ke',
      name: 'Samuel Kibet',
      passwordHash: await makeHashedPasswordFor('ruiru.manager@mbumahhardware.co.ke', 'BRANCH_MANAGER'),
      role: 'BRANCH_MANAGER',
      phone: '0723456789',
      isActive: true,
    },
  });

  const nairobiManager = await prisma.user.create({
    data: {
      id: 'user_nairobi_manager',
      organizationId: org.id,
      storeId: storeNairobiCbd.id,
      email: 'nairobi.manager@mbumahhardware.co.ke',
      name: 'Mary Akinyi',
      passwordHash: await makeHashedPasswordFor('nairobi.manager@mbumahhardware.co.ke', 'BRANCH_MANAGER'),
      role: 'BRANCH_MANAGER',
      phone: '0734567890',
      isActive: true,
    },
  });

  const nakuruManager = await prisma.user.create({
    data: {
      id: 'user_nakuru_manager',
      organizationId: org.id,
      storeId: storeNakuru.id,
      email: 'nakuru.manager@mbumahhardware.co.ke',
      name: 'Peter Ruto',
      passwordHash: await makeHashedPasswordFor('nakuru.manager@mbumahhardware.co.ke', 'BRANCH_MANAGER'),
      role: 'BRANCH_MANAGER',
      phone: '0745678901',
      isActive: true,
    },
  });

  // 4c. Seed Branch Cashiers
  const thikaCashier = await prisma.user.create({
    data: {
      id: 'user_thika_cashier',
      organizationId: org.id,
      storeId: storeThika.id,
      email: 'thika.cashier@mbumahhardware.co.ke',
      name: 'Lucy Wambui',
      passwordHash: await makeHashedPasswordFor('thika.cashier@mbumahhardware.co.ke', 'CASHIER'),
      role: 'CASHIER',
      phone: '0719111222',
      isActive: true,
    },
  });

  const ruiruCashier = await prisma.user.create({
    data: {
      id: 'user_ruiru_cashier',
      organizationId: org.id,
      storeId: storeRuiru.id,
      email: 'ruiru.cashier@mbumahhardware.co.ke',
      name: 'Diana Muthoni',
      passwordHash: await makeHashedPasswordFor('ruiru.cashier@mbumahhardware.co.ke', 'CASHIER'),
      role: 'CASHIER',
      phone: '0728222333',
      isActive: true,
    },
  });

  const nairobiCashier = await prisma.user.create({
    data: {
      id: 'user_nairobi_cashier',
      organizationId: org.id,
      storeId: storeNairobiCbd.id,
      email: 'nairobi.cashier@mbumahhardware.co.ke',
      name: 'Vincent Ochieng',
      passwordHash: await makeHashedPasswordFor('nairobi.cashier@mbumahhardware.co.ke', 'CASHIER'),
      role: 'CASHIER',
      phone: '0739333444',
      isActive: true,
    },
  });

  const nakuruCashier = await prisma.user.create({
    data: {
      id: 'user_nakuru_cashier',
      organizationId: org.id,
      storeId: storeNakuru.id,
      email: 'nakuru.cashier@mbumahhardware.co.ke',
      name: 'Eunice Jeptoo',
      passwordHash: await makeHashedPasswordFor('nakuru.cashier@mbumahhardware.co.ke', 'CASHIER'),
      role: 'CASHIER',
      phone: '0740444555',
      isActive: true,
    },
  });

  // 4d. Seed Store Owner
  const storeOwner = await prisma.user.create({
    data: {
      id: 'user_store_owner',
      organizationId: org.id,
      storeId: store.id,
      email: 'owner@mbumahhardware.co.ke',
      name: 'Mbumah Hardware Owner',
      passwordHash: await makeHashedPasswordFor('owner@mbumahhardware.co.ke', 'STORE_OWNER'),
      role: 'STORE_OWNER',
      phone: '0795191910',
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
    // BRANCH_MANAGER permissions
    { role: 'BRANCH_MANAGER', resource: 'products', action: 'create' },
    { role: 'BRANCH_MANAGER', resource: 'products', action: 'read' },
    { role: 'BRANCH_MANAGER', resource: 'products', action: 'update' },
    { role: 'BRANCH_MANAGER', resource: 'transactions', action: 'create' },
    { role: 'BRANCH_MANAGER', resource: 'transactions', action: 'read' },
    { role: 'BRANCH_MANAGER', resource: 'transactions', action: 'refund' },
    { role: 'BRANCH_MANAGER', resource: 'customers', action: 'create' },
    { role: 'BRANCH_MANAGER', resource: 'customers', action: 'read' },
    { role: 'BRANCH_MANAGER', resource: 'customers', action: 'update' },
    { role: 'BRANCH_MANAGER', resource: 'financials', action: 'read' },
    { role: 'BRANCH_MANAGER', resource: 'financials', action: 'export' },
    { role: 'BRANCH_MANAGER', resource: 'rentals', action: 'create' },
    { role: 'BRANCH_MANAGER', resource: 'rentals', action: 'read' },
    { role: 'BRANCH_MANAGER', resource: 'rentals', action: 'update' },
    { role: 'BRANCH_MANAGER', resource: 'admin', action: 'read' },
    { role: 'BRANCH_MANAGER', resource: 'reports', action: 'read' },
    { role: 'BRANCH_MANAGER', resource: 'reports', action: 'export' },
    { role: 'BRANCH_MANAGER', resource: 'debt', action: 'read' },
    { role: 'BRANCH_MANAGER', resource: 'debt', action: 'remind' },
    // STORE_OWNER permissions (full access like SUPER_ADMIN but scoped to store)
    ...['products', 'transactions', 'customers', 'financials', 'rentals', 'admin', 'reports', 'debt'].flatMap(resource =>
      ['create', 'read', 'update', 'delete', 'approve', 'refund', 'export', 'void', 'manage_users', 'write_off', 'remind', 'adjust'].map(action => ({
        role: 'STORE_OWNER' as string,
        resource,
        action,
      }))
    ),
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

  // 9b. Seed Branch-Specific Product Categories, Products, and Customers
  console.log('Seeding branch-specific data...');

  // ---- THIKA BRANCH ----
  const thkCats = [
    { id: 'cat_thk_cement', storeId: storeThika.id, name: 'Cement', description: 'All types of cement', icon: 'building', color: '#8B7355', sortOrder: 1 },
    { id: 'cat_thk_iron_sheets', storeId: storeThika.id, name: 'Iron Sheets', description: 'Roofing iron sheets', icon: 'layout-grid', color: '#4A5568', sortOrder: 2 },
    { id: 'cat_thk_paints', storeId: storeThika.id, name: 'Paints', description: 'Interior and exterior paints', icon: 'palette', color: '#E53E3E', sortOrder: 3 },
    { id: 'cat_thk_iron_bars', storeId: storeThika.id, name: 'Iron Bars', description: 'Reinforcement iron bars', icon: 'minus', color: '#718096', sortOrder: 4 },
    { id: 'cat_thk_tools', storeId: storeThika.id, name: 'Tools', description: 'Construction tools and equipment', icon: 'wrench', color: '#2D3748', sortOrder: 5 },
    { id: 'cat_thk_plumbing', storeId: storeThika.id, name: 'Plumbing', description: 'Pipes, fittings, and plumbing supplies', icon: 'droplets', color: '#3182CE', sortOrder: 6 },
    { id: 'cat_thk_nails_screws', storeId: storeThika.id, name: 'Nails & Screws', description: 'Fasteners, nails, and screws', icon: 'pin', color: '#38A169', sortOrder: 7 },
    { id: 'cat_thk_timber', storeId: storeThika.id, name: 'Timber & Wood', description: 'Timber, plywood, and wood products', icon: 'tree', color: '#8B4513', sortOrder: 8 },
  ];
  for (const cat of thkCats) { await prisma.productCategory.create({ data: cat }); }

  const thkProducts = [
    { id: 'prod_thk_cement_bamburi', sku: 'THK-CEM-0001', name: 'Bamburi Cement 50kg', categoryId: 'cat_thk_cement', unitType: 'BAG', quantityInStock: 180, pricePerUnit: 750, costPrice: 680, reorderLevel: 50 },
    { id: 'prod_thk_cement_simba', sku: 'THK-CEM-0002', name: 'Simba Cement 50kg', categoryId: 'cat_thk_cement', unitType: 'BAG', quantityInStock: 120, pricePerUnit: 720, costPrice: 650, reorderLevel: 50 },
    { id: 'prod_thk_mabati_30', sku: 'THK-IRS-0001', name: 'Mabati 30-Gauge (8ft)', categoryId: 'cat_thk_iron_sheets', unitType: 'PIECE', quantityInStock: 350, pricePerUnit: 650, costPrice: 580, reorderLevel: 100 },
    { id: 'prod_thk_mabati_28', sku: 'THK-IRS-0002', name: 'Mabati 28-Gauge (8ft)', categoryId: 'cat_thk_iron_sheets', unitType: 'PIECE', quantityInStock: 200, pricePerUnit: 800, costPrice: 720, reorderLevel: 80 },
    { id: 'prod_thk_dulux_20l', sku: 'THK-PNT-0001', name: 'Dulux Weathershield 20L', categoryId: 'cat_thk_paints', unitType: 'PIECE', quantityInStock: 20, pricePerUnit: 8500, costPrice: 7200, reorderLevel: 10 },
    { id: 'prod_thk_rebar_12mm', sku: 'THK-IRB-0001', name: 'Rebar 12mm x 12m', categoryId: 'cat_thk_iron_bars', unitType: 'PIECE', quantityInStock: 280, pricePerUnit: 1200, costPrice: 1050, reorderLevel: 100 },
    { id: 'prod_thk_spade', sku: 'THK-TL-0001', name: 'Spade (Heavy Duty)', categoryId: 'cat_thk_tools', unitType: 'PIECE', quantityInStock: 40, pricePerUnit: 1200, costPrice: 900, reorderLevel: 15 },
    { id: 'prod_thk_pvc_4inch', sku: 'THK-PLM-0001', name: 'PVC Pipe 4-inch x 3m', categoryId: 'cat_thk_plumbing', unitType: 'PIECE', quantityInStock: 90, pricePerUnit: 800, costPrice: 600, reorderLevel: 30 },
    { id: 'prod_thk_nails_4inch', sku: 'THK-NAS-0001', name: '4-inch Nails', categoryId: 'cat_thk_nails_screws', unitType: 'KILOGRAM', quantityInStock: 350, pricePerUnit: 150, costPrice: 110, reorderLevel: 100 },
    { id: 'prod_thk_timber_2x4', sku: 'THK-TMB-0001', name: 'Timber 2x4 x 12ft (Cypress)', categoryId: 'cat_thk_timber', unitType: 'PIECE', quantityInStock: 60, pricePerUnit: 800, costPrice: 600, reorderLevel: 20 },
    { id: 'prod_thk_plywood_8x4', sku: 'THK-TMB-0002', name: 'Plywood 8x4ft (18mm)', categoryId: 'cat_thk_timber', unitType: 'PIECE', quantityInStock: 45, pricePerUnit: 2800, costPrice: 2200, reorderLevel: 15 },
  ];
  for (const product of thkProducts) { await prisma.product.create({ data: { ...product, storeId: storeThika.id } as any }); }

  const thkCustomers = [
    { id: 'cust_thk_1', storeId: storeThika.id, name: 'Francis Maina', phone: '0715123456', email: 'francis.maina@email.com', idNumber: '29104567', debtLimit: 80000, currentDebtBalance: 12000 },
    { id: 'cust_thk_2', storeId: storeThika.id, name: 'Thika Construction Co.', phone: '0716234567', email: 'info@thikaconstruction.co.ke', idNumber: '30215678', debtLimit: 300000, currentDebtBalance: 45000 },
    { id: 'cust_thk_3', storeId: storeThika.id, name: 'Beatrice Wairimu', phone: '0717345678', email: 'beatrice.w@email.com', idNumber: '31326789', debtLimit: 50000, currentDebtBalance: 0 },
    { id: 'cust_thk_4', storeId: storeThika.id, name: 'Murang\'a Builders Ltd', phone: '0718456789', email: 'info@murangabuilders.co.ke', idNumber: '32437890', debtLimit: 250000, currentDebtBalance: 78000 },
  ];
  for (const cust of thkCustomers) { await prisma.customer.create({ data: cust }); }

  // ---- RUIRU BRANCH ----
  const ruiruCats = [
    { id: 'cat_ruiru_cement', storeId: storeRuiru.id, name: 'Cement', description: 'All types of cement', icon: 'building', color: '#8B7355', sortOrder: 1 },
    { id: 'cat_ruiru_iron_sheets', storeId: storeRuiru.id, name: 'Iron Sheets', description: 'Roofing iron sheets', icon: 'layout-grid', color: '#4A5568', sortOrder: 2 },
    { id: 'cat_ruiru_paints', storeId: storeRuiru.id, name: 'Paints', description: 'Interior and exterior paints', icon: 'palette', color: '#E53E3E', sortOrder: 3 },
    { id: 'cat_ruiru_iron_bars', storeId: storeRuiru.id, name: 'Iron Bars', description: 'Reinforcement iron bars', icon: 'minus', color: '#718096', sortOrder: 4 },
    { id: 'cat_ruiru_tools', storeId: storeRuiru.id, name: 'Tools', description: 'Construction tools and equipment', icon: 'wrench', color: '#2D3748', sortOrder: 5 },
    { id: 'cat_ruiru_plumbing', storeId: storeRuiru.id, name: 'Plumbing', description: 'Pipes, fittings, and plumbing supplies', icon: 'droplets', color: '#3182CE', sortOrder: 6 },
    { id: 'cat_ruiru_nails_screws', storeId: storeRuiru.id, name: 'Nails & Screws', description: 'Fasteners, nails, and screws', icon: 'pin', color: '#38A169', sortOrder: 7 },
    { id: 'cat_ruiru_electrical', storeId: storeRuiru.id, name: 'Electrical', description: 'Wiring, switches, and electrical supplies', icon: 'zap', color: '#ECC94B', sortOrder: 8 },
  ];
  for (const cat of ruiruCats) { await prisma.productCategory.create({ data: cat }); }

  const ruiruProducts = [
    { id: 'prod_ruiru_cement_bamburi', sku: 'RUR-CEM-0001', name: 'Bamburi Cement 50kg', categoryId: 'cat_ruiru_cement', unitType: 'BAG', quantityInStock: 100, pricePerUnit: 750, costPrice: 680, reorderLevel: 50 },
    { id: 'prod_ruiru_cement_simba', sku: 'RUR-CEM-0002', name: 'Simba Cement 50kg', categoryId: 'cat_ruiru_cement', unitType: 'BAG', quantityInStock: 80, pricePerUnit: 720, costPrice: 650, reorderLevel: 50 },
    { id: 'prod_ruiru_mabati_30', sku: 'RUR-IRS-0001', name: 'Mabati 30-Gauge (8ft)', categoryId: 'cat_ruiru_iron_sheets', unitType: 'PIECE', quantityInStock: 250, pricePerUnit: 650, costPrice: 580, reorderLevel: 100 },
    { id: 'prod_ruiru_mabati_28', sku: 'RUR-IRS-0002', name: 'Mabati 28-Gauge (8ft)', categoryId: 'cat_ruiru_iron_sheets', unitType: 'PIECE', quantityInStock: 150, pricePerUnit: 800, costPrice: 720, reorderLevel: 80 },
    { id: 'prod_ruiru_dulux_20l', sku: 'RUR-PNT-0001', name: 'Dulux Weathershield 20L', categoryId: 'cat_ruiru_paints', unitType: 'PIECE', quantityInStock: 15, pricePerUnit: 8500, costPrice: 7200, reorderLevel: 10 },
    { id: 'prod_ruiru_rebar_12mm', sku: 'RUR-IRB-0001', name: 'Rebar 12mm x 12m', categoryId: 'cat_ruiru_iron_bars', unitType: 'PIECE', quantityInStock: 200, pricePerUnit: 1200, costPrice: 1050, reorderLevel: 100 },
    { id: 'prod_ruiru_rebar_10mm', sku: 'RUR-IRB-0002', name: 'Rebar 10mm x 12m', categoryId: 'cat_ruiru_iron_bars', unitType: 'PIECE', quantityInStock: 180, pricePerUnit: 900, costPrice: 780, reorderLevel: 100 },
    { id: 'prod_ruiru_spade', sku: 'RUR-TL-0001', name: 'Spade (Heavy Duty)', categoryId: 'cat_ruiru_tools', unitType: 'PIECE', quantityInStock: 25, pricePerUnit: 1200, costPrice: 900, reorderLevel: 15 },
    { id: 'prod_ruiru_pvc_4inch', sku: 'RUR-PLM-0001', name: 'PVC Pipe 4-inch x 3m', categoryId: 'cat_ruiru_plumbing', unitType: 'PIECE', quantityInStock: 70, pricePerUnit: 800, costPrice: 600, reorderLevel: 30 },
    { id: 'prod_ruiru_nails_4inch', sku: 'RUR-NAS-0001', name: '4-inch Nails', categoryId: 'cat_ruiru_nails_screws', unitType: 'KILOGRAM', quantityInStock: 280, pricePerUnit: 150, costPrice: 110, reorderLevel: 100 },
    { id: 'prod_ruiru_cable_2_5mm', sku: 'RUR-ELC-0001', name: 'Cable 2.5mm x 100m', categoryId: 'cat_ruiru_electrical', unitType: 'PIECE', quantityInStock: 20, pricePerUnit: 8500, costPrice: 7000, reorderLevel: 10 },
  ];
  for (const product of ruiruProducts) { await prisma.product.create({ data: { ...product, storeId: storeRuiru.id } as any }); }

  const ruiruCustomers = [
    { id: 'cust_ruiru_1', storeId: storeRuiru.id, name: 'Esther Nyambura', phone: '0724123456', email: 'esther.n@email.com', idNumber: '40104567', debtLimit: 60000, currentDebtBalance: 8500 },
    { id: 'cust_ruiru_2', storeId: storeRuiru.id, name: 'Ruiru Estate Developers', phone: '0725234567', email: 'info@ruirudevelopers.co.ke', idNumber: '41215678', debtLimit: 400000, currentDebtBalance: 95000 },
    { id: 'cust_ruiru_3', storeId: storeRuiru.id, name: 'Joseph Gathua', phone: '0726345678', email: 'joseph.g@email.com', idNumber: '42326789', debtLimit: 45000, currentDebtBalance: 0 },
    { id: 'cust_ruiru_4', storeId: storeRuiru.id, name: 'Tala Building Solutions', phone: '0727456789', email: 'info@talabuilding.co.ke', idNumber: '43437890', debtLimit: 200000, currentDebtBalance: 35000 },
  ];
  for (const cust of ruiruCustomers) { await prisma.customer.create({ data: cust }); }

  // ---- NAIROBI CBD BRANCH ----
  const nbiCats = [
    { id: 'cat_nbi_cement', storeId: storeNairobiCbd.id, name: 'Cement', description: 'All types of cement', icon: 'building', color: '#8B7355', sortOrder: 1 },
    { id: 'cat_nbi_iron_sheets', storeId: storeNairobiCbd.id, name: 'Iron Sheets', description: 'Roofing iron sheets', icon: 'layout-grid', color: '#4A5568', sortOrder: 2 },
    { id: 'cat_nbi_paints', storeId: storeNairobiCbd.id, name: 'Paints', description: 'Interior and exterior paints', icon: 'palette', color: '#E53E3E', sortOrder: 3 },
    { id: 'cat_nbi_iron_bars', storeId: storeNairobiCbd.id, name: 'Iron Bars', description: 'Reinforcement iron bars', icon: 'minus', color: '#718096', sortOrder: 4 },
    { id: 'cat_nbi_tools', storeId: storeNairobiCbd.id, name: 'Tools', description: 'Construction tools and equipment', icon: 'wrench', color: '#2D3748', sortOrder: 5 },
    { id: 'cat_nbi_plumbing', storeId: storeNairobiCbd.id, name: 'Plumbing', description: 'Pipes, fittings, and plumbing supplies', icon: 'droplets', color: '#3182CE', sortOrder: 6 },
    { id: 'cat_nbi_nails_screws', storeId: storeNairobiCbd.id, name: 'Nails & Screws', description: 'Fasteners, nails, and screws', icon: 'pin', color: '#38A169', sortOrder: 7 },
    { id: 'cat_nbi_safety', storeId: storeNairobiCbd.id, name: 'Safety Equipment', description: 'PPE, helmets, boots, and safety gear', icon: 'shield', color: '#E53E3E', sortOrder: 8 },
  ];
  for (const cat of nbiCats) { await prisma.productCategory.create({ data: cat }); }

  const nbiProducts = [
    { id: 'prod_nbi_cement_bamburi', sku: 'NBI-CEM-0001', name: 'Bamburi Cement 50kg', categoryId: 'cat_nbi_cement', unitType: 'BAG', quantityInStock: 250, pricePerUnit: 760, costPrice: 690, reorderLevel: 50 },
    { id: 'prod_nbi_cement_simba', sku: 'NBI-CEM-0002', name: 'Simba Cement 50kg', categoryId: 'cat_nbi_cement', unitType: 'BAG', quantityInStock: 200, pricePerUnit: 730, costPrice: 660, reorderLevel: 50 },
    { id: 'prod_nbi_mabati_30', sku: 'NBI-IRS-0001', name: 'Mabati 30-Gauge (8ft)', categoryId: 'cat_nbi_iron_sheets', unitType: 'PIECE', quantityInStock: 400, pricePerUnit: 660, costPrice: 590, reorderLevel: 100 },
    { id: 'prod_nbi_dulux_20l', sku: 'NBI-PNT-0001', name: 'Dulux Weathershield 20L', categoryId: 'cat_nbi_paints', unitType: 'PIECE', quantityInStock: 25, pricePerUnit: 8600, costPrice: 7300, reorderLevel: 10 },
    { id: 'prod_nbi_crown_20l', sku: 'NBI-PNT-0002', name: 'Crown Vinyl Silk 20L', categoryId: 'cat_nbi_paints', unitType: 'PIECE', quantityInStock: 20, pricePerUnit: 6600, costPrice: 5600, reorderLevel: 8 },
    { id: 'prod_nbi_rebar_12mm', sku: 'NBI-IRB-0001', name: 'Rebar 12mm x 12m', categoryId: 'cat_nbi_iron_bars', unitType: 'PIECE', quantityInStock: 350, pricePerUnit: 1220, costPrice: 1070, reorderLevel: 100 },
    { id: 'prod_nbi_spade', sku: 'NBI-TL-0001', name: 'Spade (Heavy Duty)', categoryId: 'cat_nbi_tools', unitType: 'PIECE', quantityInStock: 35, pricePerUnit: 1250, costPrice: 950, reorderLevel: 15 },
    { id: 'prod_nbi_pvc_4inch', sku: 'NBI-PLM-0001', name: 'PVC Pipe 4-inch x 3m', categoryId: 'cat_nbi_plumbing', unitType: 'PIECE', quantityInStock: 100, pricePerUnit: 820, costPrice: 620, reorderLevel: 30 },
    { id: 'prod_nbi_nails_4inch', sku: 'NBI-NAS-0001', name: '4-inch Nails', categoryId: 'cat_nbi_nails_screws', unitType: 'KILOGRAM', quantityInStock: 400, pricePerUnit: 155, costPrice: 115, reorderLevel: 100 },
    { id: 'prod_nbi_helmet', sku: 'NBI-SFT-0001', name: 'Safety Helmet (Hard Hat)', categoryId: 'cat_nbi_safety', unitType: 'PIECE', quantityInStock: 50, pricePerUnit: 1500, costPrice: 1000, reorderLevel: 15 },
    { id: 'prod_nbi_boots', sku: 'NBI-SFT-0002', name: 'Safety Boots (Steel Toe)', categoryId: 'cat_nbi_safety', unitType: 'PAIR', quantityInStock: 40, pricePerUnit: 3500, costPrice: 2500, reorderLevel: 10 },
  ];
  for (const product of nbiProducts) { await prisma.product.create({ data: { ...product, storeId: storeNairobiCbd.id } as any }); }

  const nbiCustomers = [
    { id: 'cust_nbi_1', storeId: storeNairobiCbd.id, name: 'Westlands Contractors Ltd', phone: '0735123456', email: 'info@westlandscontractors.co.ke', idNumber: '50104567', debtLimit: 500000, currentDebtBalance: 125000 },
    { id: 'cust_nbi_2', storeId: storeNairobiCbd.id, name: 'Agnes Wanjiru', phone: '0736234567', email: 'agnes.w@email.com', idNumber: '51215678', debtLimit: 75000, currentDebtBalance: 0 },
    { id: 'cust_nbi_3', storeId: storeNairobiCbd.id, name: 'Kenya Housing Corp.', phone: '0737345678', email: 'procurement@kenyahousing.co.ke', idNumber: '52326789', debtLimit: 1000000, currentDebtBalance: 350000 },
    { id: 'cust_nbi_4', storeId: storeNairobiCbd.id, name: 'Hassan Ali Mohamed', phone: '0738456789', email: 'hassan.ali@email.com', idNumber: '53437890', debtLimit: 100000, currentDebtBalance: 22000 },
  ];
  for (const cust of nbiCustomers) { await prisma.customer.create({ data: cust }); }

  // ---- NAKURU BRANCH ----
  const nkrCats = [
    { id: 'cat_nkr_cement', storeId: storeNakuru.id, name: 'Cement', description: 'All types of cement', icon: 'building', color: '#8B7355', sortOrder: 1 },
    { id: 'cat_nkr_iron_sheets', storeId: storeNakuru.id, name: 'Iron Sheets', description: 'Roofing iron sheets', icon: 'layout-grid', color: '#4A5568', sortOrder: 2 },
    { id: 'cat_nkr_paints', storeId: storeNakuru.id, name: 'Paints', description: 'Interior and exterior paints', icon: 'palette', color: '#E53E3E', sortOrder: 3 },
    { id: 'cat_nkr_iron_bars', storeId: storeNakuru.id, name: 'Iron Bars', description: 'Reinforcement iron bars', icon: 'minus', color: '#718096', sortOrder: 4 },
    { id: 'cat_nkr_tools', storeId: storeNakuru.id, name: 'Tools', description: 'Construction tools and equipment', icon: 'wrench', color: '#2D3748', sortOrder: 5 },
    { id: 'cat_nkr_plumbing', storeId: storeNakuru.id, name: 'Plumbing', description: 'Pipes, fittings, and plumbing supplies', icon: 'droplets', color: '#3182CE', sortOrder: 6 },
    { id: 'cat_nkr_nails_screws', storeId: storeNakuru.id, name: 'Nails & Screws', description: 'Fasteners, nails, and screws', icon: 'pin', color: '#38A169', sortOrder: 7 },
    { id: 'cat_nkr_water_tanks', storeId: storeNakuru.id, name: 'Water Tanks', description: 'Water storage tanks and accessories', icon: 'container', color: '#2B6CB0', sortOrder: 8 },
  ];
  for (const cat of nkrCats) { await prisma.productCategory.create({ data: cat }); }

  const nkrProducts = [
    { id: 'prod_nkr_cement_bamburi', sku: 'NKR-CEM-0001', name: 'Bamburi Cement 50kg', categoryId: 'cat_nkr_cement', unitType: 'BAG', quantityInStock: 130, pricePerUnit: 740, costPrice: 670, reorderLevel: 50 },
    { id: 'prod_nkr_cement_simba', sku: 'NKR-CEM-0002', name: 'Simba Cement 50kg', categoryId: 'cat_nkr_cement', unitType: 'BAG', quantityInStock: 90, pricePerUnit: 710, costPrice: 640, reorderLevel: 50 },
    { id: 'prod_nkr_mabati_30', sku: 'NKR-IRS-0001', name: 'Mabati 30-Gauge (8ft)', categoryId: 'cat_nkr_iron_sheets', unitType: 'PIECE', quantityInStock: 200, pricePerUnit: 640, costPrice: 575, reorderLevel: 100 },
    { id: 'prod_nkr_mabati_28', sku: 'NKR-IRS-0002', name: 'Mabati 28-Gauge (8ft)', categoryId: 'cat_nkr_iron_sheets', unitType: 'PIECE', quantityInStock: 120, pricePerUnit: 790, costPrice: 710, reorderLevel: 80 },
    { id: 'prod_nkr_dulux_20l', sku: 'NKR-PNT-0001', name: 'Dulux Weathershield 20L', categoryId: 'cat_nkr_paints', unitType: 'PIECE', quantityInStock: 12, pricePerUnit: 8400, costPrice: 7100, reorderLevel: 10 },
    { id: 'prod_nkr_rebar_12mm', sku: 'NKR-IRB-0001', name: 'Rebar 12mm x 12m', categoryId: 'cat_nkr_iron_bars', unitType: 'PIECE', quantityInStock: 160, pricePerUnit: 1180, costPrice: 1030, reorderLevel: 100 },
    { id: 'prod_nkr_spade', sku: 'NKR-TL-0001', name: 'Spade (Heavy Duty)', categoryId: 'cat_nkr_tools', unitType: 'PIECE', quantityInStock: 30, pricePerUnit: 1180, costPrice: 880, reorderLevel: 15 },
    { id: 'prod_nkr_pvc_4inch', sku: 'NKR-PLM-0001', name: 'PVC Pipe 4-inch x 3m', categoryId: 'cat_nkr_plumbing', unitType: 'PIECE', quantityInStock: 60, pricePerUnit: 780, costPrice: 580, reorderLevel: 30 },
    { id: 'prod_nkr_nails_4inch', sku: 'NKR-NAS-0001', name: '4-inch Nails', categoryId: 'cat_nkr_nails_screws', unitType: 'KILOGRAM', quantityInStock: 250, pricePerUnit: 145, costPrice: 108, reorderLevel: 100 },
    { id: 'prod_nkr_tank_1000l', sku: 'NKR-WTK-0001', name: 'Water Tank 1000L (Black)', categoryId: 'cat_nkr_water_tanks', unitType: 'PIECE', quantityInStock: 15, pricePerUnit: 8500, costPrice: 6500, reorderLevel: 5 },
    { id: 'prod_nkr_tank_2300l', sku: 'NKR-WTK-0002', name: 'Water Tank 2300L (Green)', categoryId: 'cat_nkr_water_tanks', unitType: 'PIECE', quantityInStock: 8, pricePerUnit: 16000, costPrice: 12500, reorderLevel: 3 },
  ];
  for (const product of nkrProducts) { await prisma.product.create({ data: { ...product, storeId: storeNakuru.id } as any }); }

  const nkrCustomers = [
    { id: 'cust_nkr_1', storeId: storeNakuru.id, name: 'Naivasha Road Contractors', phone: '0746123456', email: 'info@naivasharoad.co.ke', idNumber: '60104567', debtLimit: 350000, currentDebtBalance: 67000 },
    { id: 'cust_nkr_2', storeId: storeNakuru.id, name: 'Rebecca Chebet', phone: '0747234567', email: 'rebecca.c@email.com', idNumber: '61215678', debtLimit: 55000, currentDebtBalance: 0 },
    { id: 'cust_nkr_3', storeId: storeNakuru.id, name: 'Rift Valley Hardware Distributors', phone: '0748345678', email: 'info@riftvalleyhw.co.ke', idNumber: '62326789', debtLimit: 500000, currentDebtBalance: 180000 },
    { id: 'cust_nkr_4', storeId: storeNakuru.id, name: 'Samuel Kiprono', phone: '0749456789', email: 'samuel.k@email.com', idNumber: '63437890', debtLimit: 90000, currentDebtBalance: 15000 },
  ];
  for (const cust of nkrCustomers) { await prisma.customer.create({ data: cust }); }

  // ==========================================================================
  // 9c. BRANCH-SPECIFIC SALES TRANSACTIONS
  // ==========================================================================
  console.log('Seeding branch sales transactions...');

  // Thika Branch Sales
  const thikaSales = [
    {
      id: 'tx_thk_001', receiptNumber: 'THK-RCPT-001', customerId: 'cust_thk_1', cashierId: 'user_thika_manager',
      subtotal: 15000, taxAmount: 2400, discountAmount: 0, totalAmount: 17400,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(1, 10),
      items: [
        { productId: 'prod_thk_cement_bamburi', productName: 'Bamburi Cement 50kg', quantity: 20, unitType: 'BAG', pricePerUnit: 750, costPrice: 680, lineTotal: 15000 },
      ],
    },
    {
      id: 'tx_thk_002', receiptNumber: 'THK-RCPT-002', customerId: 'cust_thk_2', cashierId: 'user_thika_manager',
      subtotal: 42000, taxAmount: 6720, discountAmount: 2000, totalAmount: 46720,
      paymentMethod: 'MPESA', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(2, 14),
      items: [
        { productId: 'prod_thk_rebar_12mm', productName: 'Rebar 12mm x 12m', quantity: 25, unitType: 'PIECE', pricePerUnit: 1200, costPrice: 1050, lineTotal: 30000 },
        { productId: 'prod_thk_timber_2x4', productName: 'Timber 2x4 x 12ft (Cypress)', quantity: 15, unitType: 'PIECE', pricePerUnit: 800, costPrice: 600, lineTotal: 12000 },
      ],
    },
    {
      id: 'tx_thk_003', receiptNumber: 'THK-RCPT-003', customerId: null, cashierId: 'user_thika_manager',
      subtotal: 2600, taxAmount: 416, discountAmount: 0, totalAmount: 3016,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(3, 9),
      items: [
        { productId: 'prod_thk_spade', productName: 'Spade (Heavy Duty)', quantity: 1, unitType: 'PIECE', pricePerUnit: 1200, costPrice: 900, lineTotal: 1200 },
        { productId: 'prod_thk_nails_4inch', productName: '4-inch Nails', quantity: 5, unitType: 'KILOGRAM', pricePerUnit: 150, costPrice: 110, lineTotal: 750 },
        { productId: 'prod_thk_mabati_30', productName: 'Mabati 30-Gauge (8ft)', quantity: 1, unitType: 'PIECE', pricePerUnit: 650, costPrice: 580, lineTotal: 650 },
      ],
    },
  ];

  for (const sale of thikaSales) {
    await prisma.salesTransaction.create({
      data: {
        id: sale.id, storeId: storeThika.id, receiptNumber: sale.receiptNumber,
        customerId: sale.customerId, cashierId: sale.cashierId,
        subtotal: sale.subtotal, taxAmount: sale.taxAmount, discountAmount: sale.discountAmount, totalAmount: sale.totalAmount,
        paymentMethod: sale.paymentMethod, paymentStatus: sale.paymentStatus, transactionType: sale.transactionType,
        createdAt: sale.createdAt,
        items: { create: sale.items },
        payments: { create: { storeId: storeThika.id, paymentMethod: sale.paymentMethod === 'SPLIT' ? 'CASH' : sale.paymentMethod, amount: sale.paymentMethod === 'DEBT' ? 0 : sale.totalAmount, status: 'COMPLETED' } },
      },
    });
  }

  // Ruiru Branch Sales
  const ruiruSales = [
    {
      id: 'tx_ruiru_001', receiptNumber: 'RUR-RCPT-001', customerId: 'cust_ruiru_2', cashierId: 'user_ruiru_manager',
      subtotal: 32000, taxAmount: 5120, discountAmount: 1500, totalAmount: 35620,
      paymentMethod: 'MPESA', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(0, 11),
      items: [
        { productId: 'prod_ruiru_cement_bamburi', productName: 'Bamburi Cement 50kg', quantity: 30, unitType: 'BAG', pricePerUnit: 750, costPrice: 680, lineTotal: 22500 },
        { productId: 'prod_ruiru_mabati_30', productName: 'Mabati 30-Gauge (8ft)', quantity: 10, unitType: 'PIECE', pricePerUnit: 650, costPrice: 580, lineTotal: 6500 },
        { productId: 'prod_ruiru_nails_4inch', productName: '4-inch Nails', quantity: 20, unitType: 'KILOGRAM', pricePerUnit: 150, costPrice: 110, lineTotal: 3000 },
      ],
    },
    {
      id: 'tx_ruiru_002', receiptNumber: 'RUR-RCPT-002', customerId: 'cust_ruiru_1', cashierId: 'user_ruiru_manager',
      subtotal: 9200, taxAmount: 1472, discountAmount: 0, totalAmount: 10672,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(2, 10),
      items: [
        { productId: 'prod_ruiru_rebar_10mm', productName: 'Rebar 10mm x 12m', quantity: 8, unitType: 'PIECE', pricePerUnit: 900, costPrice: 780, lineTotal: 7200 },
        { productId: 'prod_ruiru_pvc_4inch', productName: 'PVC Pipe 4-inch x 3m', quantity: 2, unitType: 'PIECE', pricePerUnit: 800, costPrice: 600, lineTotal: 1600 },
        { productId: 'prod_ruiru_nails_4inch', productName: '4-inch Nails', quantity: 2, unitType: 'KILOGRAM', pricePerUnit: 150, costPrice: 110, lineTotal: 300 },
        { productId: 'prod_ruiru_spade', productName: 'Spade (Heavy Duty)', quantity: 1, unitType: 'PIECE', pricePerUnit: 1200, costPrice: 900, lineTotal: 1200 },
      ],
    },
    {
      id: 'tx_ruiru_003', receiptNumber: 'RUR-RCPT-003', customerId: 'cust_ruiru_4', cashierId: 'user_ruiru_manager',
      subtotal: 25500, taxAmount: 4080, discountAmount: 1000, totalAmount: 28580,
      paymentMethod: 'DEBT', paymentStatus: 'PARTIAL', transactionType: 'SALE',
      createdAt: daysAgoAtHour(4, 15),
      items: [
        { productId: 'prod_ruiru_cement_simba', productName: 'Simba Cement 50kg', quantity: 25, unitType: 'BAG', pricePerUnit: 720, costPrice: 650, lineTotal: 18000 },
        { productId: 'prod_ruiru_mabati_28', productName: 'Mabati 28-Gauge (8ft)', quantity: 5, unitType: 'PIECE', pricePerUnit: 800, costPrice: 720, lineTotal: 4000 },
        { productId: 'prod_ruiru_cable_2_5mm', productName: 'Cable 2.5mm x 100m', quantity: 1, unitType: 'PIECE', pricePerUnit: 8500, costPrice: 7000, lineTotal: 8500 },
      ],
    },
  ];

  for (const sale of ruiruSales) {
    await prisma.salesTransaction.create({
      data: {
        id: sale.id, storeId: storeRuiru.id, receiptNumber: sale.receiptNumber,
        customerId: sale.customerId, cashierId: sale.cashierId,
        subtotal: sale.subtotal, taxAmount: sale.taxAmount, discountAmount: sale.discountAmount, totalAmount: sale.totalAmount,
        paymentMethod: sale.paymentMethod, paymentStatus: sale.paymentStatus, transactionType: sale.transactionType,
        createdAt: sale.createdAt,
        items: { create: sale.items },
        payments: { create: { storeId: storeRuiru.id, paymentMethod: sale.paymentMethod === 'SPLIT' ? 'CASH' : sale.paymentMethod, amount: sale.paymentMethod === 'DEBT' ? 0 : sale.totalAmount, status: 'COMPLETED' } },
      },
    });
  }

  // Nairobi CBD Branch Sales
  const nairobiSales = [
    {
      id: 'tx_nbi_001', receiptNumber: 'NBI-RCPT-001', customerId: 'cust_nbi_3', cashierId: 'user_nairobi_manager',
      subtotal: 96000, taxAmount: 15360, discountAmount: 5000, totalAmount: 106360,
      paymentMethod: 'MPESA', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(0, 9),
      items: [
        { productId: 'prod_nbi_cement_bamburi', productName: 'Bamburi Cement 50kg', quantity: 80, unitType: 'BAG', pricePerUnit: 760, costPrice: 690, lineTotal: 60800 },
        { productId: 'prod_nbi_rebar_12mm', productName: 'Rebar 12mm x 12m', quantity: 20, unitType: 'PIECE', pricePerUnit: 1220, costPrice: 1070, lineTotal: 24400 },
        { productId: 'prod_nbi_helmet', productName: 'Safety Helmet (Hard Hat)', quantity: 5, unitType: 'PIECE', pricePerUnit: 1500, costPrice: 1000, lineTotal: 7500 },
        { productId: 'prod_nbi_boots', productName: 'Safety Boots (Steel Toe)', quantity: 2, unitType: 'PAIR', pricePerUnit: 3500, costPrice: 2500, lineTotal: 7000 },
      ],
    },
    {
      id: 'tx_nbi_002', receiptNumber: 'NBI-RCPT-002', customerId: 'cust_nbi_2', cashierId: 'user_nairobi_manager',
      subtotal: 15200, taxAmount: 2432, discountAmount: 0, totalAmount: 17632,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(1, 14),
      items: [
        { productId: 'prod_nbi_dulux_20l', productName: 'Dulux Weathershield 20L', quantity: 1, unitType: 'PIECE', pricePerUnit: 8600, costPrice: 7300, lineTotal: 8600 },
        { productId: 'prod_nbi_crown_20l', productName: 'Crown Vinyl Silk 20L', quantity: 1, unitType: 'PIECE', pricePerUnit: 6600, costPrice: 5600, lineTotal: 6600 },
      ],
    },
    {
      id: 'tx_nbi_003', receiptNumber: 'NBI-RCPT-003', customerId: null, cashierId: 'user_nairobi_manager',
      subtotal: 7800, taxAmount: 1248, discountAmount: 0, totalAmount: 9048,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(3, 11),
      items: [
        { productId: 'prod_nbi_mabati_30', productName: 'Mabati 30-Gauge (8ft)', quantity: 10, unitType: 'PIECE', pricePerUnit: 660, costPrice: 590, lineTotal: 6600 },
        { productId: 'prod_nbi_nails_4inch', productName: '4-inch Nails', quantity: 8, unitType: 'KILOGRAM', pricePerUnit: 155, costPrice: 115, lineTotal: 1240 },
      ],
    },
  ];

  for (const sale of nairobiSales) {
    await prisma.salesTransaction.create({
      data: {
        id: sale.id, storeId: storeNairobiCbd.id, receiptNumber: sale.receiptNumber,
        customerId: sale.customerId, cashierId: sale.cashierId,
        subtotal: sale.subtotal, taxAmount: sale.taxAmount, discountAmount: sale.discountAmount, totalAmount: sale.totalAmount,
        paymentMethod: sale.paymentMethod, paymentStatus: sale.paymentStatus, transactionType: sale.transactionType,
        createdAt: sale.createdAt,
        items: { create: sale.items },
        payments: { create: { storeId: storeNairobiCbd.id, paymentMethod: sale.paymentMethod === 'SPLIT' ? 'CASH' : sale.paymentMethod, amount: sale.paymentMethod === 'DEBT' ? 0 : sale.totalAmount, status: 'COMPLETED' } },
      },
    });
  }

  // Nakuru Branch Sales
  const nakuruSales = [
    {
      id: 'tx_nkr_001', receiptNumber: 'NKR-RCPT-001', customerId: 'cust_nkr_1', cashierId: 'user_nakuru_manager',
      subtotal: 57000, taxAmount: 9120, discountAmount: 3000, totalAmount: 63120,
      paymentMethod: 'MPESA', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(0, 12),
      items: [
        { productId: 'prod_nkr_cement_bamburi', productName: 'Bamburi Cement 50kg', quantity: 50, unitType: 'BAG', pricePerUnit: 740, costPrice: 670, lineTotal: 37000 },
        { productId: 'prod_nkr_mabati_28', productName: 'Mabati 28-Gauge (8ft)', quantity: 20, unitType: 'PIECE', pricePerUnit: 790, costPrice: 710, lineTotal: 15800 },
        { productId: 'prod_nkr_tank_1000l', productName: 'Water Tank 1000L (Black)', quantity: 1, unitType: 'PIECE', pricePerUnit: 8500, costPrice: 6500, lineTotal: 8500 },
      ],
    },
    {
      id: 'tx_nkr_002', receiptNumber: 'NKR-RCPT-002', customerId: 'cust_nkr_3', cashierId: 'user_nakuru_manager',
      subtotal: 35400, taxAmount: 5664, discountAmount: 2000, totalAmount: 39064,
      paymentMethod: 'DEBT', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(2, 10),
      items: [
        { productId: 'prod_nkr_rebar_12mm', productName: 'Rebar 12mm x 12m', quantity: 20, unitType: 'PIECE', pricePerUnit: 1180, costPrice: 1030, lineTotal: 23600 },
        { productId: 'prod_nkr_cement_simba', productName: 'Simba Cement 50kg', quantity: 15, unitType: 'BAG', pricePerUnit: 710, costPrice: 640, lineTotal: 10650 },
        { productId: 'prod_nkr_tank_2300l', productName: 'Water Tank 2300L (Green)', quantity: 1, unitType: 'PIECE', pricePerUnit: 16000, costPrice: 12500, lineTotal: 16000 },
      ],
    },
    {
      id: 'tx_nkr_003', receiptNumber: 'NKR-RCPT-003', customerId: 'cust_nkr_4', cashierId: 'user_nakuru_manager',
      subtotal: 5100, taxAmount: 816, discountAmount: 0, totalAmount: 5916,
      paymentMethod: 'CASH', paymentStatus: 'COMPLETED', transactionType: 'SALE',
      createdAt: daysAgoAtHour(4, 14),
      items: [
        { productId: 'prod_nkr_spade', productName: 'Spade (Heavy Duty)', quantity: 2, unitType: 'PIECE', pricePerUnit: 1180, costPrice: 880, lineTotal: 2360 },
        { productId: 'prod_nkr_pvc_4inch', productName: 'PVC Pipe 4-inch x 3m', quantity: 3, unitType: 'PIECE', pricePerUnit: 780, costPrice: 580, lineTotal: 2340 },
        { productId: 'prod_nkr_nails_4inch', productName: '4-inch Nails', quantity: 2, unitType: 'KILOGRAM', pricePerUnit: 145, costPrice: 108, lineTotal: 290 },
      ],
    },
  ];

  for (const sale of nakuruSales) {
    await prisma.salesTransaction.create({
      data: {
        id: sale.id, storeId: storeNakuru.id, receiptNumber: sale.receiptNumber,
        customerId: sale.customerId, cashierId: sale.cashierId,
        subtotal: sale.subtotal, taxAmount: sale.taxAmount, discountAmount: sale.discountAmount, totalAmount: sale.totalAmount,
        paymentMethod: sale.paymentMethod, paymentStatus: sale.paymentStatus, transactionType: sale.transactionType,
        createdAt: sale.createdAt,
        items: { create: sale.items },
        payments: { create: { storeId: storeNakuru.id, paymentMethod: sale.paymentMethod === 'SPLIT' ? 'CASH' : sale.paymentMethod, amount: sale.paymentMethod === 'DEBT' ? 0 : sale.totalAmount, status: 'COMPLETED' } },
      },
    });
  }

  // ==========================================================================
  // 9d. BRANCH-SPECIFIC EXPENSES
  // ==========================================================================
  console.log('Seeding branch expenses...');

  const branchExpenses = [
    { storeId: storeThika.id, description: 'Thika branch rent - January', amount: 20000, category: 'RENT', paidBy: 'user_thika_manager', paymentMethod: 'MPESA', notes: 'Monthly rent for Thika shop' },
    { storeId: storeThika.id, description: 'Thika electricity bill', amount: 3500, category: 'UTILITIES', paidBy: 'user_thika_manager', paymentMethod: 'MPESA', notes: 'Kenya Power bill' },
    { storeId: storeRuiru.id, description: 'Ruiru branch rent - January', amount: 18000, category: 'RENT', paidBy: 'user_ruiru_manager', paymentMethod: 'MPESA', notes: 'Monthly rent for Ruiru shop' },
    { storeId: storeRuiru.id, description: 'Ruiru water bill', amount: 2000, category: 'UTILITIES', paidBy: 'user_ruiru_manager', paymentMethod: 'CASH', notes: 'Ruiru water bill' },
    { storeId: storeNairobiCbd.id, description: 'Nairobi CBD branch rent - January', amount: 45000, category: 'RENT', paidBy: 'user_nairobi_manager', paymentMethod: 'MPESA', notes: 'Monthly rent for CBD shop' },
    { storeId: storeNairobiCbd.id, description: 'CBD security services', amount: 8000, category: 'SECURITY', paidBy: 'user_nairobi_manager', paymentMethod: 'MPESA', notes: 'Monthly security guard fee' },
    { storeId: storeNakuru.id, description: 'Nakuru branch rent - January', amount: 15000, category: 'RENT', paidBy: 'user_nakuru_manager', paymentMethod: 'MPESA', notes: 'Monthly rent for Nakuru shop' },
    { storeId: storeNakuru.id, description: 'Nakuru transport costs', amount: 5000, category: 'TRANSPORT', paidBy: 'user_nakuru_manager', paymentMethod: 'CASH', notes: 'Delivery truck fuel' },
  ];
  for (const expense of branchExpenses) {
    await prisma.expense.create({ data: expense });
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
  console.log('Seeding sales transactions...');

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
  console.log('Seeding debt ledgers...');

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
  console.log('Seeding equipment rentals...');

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
  console.log('Seeding stock movements...');

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
  console.log('Seeding cash drawer logs...');

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
  console.log('Seeding expenses...');

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
  console.log('Seeding system logs...');

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
  // 18. SEED SUPPLIERS FOR EACH BRANCH
  // ==========================================================================
  console.log('Seeding suppliers...');

  const suppliers = [
    // Juja Main suppliers
    { id: 'sup_juja_bamburi', storeId: store.id, name: 'Bamburi Cement Ltd', email: 'orders@bamburi.co.ke', phone: '0207654321', address: 'Mombasa Road, Nairobi', city: 'Nairobi', contactPerson: 'James Mwangi', taxPin: 'P058765432B', paymentTerms: 'NET_30', rating: 5, notes: 'Primary cement supplier' },
    { id: 'sup_juja_mabati', storeId: store.id, name: 'Mabati Rolling Mills', email: 'sales@mabati.co.ke', phone: '0207654322', address: 'Industrial Area, Nairobi', city: 'Nairobi', contactPerson: 'Ahmed Yusuf', taxPin: 'P058765433C', paymentTerms: 'NET_30', rating: 4, notes: 'Iron sheets and roofing supplier' },
    { id: 'sup_juja_dulux', storeId: store.id, name: 'AkzoNobel Kenya (Dulux)', email: 'orders@akzonobel.co.ke', phone: '0207654323', address: 'Likoni Road, Nairobi', city: 'Nairobi', contactPerson: 'Priti Sharma', taxPin: 'P058765434D', paymentTerms: 'NET_15', rating: 4 },
    // Thika suppliers
    { id: 'sup_thk_cement', storeId: storeThika.id, name: 'Simba Cement (National)', email: 'supply@simbacement.co.ke', phone: '0207654324', address: 'Thika Road, Nairobi', city: 'Nairobi', contactPerson: 'Francis Karanja', taxPin: 'P058765435E', paymentTerms: 'NET_30', rating: 4 },
    { id: 'sup_thk_timber', storeId: storeThika.id, name: 'Mount Kenya Timber', email: 'sales@mtkenyatimber.co.ke', phone: '0207654325', address: 'Thika Town', city: 'Thika', contactPerson: 'Ndirangu Gicheha', taxPin: 'P058765436F', paymentTerms: 'IMMEDIATE', rating: 3, notes: 'Local timber supplier' },
    // Ruiru suppliers
    { id: 'sup_ruiru_hardware', storeId: storeRuiru.id, name: 'Ruiru Hardware Wholesalers', email: 'wholesale@ruiruhw.co.ke', phone: '0207654326', address: 'Ruiru Town', city: 'Ruiru', contactPerson: 'Muthoni Kamau', taxPin: 'P058765437G', paymentTerms: 'NET_15', rating: 3 },
    { id: 'sup_ruiru_rebar', storeId: storeRuiru.id, name: 'Devki Steel Mills', email: 'orders@devki.co.ke', phone: '0207654327', address: 'Ruiru Industrial Area', city: 'Ruiru', contactPerson: 'Narendra Raval', taxPin: 'P058765438H', paymentTerms: 'NET_30', rating: 5, notes: 'Steel and rebar supplier' },
    // Nairobi CBD suppliers
    { id: 'sup_nbi_crown', storeId: storeNairobiCbd.id, name: 'Crown Paints Kenya', email: 'orders@crownpaints.co.ke', phone: '0207654328', address: 'Industrial Area, Nairobi', city: 'Nairobi', contactPerson: 'Wangari Ndirangu', taxPin: 'P058765439I', paymentTerms: 'NET_30', rating: 4 },
    { id: 'sup_nbi_safety', storeId: storeNairobiCbd.id, name: 'Safety Kenya Ltd', email: 'supply@safetykenya.co.ke', phone: '0207654329', address: 'Enterprise Road, Nairobi', city: 'Nairobi', contactPerson: 'Thomas Ochieng', taxPin: 'P058765430J', paymentTerms: 'NET_15', rating: 4, notes: 'PPE and safety equipment' },
    // Nakuru suppliers
    { id: 'sup_nkr_cement', storeId: storeNakuru.id, name: 'Bamburi Cement (Nakuru Depot)', email: 'nakuru@bamburi.co.ke', phone: '0207654330', address: 'Nakuru Industrial Area', city: 'Nakuru', contactPerson: 'Kiprono Bett', taxPin: 'P058765431K', paymentTerms: 'NET_30', rating: 5 },
    { id: 'sup_nkr_tanks', storeId: storeNakuru.id, name: 'Kentank Nakuru', email: 'sales@kentank.co.ke', phone: '0207654331', address: 'Nakuru Town', city: 'Nakuru', contactPerson: 'Rachel Tanui', taxPin: 'P058765432L', paymentTerms: 'NET_30', rating: 4, notes: 'Water tanks supplier' },
  ];

  for (const supplier of suppliers) {
    await prisma.supplier.create({ data: supplier });
  }

  // ==========================================================================
  // 19. SEED SUPPLIER ACCOUNTS (Accounts Payable per branch)
  // ==========================================================================
  console.log('Seeding supplier accounts...');

  const supplierAccounts = [
    { organizationId: org.id, code: '2300', name: 'Bamburi Cement - Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { organizationId: org.id, code: '2310', name: 'Mabati Rolling Mills - Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { organizationId: org.id, code: '2320', name: 'AkzoNobel (Dulux) - Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { organizationId: org.id, code: '2330', name: 'Simba Cement - Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { organizationId: org.id, code: '2340', name: 'Devki Steel Mills - Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { organizationId: org.id, code: '2350', name: 'Crown Paints - Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { organizationId: org.id, code: '2360', name: 'General Supplier Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
    { organizationId: org.id, code: '2400', name: 'Gift Cards Outstanding', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
  ];

  for (const acct of supplierAccounts) {
    await prisma.account.create({ data: acct });
  }

  // ==========================================================================
  // 20. SEED GIFT CARDS
  // ==========================================================================
  console.log('Seeding gift cards...');

  // -- Juja Main --
  const gc1 = await prisma.giftCard.create({
    data: {
      id: 'gc_active_0001',
      storeId: store.id,
      code: 'GC-ACTIVE-0001',
      reason: 'CUSTOMER_LOYALTY',
      initialBalance: 5000,
      currentBalance: 3500,
      status: 'PARTIALLY_REDEEMED',
      recipientName: 'John Kamau',
      recipientPhone: '0722123456',
      issuedTo: 'cust_1',
      issuedBy: 'user_super_admin',
      autoAdjustItems: true,
      createdAt: daysAgo(30),
    },
  });

  const gc2 = await prisma.giftCard.create({
    data: {
      id: 'gc_active_0002',
      storeId: store.id,
      code: 'GC-ACTIVE-0002',
      reason: 'PROMOTION',
      initialBalance: 2000,
      currentBalance: 2000,
      status: 'ACTIVE',
      recipientName: 'Walk-in Customer',
      issuedBy: 'user_cashier_1',
      autoAdjustItems: true,
      createdAt: daysAgo(14),
    },
  });

  const gc3 = await prisma.giftCard.create({
    data: {
      id: 'gc_redeemed_0001',
      storeId: store.id,
      code: 'GC-REDEEMED-0001',
      reason: 'REFUND_CREDIT',
      initialBalance: 10000,
      currentBalance: 0,
      status: 'REDEEMED',
      recipientName: 'Mary Njeri',
      recipientPhone: '0733234567',
      issuedTo: 'cust_2',
      issuedBy: 'user_super_admin',
      lastRedeemedAt: daysAgo(1),
      autoAdjustItems: false,
      isVisible: false,
      createdAt: daysAgo(60),
    },
  });

  const gc4 = await prisma.giftCard.create({
    data: {
      id: 'gc_gift_0001',
      storeId: store.id,
      code: 'GC-GIFT-0001',
      reason: 'GIFT',
      initialBalance: 15000,
      currentBalance: 15000,
      status: 'ACTIVE',
      recipientName: 'Peter Odhiambo',
      recipientPhone: '0745345678',
      issuedTo: 'cust_3',
      issuedBy: 'user_super_admin',
      expiresAt: daysFromNow(90),
      autoAdjustItems: true,
      createdAt: daysAgo(7),
    },
  });

  // -- Thika --
  const gc5 = await prisma.giftCard.create({
    data: {
      id: 'gc_thk_0001',
      storeId: storeThika.id,
      code: 'GC-THK-0001',
      reason: 'STORE_CREDIT',
      initialBalance: 8000,
      currentBalance: 4500,
      status: 'PARTIALLY_REDEEMED',
      recipientName: 'Francis Maina',
      recipientPhone: '0715123456',
      issuedTo: 'cust_thk_1',
      issuedBy: 'user_thika_manager',
      autoAdjustItems: true,
      createdAt: daysAgo(20),
    },
  });

  const gc6 = await prisma.giftCard.create({
    data: {
      id: 'gc_thk_0002',
      storeId: storeThika.id,
      code: 'GC-THK-0002',
      reason: 'EMPLOYEE_AWARD',
      initialBalance: 3000,
      currentBalance: 3000,
      status: 'ACTIVE',
      recipientName: 'Staff Reward',
      issuedBy: 'user_thika_manager',
      autoAdjustItems: false,
      createdAt: daysAgo(5),
    },
  });

  // -- Ruiru --
  const gc7 = await prisma.giftCard.create({
    data: {
      id: 'gc_rur_0001',
      storeId: storeRuiru.id,
      code: 'GC-RUR-0001',
      reason: 'CUSTOMER_LOYALTY',
      initialBalance: 7500,
      currentBalance: 7500,
      status: 'ACTIVE',
      recipientName: 'Esther Nyambura',
      recipientPhone: '0724123456',
      issuedTo: 'cust_ruiru_1',
      issuedBy: 'user_ruiru_manager',
      autoAdjustItems: true,
      createdAt: daysAgo(10),
    },
  });

  const gc8 = await prisma.giftCard.create({
    data: {
      id: 'gc_rur_0002',
      storeId: storeRuiru.id,
      code: 'GC-RUR-0002',
      reason: 'COMPLAINT_RESOLUTION',
      initialBalance: 5000,
      currentBalance: 0,
      status: 'CANCELLED',
      recipientName: 'Joseph Gathua',
      issuedBy: 'user_ruiru_manager',
      autoAdjustItems: true,
      isVisible: false,
      createdAt: daysAgo(45),
    },
  });

  // -- Nairobi CBD --
  const gc9 = await prisma.giftCard.create({
    data: {
      id: 'gc_nbi_0001',
      storeId: storeNairobiCbd.id,
      code: 'GC-NBI-0001',
      reason: 'PROMOTION',
      initialBalance: 20000,
      currentBalance: 12500,
      status: 'PARTIALLY_REDEEMED',
      recipientName: 'Westlands Contractors Ltd',
      issuedTo: 'cust_nbi_1',
      issuedBy: 'user_nairobi_manager',
      autoAdjustItems: true,
      createdAt: daysAgo(25),
    },
  });

  const gc10 = await prisma.giftCard.create({
    data: {
      id: 'gc_nbi_0002',
      storeId: storeNairobiCbd.id,
      code: 'GC-NBI-0002',
      reason: 'GIFT',
      initialBalance: 5000,
      currentBalance: 5000,
      status: 'ACTIVE',
      recipientName: 'Agnes Wanjiru',
      issuedTo: 'cust_nbi_2',
      issuedBy: 'user_nairobi_manager',
      expiresAt: daysFromNow(60),
      autoAdjustItems: false,
      createdAt: daysAgo(3),
    },
  });

  const gc11 = await prisma.giftCard.create({
    data: {
      id: 'gc_nbi_0003',
      storeId: storeNairobiCbd.id,
      code: 'GC-NBI-0003',
      reason: 'REFUND_CREDIT',
      initialBalance: 3500,
      currentBalance: 0,
      status: 'REDEEMED',
      recipientName: 'Hassan Ali Mohamed',
      issuedTo: 'cust_nbi_4',
      issuedBy: 'user_nairobi_manager',
      lastRedeemedAt: daysAgo(2),
      autoAdjustItems: false,
      isVisible: false,
      createdAt: daysAgo(15),
    },
  });

  // -- Nakuru --
  const gc12 = await prisma.giftCard.create({
    data: {
      id: 'gc_nkr_0001',
      storeId: storeNakuru.id,
      code: 'GC-NKR-0001',
      reason: 'CUSTOMER_LOYALTY',
      initialBalance: 10000,
      currentBalance: 6700,
      status: 'PARTIALLY_REDEEMED',
      recipientName: 'Naivasha Road Contractors',
      issuedTo: 'cust_nkr_1',
      issuedBy: 'user_nakuru_manager',
      autoAdjustItems: true,
      createdAt: daysAgo(35),
    },
  });

  const gc13 = await prisma.giftCard.create({
    data: {
      id: 'gc_nkr_0002',
      storeId: storeNakuru.id,
      code: 'GC-NKR-0002',
      reason: 'STORE_CREDIT',
      initialBalance: 2500,
      currentBalance: 2500,
      status: 'ACTIVE',
      recipientName: 'Rebecca Chebet',
      issuedTo: 'cust_nkr_2',
      issuedBy: 'user_nakuru_manager',
      autoAdjustItems: false,
      createdAt: daysAgo(8),
    },
  });

  const gc14 = await prisma.giftCard.create({
    data: {
      id: 'gc_nkr_0003',
      storeId: storeNakuru.id,
      code: 'GC-NKR-0003',
      reason: 'OTHER',
      initialBalance: 4000,
      currentBalance: 4000,
      status: 'ACTIVE',
      recipientName: 'General Customer',
      issuedBy: 'user_nakuru_manager',
      expiresAt: daysFromNow(120),
      autoAdjustItems: false,
      createdAt: daysAgo(2),
    },
  });

  // ==========================================================================
  // 21. SEED GIFT CARD REDEMPTIONS (for PARTIALLY_REDEEMED cards)
  // ==========================================================================
  console.log('Seeding gift card redemptions...');

  const giftCardRedemptions = [
    // GC-ACTIVE-0001: 5000 - 3500 = 1500 redeemed
    { giftCardId: gc1.id, amount: 1000, redeemedBy: 'user_cashier_1', notes: 'Partial redemption - cement purchase', createdAt: daysAgoAtHour(15, 11) },
    { giftCardId: gc1.id, amount: 500, redeemedBy: 'user_cashier_1', notes: 'Partial redemption - nails purchase', createdAt: daysAgoAtHour(10, 14) },
    // GC-THK-0001: 8000 - 4500 = 3500 redeemed
    { giftCardId: gc5.id, amount: 2000, redeemedBy: 'user_thika_cashier', notes: 'Redemption - cement purchase', createdAt: daysAgoAtHour(12, 10) },
    { giftCardId: gc5.id, amount: 1500, redeemedBy: 'user_thika_cashier', notes: 'Redemption - iron sheets purchase', createdAt: daysAgoAtHour(8, 15) },
    // GC-NBI-0001: 20000 - 12500 = 7500 redeemed
    { giftCardId: gc9.id, amount: 5000, redeemedBy: 'user_nairobi_cashier', notes: 'Redemption - bulk cement order', createdAt: daysAgoAtHour(20, 9) },
    { giftCardId: gc9.id, amount: 2500, redeemedBy: 'user_nairobi_cashier', notes: 'Redemption - paint supplies', createdAt: daysAgoAtHour(10, 13) },
    // GC-NKR-0001: 10000 - 6700 = 3300 redeemed
    { giftCardId: gc12.id, amount: 2000, redeemedBy: 'user_nakuru_cashier', notes: 'Redemption - plumbing supplies', createdAt: daysAgoAtHour(25, 10) },
    { giftCardId: gc12.id, amount: 1300, redeemedBy: 'user_nakuru_cashier', notes: 'Redemption - nails and screws', createdAt: daysAgoAtHour(15, 16) },
    // GC-REDEEMED-0001: fully redeemed
    { giftCardId: gc3.id, amount: 5000, redeemedBy: 'user_cashier_1', notes: 'Redemption - building materials', createdAt: daysAgoAtHour(5, 9) },
    { giftCardId: gc3.id, amount: 5000, redeemedBy: 'user_cashier_1', notes: 'Final redemption - remaining balance', createdAt: daysAgo(1) },
    // GC-NBI-0003: fully redeemed
    { giftCardId: gc11.id, amount: 3500, redeemedBy: 'user_nairobi_cashier', notes: 'Full redemption - refund credit', createdAt: daysAgo(2) },
  ];

  for (const redemption of giftCardRedemptions) {
    await prisma.giftCardRedemption.create({ data: redemption });
  }

  // ==========================================================================
  // 22. Log the initialization event
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

  console.log('MBUMAH HARDWARE POS - System initialized successfully!');
  console.log('   📧 Super Admin: admin@mbumahhardware.co.ke');
  console.log('   👑 Store Owner: owner@mbumahhardware.co.ke');
  console.log('   🏪 Stores: 5 branches (Juja Main, Thika, Ruiru, Nairobi CBD, Nakuru)');
  console.log('   👤 Branch Managers: 4 (Thika, Ruiru, Nairobi CBD, Nakuru)');
  console.log('   💰 Branch Cashiers: 5 (Juja Main, Thika, Ruiru, Nairobi CBD, Nakuru)');
  console.log('   Products seeded: ' + (products.length + 1) + ' (Juja Main) + ' + (thkProducts.length + ruiruProducts.length + nbiProducts.length + nkrProducts.length) + ' (branches)');
  console.log('   👥 Customers seeded: ' + customers.length + ' (Juja Main) + ' + (thkCustomers.length + ruiruCustomers.length + nbiCustomers.length + nkrCustomers.length) + ' (branches)');
  console.log('   Accounts seeded: ' + (accounts.length + supplierAccounts.length));
  console.log('   Sales transactions seeded: ' + salesData.length + ' (Juja Main) + ' + (thikaSales.length + ruiruSales.length + nairobiSales.length + nakuruSales.length) + ' (branches)');
  console.log('   Stock movements seeded: ' + stockMovements.length);
  console.log('   🏗️ Equipment rentals seeded: 3');
  console.log('   🗄️ Cash drawer logs seeded: ' + cashDrawerLogs.length);
  console.log('   📝 Expenses seeded: ' + (expenses.length + branchExpenses.length));
  console.log('   🏭 Suppliers seeded: ' + suppliers.length);
  console.log('   🎁 Gift cards seeded: 14');
  console.log('   🎁 Gift card redemptions seeded: ' + giftCardRedemptions.length);

  // H-07: dump the random per-user credentials so operators can retrieve them.
  // (Writes to prisma/.seed-passwords.local and prints to stdout.)
  dumpSeededCredentials();
}

main()
  .catch(e => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
