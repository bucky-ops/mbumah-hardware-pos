#!/usr/bin/env node
/**
 * verify-hr-schema.mjs
 *
 * Verifies the EMS prerequisite schema and chart-of-accounts corrections:
 *   1. JournalEntry carries a nullable unique idempotencyKey.
 *   2. The seed upserts accounts (idempotent seeding) and includes the
 *      payroll statutory liability and employer expense accounts.
 *   3. The account helper resolves gift card liability to 2400 (the seeded
 *      Gift Cards Outstanding account), not 2300 (a supplier payable).
 *   4. createJournalEntry honors idempotent replay.
 *
 * Read-only: never touches the database. Runtime account verification against
 * a live database is available via scripts/seed-payroll-accounts.mjs, which
 * reports present/expected counts and is idempotent.
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';

const root = process.cwd();
let failures = 0;

function check(label, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

function read(relative) {
  return readFileSync(path.join(root, relative), 'utf8');
}

const schema = read('prisma/schema.prisma');
check(
  'JournalEntry.idempotencyKey exists and is unique',
  /idempotencyKey String\?\s+@unique/.test(schema),
);

const seed = read('prisma/seed.ts');
check(
  'seed upserts accounts by organizationId_code',
  /prisma\.account\.upsert\(\{\s*\n\s*where: \{ organizationId_code:/.test(seed),
);
check('seed no longer uses bare account.create loops', !/prisma\.account\.create\(\{ data: acct \}\)/.test(seed));
const payrollCodes = ['2210', '2215', '2220', '2225', '2230', '2240', '2250', '2260', '5210', '5215'];
const missingCodes = payrollCodes.filter((code) => !seed.includes(`code: '${code}'`));
check('seed includes all ten payroll accounts', missingCodes.length === 0);
if (missingCodes.length > 0) {
  console.log(`  missing payroll account codes in seed: ${missingCodes.join(', ')}`);
}

const helper = read('src/lib/account-helper.ts');
check('GIFT_CARD_LIABILITY resolves to 2400', /GIFT_CARD_LIABILITY: '2400'/.test(helper));
check('gift card liability does not point at supplier payable 2300', !/GIFT_CARD_LIABILITY: '2300'/.test(helper));

const accountingHelpers = read('src/lib/accounting-helpers.ts');
check(
  'createJournalEntry performs the idempotent replay lookup',
  /idempotencyKey\)\s*\{[\s\S]{0,400}journalEntry\.findUnique\(\{\s*\n\s*where: \{ idempotencyKey \}/.test(accountingHelpers),
);
check(
  'createJournalEntry persists the idempotency key',
  /idempotencyKey: idempotencyKey \?\? null/.test(accountingHelpers),
);

check('payroll account healing script exists', existsSync(path.join(root, 'scripts/seed-payroll-accounts.mjs')));
check('privacy verification script exists', existsSync(path.join(root, 'scripts/verify-hr-privacy.mjs')));

console.log('');
if (failures > 0) {
  console.log(`verify-hr-schema: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('verify-hr-schema: all checks passed.');
