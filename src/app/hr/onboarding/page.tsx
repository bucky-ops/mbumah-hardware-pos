'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, ShieldAlert } from 'lucide-react';

interface Task {
  id: string;
  title: string;
  category: string;
  blocksTillAccess: boolean;
  isComplete: boolean;
}

interface Plan {
  id: string;
  status: string;
  employee?: { firstName: string; lastName: string; employeeCode: string | null };
  tasks: Task[];
}

export default function HrOnboardingPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/hr/onboarding/plans', { credentials: 'include' });
      const body = (await res.json()) as { success: boolean; data?: Plan[]; error?: string };
      if (!res.ok || !body.success) {
        setError(body.error || 'Onboarding data requires HR permissions.');
        setPlans([]);
        return;
      }
      setPlans(body.data ?? []);
    } catch {
      setError('Onboarding workspace is unreachable.');
      setPlans([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(url: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: 'POST', credentials: 'include' });
      const body = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !body.success) {
        setError(body.error || `Action failed (${res.status}).`);
        return false;
      }
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
        <p className="text-sm text-muted-foreground">
          Plans and checklists. Cash-handling tasks gate till access; sign-off refuses while any blocking task is open.
        </p>
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {plans === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              No onboarding plans yet. They are created automatically when an applicant is hired.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {plans.map((plan) => {
            const done = plan.tasks.filter((t) => t.isComplete).length;
            const total = plan.tasks.length;
            const blockingOpen = plan.tasks.some((t) => t.blocksTillAccess && !t.isComplete);
            return (
              <Card key={plan.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">
                        {plan.employee ? `${plan.employee.firstName} ${plan.employee.lastName}` : 'Plan'}
                        {plan.employee?.employeeCode ? (
                          <span className="ml-2 font-mono text-xs text-muted-foreground">{plan.employee.employeeCode}</span>
                        ) : null}
                      </CardTitle>
                      <CardDescription>
                        {done}/{total} tasks complete · {blockingOpen ? 'till access blocked' : 'till access ready'}
                      </CardDescription>
                    </div>
                    <Badge variant={plan.status === 'SIGNED_OFF' ? 'default' : plan.status === 'COMPLETED' ? 'secondary' : 'outline'}>
                      {plan.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ul className="space-y-1.5">
                    {plan.tasks.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <CheckCircle2
                            className={`h-4 w-4 shrink-0 ${t.isComplete ? 'text-emerald-600' : 'text-muted-foreground/40'}`}
                            aria-hidden
                          />
                          <span className={`truncate ${t.isComplete ? 'text-muted-foreground line-through' : ''}`}>{t.title}</span>
                          {t.blocksTillAccess && !t.isComplete ? (
                            <Badge variant="destructive" className="shrink-0 text-[10px]">blocks till</Badge>
                          ) : null}
                        </div>
                        {!t.isComplete ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void act(`/api/hr/onboarding/plans/${plan.id}/tasks/${t.id}/complete`)}
                          >
                            Complete
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between border-t pt-3">
                    <p className="text-xs text-muted-foreground">
                      {blockingOpen
                        ? 'Sign-off is refused while cash-handling tasks remain open.'
                        : 'All blocking tasks complete; sign-off grants till access eligibility.'}
                    </p>
                    <Button
                      size="sm"
                      disabled={busy || plan.status === 'SIGNED_OFF' || blockingOpen}
                      onClick={() => void act(`/api/hr/onboarding/plans/${plan.id}/signoff`)}
                    >
                      Sign off
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
