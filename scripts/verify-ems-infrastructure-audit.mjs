#!/usr/bin/env node
/**
 * verify-ems-infrastructure-audit.mjs
 *
 * Reproducibility check for the EMS infrastructure audit deliverables and the
 * foundation wiring (v2.18.5). Read-only.
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';

const root = process.cwd();
let failures = 0;

function check(label, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

const AUDIT_DOCS = [
  'docs/EMS_INFRASTRUCTURE_AUDIT.md',
  'docs/EMS_AUDIT_EVIDENCE.md',
  'docs/EMS_RISK_REGISTER.md',
  'docs/EMS_IMPLEMENTATION_GATE.md',
  'docs/EMS_DATA_MODEL_DELTA.md',
  'docs/EMS_INTEGRATION_MAP.md',
  'docs/EMS_RBAC_MATRIX.md',
  'docs/EMS_MIGRATION_PLAN.md',
  'docs/EMS_TEST_PLAN.md',
  'docs/EMS_ENV_AND_DEPLOYMENT_NOTES.md',
  'docs/EMS_SECURITY_PRIVACY_NOTES.md',
  'docs/EMS_README_HYGIENE_FINDINGS.md',
];

for (const doc of AUDIT_DOCS) {
  check(`audit doc exists: ${doc}`, existsSync(path.join(root, doc)));
}

// Foundation modules.
for (const file of [
  'src/lib/hr/roles.ts',
  'src/lib/hr/permissions.ts',
  'src/lib/hr/audit.ts',
  'src/lib/hr/pii.ts',
  'src/lib/hr/feature-flag.ts',
  'src/lib/hr/guard.ts',
  'src/lib/hr/employee-service.ts',
  'src/lib/hr/types.ts',
]) {
  check(`foundation module exists: ${file}`, existsSync(path.join(root, file)));
}

// Schema: the audit-declared additive models exist.
const schema = readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
for (const model of ['EmployeeDocument', 'Position', 'PayGrade', 'SalaryStructure', 'SalaryComponent', 'EmployeeSalaryComponent', 'RateTable', 'RateTableRow', 'RecruitmentJob', 'Applicant', 'ApplicationStage', 'Offer', 'OnboardingPlan', 'OnboardingTask', 'ReviewCycle', 'PerformanceReview', 'Goal', 'DisciplinaryCase', 'AssetAssignment', 'ConsentRecord', 'HrSetting']) {
  check(`schema model exists: ${model}`, new RegExp(`^model ${model} \\{`, 'm').test(schema));
}
check('Employee gains deletedAt', /^  deletedAt DateTime\?/m.test(schema) && schema.includes('reportingToId String?'));

// Scripts.
for (const file of ['scripts/seed-payroll-accounts.mjs', 'scripts/seed-rate-tables.mjs', 'scripts/verify-hr-schema.mjs', 'scripts/verify-hr-privacy.mjs', 'scripts/verify-hr-isolation.mjs']) {
  check(`script exists: ${file}`, existsSync(path.join(root, file)));
}

console.log('');
if (failures > 0) {
  console.log(`verify-ems-infrastructure-audit: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('verify-ems-infrastructure-audit: all checks passed.');
