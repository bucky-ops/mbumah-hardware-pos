// MBUMAH HARDWARE POS - /employees/me/payslips (v2.28.0, SERVER-RENDERED)
// Own payslips with a full breakdown dialog and plain-language trace.
//
// v2.28.0 SSR COMPLETION (docs/hr/self-service.md): the list used to be
// fetched client-side after paint (with a localStorage cache for offline);
// it now server-renders through the SAME listMyPayslips service the API
// route exposes, so payslips are in the initial HTML (LCP ≈ FCP). The
// offline contract is preserved: a tiny client island mirrors the fresh
// list into the SAME localStorage key (mbt_self_payslips_cache_v1), and the
// breakdown dialog still opens from the device cache when offline
// (payslips-view.tsx). The API route stays for client detail fetches.

import { Wallet } from 'lucide-react';
import { listMyPayslips } from '@/lib/hr/self-service';
import { ErrorNote } from '@/components/hr/self-service-ui';
import { SelfPageHeader, loadSelfPortal } from '../self-portal';
import { PayslipsView, type PayslipListItem } from './payslips-view';
import { PayslipsCacheWriter } from './payslips-cache-writer';

export const dynamic = 'force-dynamic';

export default async function MyPayslips() {
  const guard = await loadSelfPortal('hr.payroll.read.own');
  if (!guard.ok) return guard.note;

  let list: PayslipListItem[];
  try {
    // Same service the API route renders - identical DTO shape (JSON-safe
    // values), so the cache-writer mirror stays compatible.
    list = (await listMyPayslips(guard.employee)) as unknown as PayslipListItem[];
  } catch {
    return (
      <div className="space-y-4">
        <SelfPageHeader
          icon={<Wallet className="h-5 w-5" />}
          tone="from-emerald-500/15 to-teal-500/15 text-emerald-600 dark:text-emerald-400"
          title="My payslips"
          description="Net pay, deductions, and the full computation for every period."
        />
        <ErrorNote message="Could not load your payslips. Try again in a moment." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PayslipsCacheWriter data={list} />
      <SelfPageHeader
        icon={<Wallet className="h-5 w-5" />}
        tone="from-emerald-500/15 to-teal-500/15 text-emerald-600 dark:text-emerald-400"
        title="My payslips"
        description="Net pay, deductions, and the full computation for every period."
      />
      <PayslipsView initialList={list} />
    </div>
  );
}
