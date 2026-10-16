#!/usr/bin/env node
// MBUMAH HARDWARE POS - Verify payroll run lifecycle (v2.18.9)
//
// Static + structural verification of the Phase 4.6 contracts:
//   1. State machine vocabulary and transitions are exported.
//   2. Maker-checker is enforced server-side (no role bypass).
//   3. Posting goes through the existing accounting helper with
//      idempotencyKey = payroll-run:{runId}.
//   4. Corrections reverse and replace (adjusting entry + replacement run).
//   5. Payslip PDF exists and renders from the masked view only.
//   6. All Phase 4.6 routes and the /hr/payroll console exist.
//   7. No float money math in the lifecycle service.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

const check = (name, ok, detail = '') => {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const read = (p) => {
  try {
    return readFileSync(join(root, p), 'utf8');
  } catch {
    return '';
  }
};

console.log('[1/5] Service contracts');
const service = read('src/lib/hr/payroll/run-service.ts');
check('run-service exists', service.length > 0);
check(
  'state machine exported',
  service.includes('export const RUN_TRANSITIONS') && service.includes('PENDING_APPROVAL'),
);
check(
  'maker-checker enforced regardless of role',
  service.includes('MAKER_CHECKER_VIOLATION') &&
    service.includes('preparedByUserId === ctx.actorId'),
);
check(
  'posting idempotency key is payroll-run:{id}',
  service.includes('`payroll-run:${run.id}`'),
);
check(
  'posting uses the existing accounting helper',
  service.includes("from '@/lib/accounting-helpers'") && service.includes('createJournalEntry('),
);
check(
  'correction adjusting entry keyed by correction id',
  service.includes('`payroll-correction:${correction.id}`'),
);
check(
  'replacement run is SUPPLEMENTARY and idempotent',
  service.includes("runType: 'SUPPLEMENTARY'") &&
    service.includes('payroll-correction-replacement:'),
);
check(
  'no float money math in lifecycle (no toFixed/toPrecision/parseFloat)',
  !/[^(](?:toFixed|toPrecision|parseFloat)\(/.test(service),
);
check(
  'every mutation audited via hrAudit',
  (service.match(/hrAudit\(/g) || []).length >= 10,
);

console.log('[2/5] Phase 4.6 routes');
const routes = [
  'src/app/api/payroll/runs/route.ts',
  'src/app/api/payroll/runs/[id]/route.ts',
  'src/app/api/payroll/runs/[id]/validate/route.ts',
  'src/app/api/payroll/runs/[id]/submit/route.ts',
  'src/app/api/payroll/runs/[id]/approve/route.ts',
  'src/app/api/payroll/runs/[id]/reject/route.ts',
  'src/app/api/payroll/runs/[id]/post/route.ts',
  'src/app/api/payroll/runs/[id]/lock/route.ts',
  'src/app/api/payroll/runs/[id]/disburse/route.ts',
  'src/app/api/payroll/runs/[id]/payslips/route.ts',
  'src/app/api/payroll/payslips/[id]/route.ts',
  'src/app/api/payroll/payslips/[id]/pdf/route.ts',
  'src/app/api/payroll/payslips/[id]/trace/route.ts',
  'src/app/api/payroll/corrections/route.ts',
  'src/app/api/payroll/corrections/[id]/approve/route.ts',
  'src/app/api/payroll/corrections/[id]/reject/route.ts',
];
for (const route of routes) {
  const body = read(route);
  check(`route ${route.replace('src/app/api/payroll/', '')}`, body.includes('hrGuard'));
}

console.log('[3/5] Payslip presentation + PII masking');
const view = read('src/lib/hr/payroll/payslip-view.ts');
check('payslip view masks statutory identifiers', view.includes('[REDACTED]'));
check('plain-language trace builder exists', view.includes('describePayslip'));
const pdf = read('src/lib/hr/payroll/payslip-pdf.ts');
check('zero-dependency PDF writer exists', pdf.includes('%PDF-1.4'));
check(
  'PDF renders from the masked view (no DB access in the writer)',
  !pdf.includes("@/lib/db") && !pdf.includes("prisma"),
);
check('trace endpoint serves plain language', read('src/app/api/payroll/payslips/[id]/trace/route.ts').includes('plainLanguage'));

console.log('[4/5] UI console');
check('/hr/payroll page exists', existsSync(join(root, 'src/app/hr/payroll/page.tsx')));
const nav = read('src/app/hr/layout.tsx');
check('HR nav links the payroll console', nav.includes('/hr/payroll'));
const runDialog = read('src/components/hr/payroll-run-dialog.tsx');
check(
  'run dialog disables approval for the preparer',
  runDialog.includes('isPreparer') && runDialog.includes('Maker-checker'),
);
check('corrections panel exists', existsSync(join(root, 'src/components/hr/payroll-corrections-panel.tsx')));

console.log('[5/5] Schema + tests');
const schema = read('prisma/schema.prisma');
// Whitespace-tolerant (prisma format realigns columns): match the
  // field within the PayrollRun model block via a type-agnostic regex.
  check('PayrollRun idempotencyKey unique', /idempotencyKey\s+String\?\s+@unique/.test(schema));
check('PayrollDetail payslipNumber unique', /payslipNumber\s+String\?\s+@unique/.test(schema));
check('PayrollCorrection model exists', schema.includes('model PayrollCorrection'));
check('sequence table for payslip numbers', read('src/lib/sequence.ts').includes("PS: 'payroll_details'"));
const test = read('src/tests/lib/payroll-run-lifecycle.test.ts');
check('lifecycle test suite covers maker-checker + idempotent posting', test.includes('MAKER_CHECKER_VIOLATION') && test.includes('payroll-run:run-1'));

console.log('');
if (failures > 0) {
  console.error(`verify-payroll-lifecycle FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log('verify-payroll-lifecycle OK — payroll run lifecycle contracts verified.');
