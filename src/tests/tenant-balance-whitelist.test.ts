import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.43.0 QA FIX — tenant whitelist vs EmployeeLeaveBalance.
 *
 * `employeeLeaveBalance` sat in STORE_SCOPED_MODELS while the model carries
 * NO storeId column. The tenant extension AND-injects `storeId` into every
 * where for store-bound sessions, so EVERY non-SUPER_ADMIN user crashed
 * with PrismaClientValidationError ("Unknown argument `storeId`") on:
 *   - GET /api/leaves?balances=true (the desk's balance rail), and
 *   - the balance guard / recomputeBalances inside leave edit + decide.
 * Admin-only QA never saw it because SUPER_ADMIN sessions skip injection.
 *
 * The paired guard keeps the whitelist and the schema honest together:
 * if a storeId column is EVER added to EmployeeLeaveBalance, re-add the
 * model to STORE_SCOPED_MODELS (and this test will say so).
 */

const ROOT = join(process.cwd(), 'src');

describe('tenant whitelist / EmployeeLeaveBalance pairing', () => {
  const db = readFileSync(join(ROOT, 'lib/db.ts'), 'utf8');
  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');

  it('STORE_SCOPED_MODELS does NOT contain employeeLeaveBalance', () => {
    const whitelist = db.split('const STORE_SCOPED_MODELS = new Set<string>([')[1]?.split(']);')[0] ?? '';
    expect(whitelist).toBeTruthy();
    // Strip line comments first - the explanatory comment names the model.
    const code = whitelist
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    expect(code).not.toContain('employeeLeaveBalance');
    expect(code).toContain('leaveRequest');
    expect(code).toContain('employee');
  });

  it('EmployeeLeaveBalance schema has NO storeId column (the pairing guard)', () => {
    const model = schema.split('model EmployeeLeaveBalance {')[1]?.split('}')[0] ?? '';
    expect(model).toBeTruthy();
    expect(model).not.toMatch(/^\s*storeId\s+String/m);
  });

  it('documents the exclusion inline so the next reader does not re-add it', () => {
    expect(db).toContain('employeeLeaveBalance is ALSO intentionally NOT here');
  });
});
