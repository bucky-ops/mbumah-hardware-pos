// MBUMAH HARDWARE POS - /employees/me/goals (v2.28.0, SERVER-RENDERED)
// Own goals with live progress (POS-sourced goals are computed from real
// sales — the value is never typed) and the employee's own performance
// reviews, including the self-acknowledge action for SUBMITTED reviews.
//
// v2.28.0 SSR COMPLETION (docs/hr/self-service.md): goals + reviews used to
// be fetched client-side after paint; they now server-render through the
// SAME services the API routes expose. The acknowledge action stays
// interactive (goals-view.tsx) and refreshes the server render.

import { Target } from 'lucide-react';
import { listMyGoalProgress, listMyPerformanceReviews } from '@/lib/hr/self-service';
import { ErrorNote } from '@/components/hr/self-service-ui';
import { SelfPageHeader, loadSelfPortal } from '../self-portal';
import { GoalsView, type GoalDto, type ReviewDto } from './goals-view';

export const dynamic = 'force-dynamic';

export default async function MyGoals() {
  const guard = await loadSelfPortal('hr.performance.read.own');
  if (!guard.ok) return guard.note;

  let goals: GoalDto[];
  let reviews: ReviewDto[];
  try {
    [goals, reviews] = await Promise.all([
      listMyGoalProgress(guard.employee) as unknown as Promise<GoalDto[]>,
      listMyPerformanceReviews(guard.employee) as unknown as Promise<ReviewDto[]>,
    ]);
  } catch {
    return (
      <div className="space-y-4">
        <SelfPageHeader
          icon={<Target className="h-5 w-5" />}
          tone="from-violet-500/15 to-fuchsia-500/15 text-violet-600 dark:text-violet-400"
          title="My goals & reviews"
          description="Sales goals update straight from the till — nothing for you to type."
        />
        <ErrorNote message="Could not load your goals. Try again in a moment." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SelfPageHeader
        icon={<Target className="h-5 w-5" />}
        tone="from-violet-500/15 to-fuchsia-500/15 text-violet-600 dark:text-violet-400"
        title="My goals & reviews"
        description="Sales goals update straight from the till — nothing for you to type. Acknowledge reviews your manager submits."
      />
      <GoalsView initialGoals={goals} initialReviews={reviews} />
    </div>
  );
}
