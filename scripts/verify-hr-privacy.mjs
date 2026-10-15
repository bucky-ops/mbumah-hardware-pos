#!/usr/bin/env node
/**
 * verify-hr-privacy.mjs
 *
 * Static verification that employee PII stays masked by default in export
 * paths and that unmasking is role-gated and audit logged. Exits non-zero on
 * any failed check. Read-only: never touches the database.
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

// 1. The employee export masks statutory identifiers by default.
const exportUtils = read('src/lib/data-export-utils.ts');
check(
  'employee export generator accepts an includeSensitivePii option defaulting to masked output',
  /generateEmployeesCsv\(\s*storeId: string,\s*options\?: \{ includeSensitivePii\?: boolean \}/.test(exportUtils),
);
check(
  'masking covers nationalId, kraPin, nssfNumber, nhifNumber and bankAccountName',
  /EMPLOYEE_PII_FIELDS = \[\s*'nationalId',\s*'kraPin',\s*'nssfNumber',\s*'nhifNumber',\s*'bankAccountName',/.test(exportUtils),
);
check(
  'rows are masked unless includeSensitivePii is explicitly true',
  /const finalRows = includeSensitivePii\s*\? rows\s*:\s*rows\.map/.test(exportUtils) ||
    /includeSensitivePii === true/.test(exportUtils),
);

// 2. The export route role-gates unmasking and audits employee exports.
const route = read('src/app/api/data-exports/route.ts');
check(
  'unmask flag is limited to SUPER_ADMIN and STORE_OWNER',
  /PII_UNMASK_ROLES = \['SUPER_ADMIN', 'STORE_OWNER'\]/.test(route),
);
check(
  'unmask flag only applies to the EMPLOYEES export type',
  /exportType === 'EMPLOYEES' &&\s*\n\s*PII_UNMASK_ROLES/.test(route),
);
check(
  'employee exports write an audit event with piiIncluded metadata',
  /action: 'EXPORT',\s*\n\s*resourceType: 'DataExport'/.test(route) && /piiIncluded: includeSensitivePii/.test(route),
);

// 3. No raw statutory identifiers in the unmasked default: the mask constant exists.
check('mask constant present', /PII_MASK = '\[REDACTED\]'/.test(exportUtils));

// 4. Unit test exists and covers the masking behavior.
const testPath = 'src/__tests__/lib/hr-privacy.test.ts';
check('masking unit test exists', existsSync(path.join(root, testPath)));
if (existsSync(path.join(root, testPath))) {
  const test = read(testPath);
  check('test asserts the masked national ID', /nationalId.*REDACTED|REDACTED.*nationalId/s.test(test));
}

console.log('');
if (failures > 0) {
  console.log(`verify-hr-privacy: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('verify-hr-privacy: all checks passed.');
