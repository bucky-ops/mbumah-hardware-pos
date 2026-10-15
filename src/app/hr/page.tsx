'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, FileText, ShieldAlert, Landmark } from 'lucide-react';

interface EmployeeSummary {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  employmentType: string;
}

interface RateTableDto {
  id: string;
  type: string;
  label: string;
  instrumentReference: string;
  verifyWithCounsel: boolean;
  effectiveFrom: string;
}

interface SettingsDto {
  moduleEnabled: boolean;
}

export default function HrOverviewPage() {
  const [employees, setEmployees] = useState<EmployeeSummary[] | null>(null);
  const [rateTables, setRateTables] = useState<RateTableDto[] | null>(null);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [empRes, rateRes, setRes] = await Promise.all([
          fetch('/api/hr/employees', { credentials: 'include' }),
          fetch('/api/hr/rate-tables', { credentials: 'include' }),
          fetch('/api/hr/settings', { credentials: 'include' }),
        ]);
        if (cancelled) return;
        if (!empRes.ok) {
          const body = (await empRes.json().catch(() => ({}))) as { error?: string };
          setError(body.error || `Failed to load HR data (${empRes.status}).`);
          setEmployees([]);
          return;
        }
        const emp = (await empRes.json()) as { data: EmployeeSummary[] };
        const rate = (await rateRes.json().catch(() => ({ data: [] }))) as { data: RateTableDto[] };
        const st = (await setRes.json().catch(() => ({ data: null }))) as { data: SettingsDto | null };
        if (cancelled) return;
        setEmployees(emp.data ?? []);
        setRateTables(rate.data ?? []);
        setSettings(st.data);
      } catch {
        if (!cancelled) {
          setError('HR workspace is unreachable. Check your connection and sign in again.');
          setEmployees([]);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const active = (employees ?? []).filter((e) => e.status === 'ACTIVE').length;
  const casual = (employees ?? []).filter((e) => e.employmentType === 'CASUAL').length;

  const stats = [
    { label: 'Active employees', value: employees ? active : null, icon: Users, hint: 'Across your store context' },
    { label: 'Casual workers', value: employees ? casual : null, icon: FileText, hint: 'Day-rate engagements' },
    { label: 'Rate tables', value: rateTables ? rateTables.length : null, icon: Landmark, hint: 'Versioned statutory data' },
    { label: 'Module flag', value: settings ? (settings.moduleEnabled ? 'On' : 'Off') : null, icon: ShieldAlert, hint: 'HR_MODULE_ENABLED' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">HR overview</h1>
        <p className="text-sm text-muted-foreground">
          Employee readiness, statutory rate data, and module status. Every figure is branch-scoped to your session.
        </p>
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardDescription className="text-xs">{stat.label}</CardDescription>
              <stat.icon className="h-4 w-4 text-muted-foreground" aria-hidden />
            </CardHeader>
            <CardContent>
              {stat.value === null ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                <div className="text-2xl font-semibold">{stat.value}</div>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{stat.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Statutory rate tables in force</CardTitle>
          <CardDescription>
            Versioned data with an instrument reference. Rates marked for counsel review are defaults, not legal advice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rateTables === null ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : rateTables.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rate tables visible for your organization yet. They are seeded automatically during deployment.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {rateTables.map((t) => (
                <li key={t.id} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{t.instrumentReference}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{t.type}</Badge>
                    {t.verifyWithCounsel ? (
                      <Badge variant="secondary" className="text-[10px]">verify with counsel</Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      from {new Date(t.effectiveFrom).toLocaleDateString()}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
