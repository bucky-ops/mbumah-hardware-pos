#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS — Go-Live Reset (demo-data wipe)
// ============================================================================
// Purpose: after staff has trained on the seeded demo data, this wipes ALL
// transactional history so the shop starts clean for real trading:
//   DELETED: sales transactions, sale items, payments, M-Pesa transactions,
//            receipts, KRA/eTIMS invoices + submissions, debt ledgers/payments
//            + plans, journal entries (demo accounting), stock movements,
//            purchase orders, expenses, chats/messages, notifications,
//            outbox events, shifts, cash-drawer logs, banking movements,
//            loyalty activity, invoices, delivery notes, store transfers,
//            payroll runs, customers, suppliers, employees
//   KEPT:    Organization, stores, users/passwords, RBAC, product catalog,
//            categories, stock levels (Inventory + Product.quantityInStock),
//            chart of accounts, tax config, loyalty tiers/campaigns,
//            gift-card/voucher config, system config, audit & system logs
//
// SAFETY:
//   - Requires typing GO-LIVE-WIPE to confirm
//   - Single Prisma $transaction: any FK error aborts EVERYTHING (no partial wipe)
//   - Table list is resolved dynamically; models that don't exist are skipped
//   - Verifies sales_transactions == 0 afterwards
//
// Usage (close the POS first!):
//   node deploy/nodocker/wipe-demo-data.mjs          (interactive confirm)
//   node deploy/nodocker/wipe-demo-data.mjs --yes    (no prompt — for scripts)
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

// ── Load .env into process.env (standalone scripts don't get it for free) ───
const envPath = join(root, '.env');
if (!existsSync(envPath)) {
  console.error('✗ .env not found in repo root. Install the POS first.');
  process.exit(1);
}
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  if (line.trim().startsWith('#')) continue;
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

const isSqlite = (process.env.DATABASE_URL || '').startsWith('file:');

// ── Deletion order: children first, parents last ────────────────────────────
// Names are Prisma client delegates (camelCase). Aliases cover naming variants.
const WIPE_ORDER = [
  ['kraSubmission'],
  ['invoiceForKRA', 'invoiceForKra'],
  ['invoiceItem'],
  ['invoice'],
  ['deliveryNoteItem'],
  ['deliveryNote'],
  ['receipt'],
  ['giftCardRedemption'],
  ['voucherRedemption'],
  ['loyaltyTransaction'],
  ['customerLoyalty'],
  ['debtPlanInstallment'],
  ['debtPaymentPlan'],
  ['debtPayment'],
  ['debtLedger'],
  ['mpesaTransaction', 'mPesaTransaction'],
  ['payment'],
  ['saleItem'],
  ['salesTransaction'],
  ['storeTransferItem'],
  ['storeTransfer'],
  ['journalEntryLine'],
  ['journalEntry'],
  ['bankTransaction'],
  ['bankReconciliation'],
  ['stockMovement'],
  ['purchaseOrderItem'],
  ['purchaseOrder'],
  ['expense'],
  ['conversationMessage'],
  ['conversation'],
  ['message'],
  ['notification'],
  ['outboxEvent'],
  ['cashDrawerLog'],
  ['shift'],
  ['taxFiling'],
  ['trialBalanceSnapshot'],
  ['budget'],
  ['payrollDetail'],
  ['payrollRun'],
  ['payrollPeriod'],
  ['employeeLeaveBalance'],
  ['employeeAttendance', 'attendance'],
  ['dataExport'],
  ['equipmentRental'],
  ['customerCredit'],
  ['customer'],
  ['supplier'],
  ['employee'],
];

const KEEP_LABELS = [
  ['user', 'Users / logins'],
  ['store', 'Stores'],
  ['product', 'Products (catalog)'],
  ['productCategory', 'Categories'],
  ['account', 'Chart of accounts'],
  ['inventory', 'Stock level records'],
  ['taxRate', 'Tax rates (eTIMS)'],
];

function delegateFor(name) {
  for (const candidate of name) {
    const d = prisma[candidate];
    if (d && typeof d.deleteMany === 'function') return { name: candidate, d };
  }
  return null;
}

const prisma = await (async () => {
  try {
    const mod = await import('@prisma/client');
    return new mod.PrismaClient();
  } catch (e) {
    console.error('✗ Could not load @prisma/client. Run this from the installed repo (node_modules present).');
    console.error(' ' + e.message);
    process.exit(1);
  }
})();

// ── Preflight ────────────────────────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════════════════════════════');
console.log('  MBUMAH HARDWARE POS — GO-LIVE RESET (demo-data wipe)');
console.log('══════════════════════════════════════════════════════════════');
console.log('');
console.log('  CLOSE THE POS WINDOWS FIRST (the database must not be in use).');
console.log('');
console.log('  This DELETES all transactional demo data:');
console.log('    sales, payments, M-Pesa records, receipts, KRA invoices,');
console.log('    debts, journal entries, stock movements, purchase orders,');
console.log('    chats, notifications, shifts, payroll, customers, suppliers,');
console.log('    employees, banking movements.');
console.log('');
console.log('  This KEEPS:');
console.log('    users & passwords, stores, products, categories, stock levels,');
console.log('    chart of accounts, tax config, loyalty/voucher config, settings.');
console.log('');

// Show current volume of demo data
const demoCounts = {};
try {
  demoCounts.salesTransactions = await prisma.salesTransaction.count();
  demoCounts.payments = await prisma.payment.count();
  demoCounts.customers = await prisma.customer.count();
  demoCounts.stockMovements = await prisma.stockMovement.count();
} catch { /* non-fatal preview */ }
console.log(`  Current demo data: ${demoCounts.salesTransactions ?? '?'} sales, ${demoCounts.payments ?? '?'} payments, ${demoCounts.customers ?? '?'} customers, ${demoCounts.stockMovements ?? '?'} stock movements.`);
console.log('');

if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('  Type GO-LIVE-WIPE to confirm (anything else cancels): ')).trim();
  rl.close();
  if (answer !== 'GO-LIVE-WIPE') {
    console.log('\nCancelled — nothing was changed.\n');
    process.exit(0);
  }
}

console.log('');
console.log('Wiping (single atomic transaction — any error aborts everything)...');

const started = Date.now();
try {
  // Pre-count every table we are about to wipe (for the report)
  const steps = [];
  const skipped = [];
  for (const name of WIPE_ORDER) {
    const found = delegateFor(name);
    if (!found) { skipped.push(name[0]); continue; }
    steps.push({ label: found.name, promise: found.d.deleteMany({}) });
  }
  if (skipped.length) {
    console.log(`  (models not present in this schema version — skipped: ${skipped.join(', ')})`);
  }

  const results = await prisma.$transaction(steps.map((s) => s.promise));
  let total = 0;
  steps.forEach((s, i) => {
    const n = results[i]?.count ?? 0;
    total += n;
    if (n > 0) console.log(`  ✓ ${s.label.padEnd(22)} ${String(n).padStart(6)} rows deleted`);
  });
  console.log('  ────────────────────────────────────────────');
  console.log(`  ✓ TOTAL rows deleted: ${total}  in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} catch (err) {
  console.error('');
  console.error('✗ WIPE ABORTED — nothing was changed (transaction rolled back).');
  console.error('  Reason: ' + (err?.message ?? err));
  console.error('  Send this message to your developer.');
  await prisma.$disconnect();
  process.exit(1);
}

// ── Post-verify ──────────────────────────────────────────────────────────────
const remaining = await prisma.salesTransaction.count();
if (remaining !== 0) {
  console.error(`✗ UNEXPECTED: ${remaining} sales transactions remain — investigate before go-live.`);
  await prisma.$disconnect();
  process.exit(1);
}
console.log('  ✓ Verified: 0 sales transactions remain.');

// SQLite housekeeping: checkpoint WAL + reclaim file space
if (isSqlite) {
  try {
    await prisma.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);');
    await prisma.$executeRawUnsafe('VACUUM;');
    console.log('  ✓ Database file compacted (VACUUM).');
  } catch { /* non-fatal */ }
}

console.log('');
console.log('  What remains (your real business setup):');
for (const [name, label] of KEEP_LABELS) {
  try {
    const d = prisma[name];
    if (d && typeof d.count === 'function') console.log(`    ${label.padEnd(26)} ${await d.count()}`);
  } catch { /* skip */ }
}

await prisma.$disconnect();
console.log('');
console.log('──────────────────────────────────────────────────────────────');
console.log('  ✅ GO-LIVE RESET COMPLETE — the shop is ready for real sales.');
console.log("  Next: start the POS, create the client's real products &");
console.log('  customers (or keep the catalog), and set SEED_DATABASE=false.');
console.log('──────────────────────────────────────────────────────────────');
console.log('');
