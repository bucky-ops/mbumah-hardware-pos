// GET /api/payroll/runs/[id] - run header + aggregate totals + action context

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { hasHrPermission } from '@/lib/hr/permissions';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(
  async (_request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const run = await db.payrollRun.findFirst({
      where: { id, storeId: session.storeId || '' },
      include: {
        payrollPeriod: { select: { name: true, payDate: true, startDate: true, endDate: true } },
        journalEntry: { select: { id: true, entryNumber: true, postedAt: true } },
      },
    });
    if (!run) {
      return Response.json({ success: false, error: 'Payroll run not found.' }, { status: 404 });
    }
    // Viewer capabilities so the UI can disable actions it may not call.
    const can = {
      prepare: hasHrPermission(session.role, 'hr.payroll.prepare'),
      approve: hasHrPermission(session.role, 'hr.payroll.approve'),
      post: hasHrPermission(session.role, 'hr.payroll.post'),
      disburse: hasHrPermission(session.role, 'hr.payroll.disburse'),
      correct: hasHrPermission(session.role, 'hr.payroll.correct'),
      isPreparer: run.preparedByUserId === session.userId,
      isCorrectionRequester: false,
    };
    return Response.json({ success: true, data: run, can });
  },
);
