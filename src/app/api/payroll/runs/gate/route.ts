// GET /api/payroll/runs/gate?periodId=... - the pre-flight run gate (v2.133.0,
// spec Phase 4.6). Asks the run's own guardrails (consent, timesheets) who
// they would block BEFORE anyone attempts preparation — the same gates, the
// same order, the same where-clauses as preparePayrollRun, parity-pinned by
// tests. Read-only by construction: no run is created, no payslip computed,
// no state moves. Reads ride the runs list's own read-right quartet — seeing
// the gate is part of reading the desk, not part of running payroll.

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { payrollActorContext } from '@/lib/hr/payroll/run-service';
import { readRunGate, PayrollGateError } from '@/lib/hr/payroll/run-gate';
import { payrollErrorResponse } from '@/lib/hr/payroll/route-helpers';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(
  async (request: NextRequest, session) => {
    try {
      const ctx = payrollActorContext(session);
      const periodId = new URL(request.url).searchParams.get('periodId') ?? '';
      const report = await readRunGate(ctx, periodId);
      return Response.json({ success: true, data: report });
    } catch (error) {
      if (error instanceof PayrollGateError) {
        return Response.json(
          { success: false, error: error.message, code: error.code },
          { status: error.status },
        );
      }
      const mapped = payrollErrorResponse(error);
      if (mapped) return mapped;
      throw error;
    }
  },
);
