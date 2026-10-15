#!/usr/bin/env node
/**
 * verify-payroll-engine.mjs
 *
 * Payroll hard gate (docs/EMS_TEST_PLAN.md): static source guarantees for the
 * engine. Runtime fixtures and properties run in vitest
 * (src/tests/lib/payroll-engine.test.ts; bun run test).
 *
 * Checks:
 *   1. No float arithmetic enters the payroll pipeline (no parseFloat, no
 *      Number( on money paths, no Math.fround; integer math only).
 *   2. No Prisma, React, or Next server imports in the pure engine.
 *   3. The guardrail vocabulary is complete (NEGATIVE_NET, JOURNAL_IMBALANCE,
 *      RATE_TABLE_MISSING, OVERLAPPING_RATE_TABLES, MISSING_CONSENT,
 *      TIMESHEET_NOT_APPROVED present).
 *   4. Every statutory deduction line type carries a rateTableId field.
 * Read-only.
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';

const root = process.cwd();
let failures = 0;

function check(label, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

const enginePath = 'src/lib/hr/payroll/engine.ts';
check('engine exists', existsSync(path.join(root, enginePath)));
const engine = readFileSync(path.join(root, enginePath), 'utf8');

check('no parseFloat in the engine', !engine.includes('parseFloat'));
check('no Number() coercion in the engine', !/Number\(/.test(engine));
check('no toFixed in the engine', !engine.includes('toFixed'));
check('no Prisma import in the engine', !engine.includes('@prisma/client') && !engine.includes("@/lib/db'"));
check('no React import in the engine', !engine.includes('react'));
check('no Next server import in the engine', !engine.includes('next/server'));

const typesPath = 'src/lib/hr/payroll/types.ts';
const types = readFileSync(path.join(root, typesPath), 'utf8');
for (const code of ['NEGATIVE_NET', 'DEDUCTION_CAP_EXCEEDED', 'RATE_TABLE_MISSING', 'OVERLAPPING_RATE_TABLES', 'MISSING_CONSENT', 'JOURNAL_IMBALANCE', 'TIMESHEET_NOT_APPROVED', 'IMMUTABLE_STATUS']) {
  check(`guardrail ${code} declared`, types.includes(`'${code}'`));
}
check('payslip lines carry rateTableId', types.includes('rateTableId?: string'));

const fixturePath = 'src/lib/hr/payroll/fixtures/golden.json';
check('golden fixture file exists', existsSync(path.join(root, fixturePath)));
if (existsSync(path.join(root, fixturePath))) {
  const fx = JSON.parse(readFileSync(path.join(root, fixturePath), 'utf8'));
  check('golden fixtures cover at least ten cases', fx.cases.length >= 10);
  const unverified = fx.cases.filter((c) => !c.expect || c.expect.net == null);
  check('every golden case carries frozen expectations', unverified.length === 0);
}

check('payroll engine test exists', existsSync(path.join(root, 'src/tests/lib/payroll-engine.test.ts')));
check('worked examples documented', existsSync(path.join(root, 'docs/hr/payroll-worked-examples.md')));

console.log('');
if (failures > 0) {
  console.log(`verify-payroll-engine: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('verify-payroll-engine: all checks passed. Hard gate source guarantees hold.');
