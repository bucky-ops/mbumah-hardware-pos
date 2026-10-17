// MBUMAH HARDWARE POS - /employees/me/leave (v2.28.0, SERVER-RENDERED)
// Leave balances, my requests, and the self-service request form.
//
// v2.28.0 SSR COMPLETION (docs/hr/self-service.md): balances + requests
// used to be fetched client-side after paint; they now server-render
// through the SAME listMyLeave service the API route exposes. The request
// form stays interactive (leave-view.tsx) - it POSTs to the API route,
// where employeeId is forced to the session-linked employee, then refreshes
// the server render.

import { Palmtree } from 'lucide-react';
import { listMyLeave } from '@/lib/hr/self-service';
import { ErrorNote } from '@/components/hr/self-service-ui';
import { SelfPageHeader, loadSelfPortal } from '../self-portal';
import { LeaveView, type LeaveDto } from './leave-view';

export const dynamic = 'force-dynamic';

export default async function MyLeave() {
  const guard = await loadSelfPortal('hr.leave.read.own');
  if (!guard.ok) return guard.note;

  let data: LeaveDto;
  try {
    data = (await listMyLeave(guard.employee)) as unknown as LeaveDto;
  } catch {
    return (
      <div className="space-y-4">
        <SelfPageHeader
          icon={<Palmtree className="h-5 w-5" />}
          tone="from-sky-500/15 to-indigo-500/15 text-sky-600 dark:text-sky-400"
          title="My leave"
          description="Balances and requests. Your manager approves before days are used."
        />
        <ErrorNote message="Could not load your leave. Try again in a moment." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SelfPageHeader
        icon={<Palmtree className="h-5 w-5" />}
        tone="from-sky-500/15 to-indigo-500/15 text-sky-600 dark:text-sky-400"
        title="My leave"
        description="Balances and requests. Your manager approves before days are used."
      />
      {/* Client view: "Request leave" button + dialog, then the SSR'd
          balances and requests rendered from the payload above. selfUserId
          (v2.45.0) lets the card render the deterministic "Corrected by
          you" chip for the employee's own corrections. */}
      <LeaveView initialData={data} selfUserId={guard.session.userId} />
    </div>
  );
}
