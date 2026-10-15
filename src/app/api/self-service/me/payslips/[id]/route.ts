// GET /api/self-service/me/payslips/[id] - one own payslip with breakdown and
//     statutory ids masked ([REDACTED]) unless the caller holds
//     hr.employee.unmask.pii. 404 for any payslip owned by someone else.

import type { NextRequest } from 'next/server';
import { hasHrPermission } from '@/lib/hr/permissions';
import {
  selfServiceGuard,
  getMyPayslip,
  selfServiceErrorResponse,
} from '@/lib/hr/self-service';
import type { AuthSession } from '@/lib/auth';
import type { SelfEmployee } from '@/lib/hr/self-service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = selfServiceGuard('hr.payroll.read.own')(
  async (_request: NextRequest, session: AuthSession, employee: SelfEmployee, context?: Ctx) => {
    try {
      const { id } = await context!.params;
      const canUnmask = hasHrPermission(session.role, 'hr.employee.unmask.pii');
      const data = await getMyPayslip(employee, id, canUnmask);
      if (!data) {
        return Response.json(
          { success: false, error: 'Payslip not found.', code: 'PAYSLIP_NOT_FOUND' },
          { status: 404 },
        );
      }
      return Response.json({ success: true, data });
    } catch (error) {
      return selfServiceErrorResponse(error);
    }
  },
);
