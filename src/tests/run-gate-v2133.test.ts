import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { deriveGateState } from '@/lib/hr/payroll/run-gate';

/**
 * v2.133.0 — "the gate speaks first".
 *
 * The run's guardrails (consent, timesheets) always enforced themselves
 * inside preparePayrollRun — but their verdict only surfaced AFTER a failed
 * prepare attempt, as an amber card of issues. This release asks the SAME
 * gates the SAME question BEFORE anyone tries: a pre-flight, read-only gate
 * read per period, opened from the period header's rail beside the Ledger
 * door.
 *
 * The honesty contract under test: the gate read MIRRORS prepare line for
 * line (same employee where and order, same consent where, same timesheet
 * helper, same block order) and never writes. If prepare's gates ever
 * change, these pins fail — the gate can never drift from the run it
 * protects.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const GATE = 'src/lib/hr/payroll/run-gate.ts';
const SERVICE = 'src/lib/hr/payroll/run-service.ts';
const ROUTE = 'src/app/api/payroll/runs/gate/route.ts';
const RUNS_ROUTE = 'src/app/api/payroll/runs/route.ts';
const PAGE = 'src/app/(shell)/hr/payroll/page.tsx';

describe('deriveGateState — prepare\'s own block order, as a pure function', () => {
  it('a clean employee passes both gates and reads CLEAR', () => {
    expect(deriveGateState(true, true)).toEqual({ blocks: [], gateState: 'CLEAR' });
  });

  it('missing consent blocks first — exactly what prepare reports', () => {
    expect(deriveGateState(false, true)).toEqual({
      blocks: ['MISSING_CONSENT'],
      gateState: 'MISSING_CONSENT',
    });
  });

  it('an unapproved timesheet blocks on its own', () => {
    expect(deriveGateState(true, false)).toEqual({
      blocks: ['TIMESHEET_NOT_APPROVED'],
      gateState: 'TIMESHEET_NOT_APPROVED',
    });
  });

  it('both gates failing wear consent as the state and carry the timesheet block behind it — nothing hidden, only ordered', () => {
    expect(deriveGateState(false, false)).toEqual({
      blocks: ['MISSING_CONSENT', 'TIMESHEET_NOT_APPROVED'],
      gateState: 'MISSING_CONSENT',
    });
  });
});

describe('the parity contract — the gate mirrors prepare line for line', () => {
  it('the same employee where and order as preparePayrollRun\'s loop', () => {
    const where = "where: { storeId: ctx.storeId, deletedAt: null, status: 'ACTIVE' }";
    const order = "orderBy: { employeeCode: 'asc' }";
    expect(src(GATE)).toContain(where);
    expect(src(SERVICE)).toContain(where);
    expect(src(GATE)).toContain(order);
    expect(src(SERVICE)).toContain(order);
  });

  it('the same consent gate: withdrawnAt: null', () => {
    const consentWhere = 'where: { employeeId: employee.id, withdrawnAt: null },';
    expect(src(GATE)).toContain(consentWhere);
    expect(src(SERVICE)).toContain(consentWhere);
  });

  it('the same timesheet helper, imported from the same module', () => {
    const imp = "import { hasUnapprovedTimesheet } from '../attendance-service';";
    expect(src(GATE)).toContain(imp);
    expect(src(SERVICE)).toContain(imp);
  });

  it('the gate read never writes — no create, no update, no delete', () => {
    const s = src(GATE);
    for (const verb of ['.create(', '.update(', '.delete(', 'preparePayrollRun', 'createPayrollRun']) {
      expect(s.includes(verb)).toBe(false);
    }
  });

  it('an unknown or cross-branch period is an honest 404, not a leak', () => {
    const s = src(GATE);
    expect(s).toContain("throw new PayrollGateError('PERIOD_NOT_FOUND', 'Payroll period not found.', 404)");
    expect(s).toContain('storeId: ctx.storeId');
  });

  it('a voided period is REPORTED, not checked — the desk says runs are closed', () => {
    expect(src(GATE)).toContain('status: true');
    expect(src(PAGE)).toContain('This period is voided — runs are closed; the gate has nothing to gate.');
  });
});

describe('the gate route — a read right, never a run right', () => {
  it('GET-only behind the runs list\'s own read-right quartet and guard', () => {
    const s = src(ROUTE);
    expect(s).toContain('export const GET');
    for (const verb of ['export const POST', 'export const PATCH', 'export const PUT', 'export const DELETE']) {
      expect(s.includes(verb)).toBe(false);
    }
    expect(s).toContain("hrGuard('hr.payroll.read.all'");
    const roles = "['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const";
    expect(s).toContain(roles);
    expect(src(RUNS_ROUTE)).toContain(roles);
  });

  it('the period id rides the query string; the error path follows the house convention', () => {
    const s = src(ROUTE);
    expect(s).toContain("searchParams.get('periodId')");
    expect(s).toContain('const mapped = payrollErrorResponse(error);');
    expect(s).toContain('if (mapped) return mapped;');
    expect(s).toContain('throw error;');
  });
});

describe('the desk — the Gate door beside the Ledger door', () => {
  it('the pill lives on the period header\'s rail with its own aria, tooltip, and testid', () => {
    const s = src(PAGE);
    expect(s).toContain('data-testid="payroll-period-gate"');
    expect(s).toContain('aria-label={`Check the ${group.periodName} run gate`}');
    expect(s).toContain('Who the run gate would block, before anyone tries — the same gates prepare enforces, read-only');
    expect(s.indexOf('data-testid="payroll-period-gate"')).toBeLessThan(s.indexOf('data-testid="payroll-period-journal"'));
  });

  it('one loader, fresh fetch per open; the toggle closes the same door', () => {
    const s = src(PAGE);
    expect(s).toContain('`/api/payroll/runs/gate?periodId=${encodeURIComponent(periodId)}`');
    expect(s).toContain("credentials: 'include'");
    expect(s).toContain('if (gatePanel?.periodId === periodId) {');
  });

  it('failure speaks: a rose strip with a period-scoped Retry — never a silent spinner', () => {
    const s = src(PAGE);
    expect(s).toContain('data-testid="payroll-gate-error"');
    expect(s).toContain('failed — the desk stays dark rather than guess.');
    expect(s).toContain('aria-label={`Retry the ${periodName} gate read`}');
  });

  it('the verdict speaks: counts, clear strip, blocked rows in prepare\'s own words', () => {
    const s = src(PAGE);
    expect(s).toContain('data-testid="payroll-gate-counts"');
    expect(s).toContain('data-testid="payroll-gate-clear"');
    expect(s).toContain('The gate is clear — prepare would proceed for all');
    expect(s).toContain('data-testid="payroll-gate-blocked-row"');
    expect(s).toContain('No active data-processing consent on file; payroll blocked.');
    expect(s).toContain('Attendance for this period has unapproved timesheet days.');
  });

  it('an employee failing both gates says what prepare would report first', () => {
    const s = src(PAGE);
    expect(s).toContain('data-testid="payroll-gate-both-blocks"');
    expect(s).toContain('(prepare would report {r.blocks[0]} first)');
  });
});
